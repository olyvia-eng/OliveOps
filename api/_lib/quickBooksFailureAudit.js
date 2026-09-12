// Durable, best-effort persistence of QuickBooks Accounting API / OAuth request failures, reusing
// the existing tenant-scoped audit-event system (createAuditEventForBusiness) rather than a new
// logging vendor. This exists specifically so OliveOps can truthfully tell Intuit "yes, we store API
// error information in logs that can be shared for troubleshooting" - the [quickbooks:failure]
// console.error line OliveOps already writes is only as durable as Vercel's own runtime-log
// retention window, while an audit event has no expiry.
import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness } from './authRepo.js';

export const QUICKBOOKS_API_FAILED_ACTION = 'quickbooks_api_failed';

// A short in-process window to collapse the same underlying failure being observed and recorded
// more than once (e.g. if a future call site ends up wrapping another one). This is a defensive
// backstop, not the primary duplicate-prevention mechanism - the primary one is that only
// readQuickBooksResponse and revokeQuickBooksToken ever call this function, so a given failed HTTP
// request is only ever reported once in the normal case.
const DEDUPE_WINDOW_MS = 5_000;
const MAX_TRACKED_KEYS = 500;
let recentFailureKeys = new Map(); // dedupe key -> expiresAt (epoch ms)

function dedupeKey(details) {
  return [details.businessId, details.realmId, details.action, details.status, details.code, details.intuitTid]
    .map((value) => (value === undefined || value === null ? '' : String(value)))
    .join('|');
}

function isDuplicate(details, now) {
  const key = dedupeKey(details);
  const expiresAt = recentFailureKeys.get(key);
  if (expiresAt !== undefined && expiresAt > now) return true;
  recentFailureKeys.set(key, now + DEDUPE_WINDOW_MS);
  if (recentFailureKeys.size > MAX_TRACKED_KEYS) {
    for (const [existingKey, existingExpiresAt] of recentFailureKeys) {
      if (existingExpiresAt <= now) recentFailureKeys.delete(existingKey);
    }
  }
  return false;
}

/**
 * Persists a QuickBooks request failure as a durable, tenant-scoped audit event.
 *
 * Only ever writes the explicit allowlist of fields below - never a token, secret, header, or raw
 * request/response body. Skips silently (never throws, never delays or replaces the caller's real
 * error) when there is no businessId to scope the record to, when the write itself fails, or when
 * an identical failure was just recorded within the dedupe window.
 *
 * @param {object} details
 * @param {string} [details.businessId] - required to actually write anything; a failure with no
 *   known tenant (should not normally happen for these callers) is skipped, not force-attributed.
 * @param {string} [details.actorUserId] - the session that triggered the request, when known.
 * @param {string} [details.actorName]
 * @param {string} [details.actorEmail]
 * @param {string} [details.action] - which kind of QuickBooks operation this was (e.g.
 *   'quickbooks_api', 'quickbooks_oauth_token', 'quickbooks_oauth_revoke') - not the audit event's
 *   own `action` field, which is always the fixed QUICKBOOKS_API_FAILED_ACTION.
 * @param {string} [details.method] - HTTP method.
 * @param {string} [details.path] - the QuickBooks API path/resource template actually called (e.g.
 *   '/invoice', '/customer', '/query') - never a raw request URL with query data.
 * @param {string} [details.realmId] - the connected QuickBooks company/realm id, already treated as
 *   safe non-secret metadata elsewhere in the existing audit events.
 * @param {number} [details.status] - HTTP status code.
 * @param {string} [details.code] - Intuit's own Fault error code, or the OAuth `error` value.
 * @param {string|null} [details.intuitTid] - Intuit's correlation id for this request, if supplied.
 */
export async function recordQuickBooksFailureAuditEvent(details = {}, dependencies = {}) {
  if (!details.businessId) return;
  const createAuditEvent = dependencies.createAuditEvent ?? createAuditEventForBusiness;
  const now = (dependencies.now ?? Date.now)();

  if (isDuplicate(details, now)) return;

  try {
    await createAuditEvent({
      businessId: details.businessId,
      auditEvent: {
        id: randomUUID(),
        action: QUICKBOOKS_API_FAILED_ACTION,
        actorUserId: details.actorUserId || 'system',
        actorName: details.actorName || 'OliveOps (automatic QuickBooks request)',
        actorEmail: details.actorEmail || '',
        affectedEntryCount: 0,
        createdAt: new Date(now).toISOString(),
        metadata: {
          qboOperation: details.action ?? 'unknown',
          method: details.method ?? null,
          path: details.path ?? null,
          realmId: details.realmId ?? null,
          status: details.status ?? null,
          code: details.code ?? null,
          intuitTid: details.intuitTid ?? null,
        },
      },
    });
  } catch {
    // Best-effort: diagnostic persistence must never mask, delay, or replace the original
    // QuickBooks error the caller is already throwing/handling.
  }
}

export function resetQuickBooksFailureAuditDedupeForTests() {
  recentFailureKeys = new Map();
}
