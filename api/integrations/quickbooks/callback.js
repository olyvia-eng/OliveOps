import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness } from '../../_lib/authRepo.js';
import { requireSession } from '../../_lib/session.js';
import { getQuickBooksConnection, putQuickBooksConnection } from '../../_lib/quickBooksRepo.js';
import {
  buildEncryptedQuickBooksCredentials,
  exchangeQuickBooksAuthorizationCode,
  fetchQuickBooksCompanyInfo,
  validateQuickBooksOAuthCallbackState,
} from '../../_lib/quickBooksService.js';
import { methodNotAllowed, redirectToQuickBooksIntegrations } from './_http.js';

export async function completeQuickBooksConnection({ session, code, realmId }, dependencies = {}) {
  const deps = {
    buildCredentials: buildEncryptedQuickBooksCredentials,
    createAuditEvent: createAuditEventForBusiness,
    exchangeAuthorizationCode: exchangeQuickBooksAuthorizationCode,
    fetchCompanyInfo: fetchQuickBooksCompanyInfo,
    getConnection: getQuickBooksConnection,
    putConnection: putQuickBooksConnection,
    ...dependencies,
  };
  const existing = await deps.getConnection({ businessId: session.businessId });
  if (existing?.status === 'connected') return { ok: false, reason: 'already_connected' };

  const tokens = await deps.exchangeAuthorizationCode(code);
  const company = await deps.fetchCompanyInfo({ accessToken: tokens.access_token, realmId });
  const credentials = deps.buildCredentials({ businessId: session.businessId, realmId, tokens });
  await deps.putConnection({
    businessId: session.businessId,
    connection: {
      realmId,
      companyName: company.companyName,
      legalName: company.legalName,
      country: company.country,
      currency: company.currency,
      companyInfoEntityId: company.companyInfoEntityId,
      connectedByUserId: session.id,
      ...credentials,
    },
  });
  await deps.createAuditEvent({
    businessId: session.businessId,
    auditEvent: {
      id: randomUUID(),
      action: 'quickbooks_connected',
      actorUserId: session.id,
      actorName: session.name,
      actorEmail: session.email,
      affectedEntryCount: 1,
      createdAt: new Date().toISOString(),
      metadata: { realmId, companyName: company.companyName, environment: 'sandbox' },
    },
  });
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!state) return redirectToQuickBooksIntegrations(res, 'invalid_state');
  const validState = await validateQuickBooksOAuthCallbackState({
    businessId: session.businessId,
    userId: session.id,
    state,
  });
  if (!validState) return redirectToQuickBooksIntegrations(res, 'invalid_state');
  if (typeof req.query.error === 'string') return redirectToQuickBooksIntegrations(res, 'denied');

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const realmId = typeof req.query.realmId === 'string' ? req.query.realmId.trim() : '';
  if (!code) return redirectToQuickBooksIntegrations(res, 'missing_code');
  if (!realmId) return redirectToQuickBooksIntegrations(res, 'missing_realm');

  try {
    const result = await completeQuickBooksConnection({ session, code, realmId });
    if (!result.ok) {
      return redirectToQuickBooksIntegrations(res, result.reason);
    }
    return redirectToQuickBooksIntegrations(res, 'connected');
  } catch {
    return redirectToQuickBooksIntegrations(res, 'connection_failed');
  }
}