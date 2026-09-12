import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  QUICKBOOKS_API_FAILED_ACTION,
  recordQuickBooksFailureAuditEvent,
  resetQuickBooksFailureAuditDedupeForTests,
} from '../api/_lib/quickBooksFailureAudit.js';
import { createQuickBooksInvoice, fetchQuickBooksCompanyInfo } from '../api/_lib/quickBooksService.js';
import { ddb } from '../api/_lib/db.js';

process.env.QUICKBOOKS_CLIENT_ID = 'sandbox-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'sandbox-client-secret';
process.env.QUICKBOOKS_REDIRECT_URI = 'https://oliveops.example/api/integrations/quickbooks/callback';
process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

beforeEach(() => resetQuickBooksFailureAuditDedupeForTests());

const jsonResponse = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

// Intercepts only the AUDIT_EVENT PutCommand this feature issues, so these tests don't need a full
// DynamoDB double - everything else still goes to the real ddb client (which these tests never
// otherwise touch).
function installAuditDdbSpy(t) {
  const putItems = [];
  const original = ddb.send.bind(ddb);
  let failNextPut = false;
  ddb.send = async (command) => {
    if (command?.constructor?.name === 'PutCommand' && command.input?.Item?.entityType === 'AUDIT_EVENT') {
      if (failNextPut) throw new Error('DynamoDB is unavailable');
      putItems.push(command.input.Item);
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return { putItems, setFailNextPut: (value) => { failNextPut = value; } };
}

test('a QuickBooks failure is persisted as a durable, tenant-scoped audit event', async () => {
  const written = [];
  await recordQuickBooksFailureAuditEvent(
    {
      businessId: 'business-1', actorUserId: 'user-1', actorName: 'Owner', actorEmail: 'owner@example.com',
      action: 'quickbooks_api', method: 'POST', path: '/invoice', realmId: 'realm-1', status: 400, code: '6000', intuitTid: 'txn-abc',
    },
    { createAuditEvent: async (args) => written.push(args) },
  );
  assert.equal(written.length, 1);
  assert.equal(written[0].businessId, 'business-1');
  const event = written[0].auditEvent;
  assert.equal(event.action, QUICKBOOKS_API_FAILED_ACTION);
  assert.equal(event.actorUserId, 'user-1');
  assert.equal(event.actorName, 'Owner');
  assert.equal(event.actorEmail, 'owner@example.com');
  assert.equal(event.metadata.intuitTid, 'txn-abc');
  assert.equal(event.metadata.status, 400);
  assert.equal(event.metadata.code, '6000');
  assert.equal(event.metadata.realmId, 'realm-1');
  assert.equal(event.metadata.method, 'POST');
  assert.equal(event.metadata.path, '/invoice');
  assert.equal(event.metadata.qboOperation, 'quickbooks_api');
  assert.ok(typeof event.id === 'string' && event.id.length > 0);
  assert.ok(typeof event.createdAt === 'string' && !Number.isNaN(Date.parse(event.createdAt)));
});

test('an anonymous/system failure (no known actor) still records a usable event', async () => {
  const written = [];
  await recordQuickBooksFailureAuditEvent(
    { businessId: 'business-1', action: 'quickbooks_oauth_token', status: 400, code: 'invalid_grant', intuitTid: 'txn-refresh' },
    { createAuditEvent: async (args) => written.push(args) },
  );
  assert.equal(written.length, 1);
  assert.equal(written[0].auditEvent.actorUserId, 'system');
  assert.equal(typeof written[0].auditEvent.actorName, 'string');
  assert.ok(written[0].auditEvent.actorName.length > 0);
});

test('only the explicit allowlisted fields are persisted - never tokens, secrets, headers, keys, or raw payloads', async () => {
  const written = [];
  await recordQuickBooksFailureAuditEvent(
    {
      businessId: 'business-1', action: 'quickbooks_api', method: 'POST', path: '/invoice', realmId: 'realm-1', status: 400, code: '6000', intuitTid: 'txn-abc',
      // None of these should ever be read or persisted, even if a caller accidentally included them.
      accessToken: 'super-secret-access-token', refreshToken: 'super-secret-refresh-token', clientSecret: 'super-secret-client-secret',
      authorizationHeader: 'Bearer super-secret-access-token', encryptionKey: 'super-secret-encryption-key',
      requestBody: { Line: [{ Amount: 9999.99 }] }, responseBody: { Fault: { Error: [{ Message: 'full raw fault detail' }] } },
      stack: 'Error: QuickBooks request failed\n    at secretPath (super-secret-access-token)',
    },
    { createAuditEvent: async (args) => written.push(args) },
  );
  const serialized = JSON.stringify(written);
  for (const secret of [
    'super-secret-access-token', 'super-secret-refresh-token', 'super-secret-client-secret', 'super-secret-encryption-key',
    'Bearer', '9999.99', 'full raw fault detail', 'secretPath',
  ]) {
    assert.equal(serialized.includes(secret), false, `must never be persisted: ${secret}`);
  }
  assert.deepEqual(
    Object.keys(written[0].auditEvent.metadata).sort(),
    ['code', 'intuitTid', 'method', 'path', 'qboOperation', 'realmId', 'status'].sort(),
  );
});

test('a missing businessId is skipped silently - never throws, never writes anything', async () => {
  let called = false;
  await recordQuickBooksFailureAuditEvent(
    { action: 'quickbooks_api', status: 500, code: 'QBO_API_ERROR', intuitTid: 'txn-1' },
    { createAuditEvent: async () => { called = true; } },
  );
  assert.equal(called, false);
});

test('a missing intuit_tid never prevents the audit event from being written', async () => {
  const written = [];
  await recordQuickBooksFailureAuditEvent(
    { businessId: 'business-1', action: 'quickbooks_api', status: 500, code: 'QBO_API_ERROR', intuitTid: null },
    { createAuditEvent: async (args) => written.push(args) },
  );
  assert.equal(written.length, 1);
  assert.equal(written[0].auditEvent.metadata.intuitTid, null);
});

test('a diagnostic write failure is fully best-effort - it never throws', async () => {
  await assert.doesNotReject(recordQuickBooksFailureAuditEvent(
    { businessId: 'business-1', action: 'quickbooks_api', status: 500, code: 'QBO_API_ERROR', intuitTid: 'txn-1' },
    { createAuditEvent: async () => { throw new Error('DynamoDB is unavailable'); } },
  ));
});

test('the same failure observed twice in quick succession is only persisted once', async () => {
  const written = [];
  const details = { businessId: 'business-1', action: 'quickbooks_api', method: 'POST', path: '/invoice', realmId: 'realm-1', status: 400, code: '6000', intuitTid: 'txn-dup' };
  const createAuditEvent = async (args) => written.push(args);
  await recordQuickBooksFailureAuditEvent(details, { createAuditEvent });
  await recordQuickBooksFailureAuditEvent(details, { createAuditEvent });
  assert.equal(written.length, 1);
});

test('a distinct failure right after a duplicate is still recorded', async () => {
  const written = [];
  const createAuditEvent = async (args) => written.push(args);
  await recordQuickBooksFailureAuditEvent({ businessId: 'business-1', action: 'quickbooks_api', status: 400, code: '6000', intuitTid: 'txn-a' }, { createAuditEvent });
  await recordQuickBooksFailureAuditEvent({ businessId: 'business-1', action: 'quickbooks_api', status: 500, code: '6001', intuitTid: 'txn-b' }, { createAuditEvent });
  assert.equal(written.length, 2);
});

test('a duplicate failure is recorded again once the dedupe window has elapsed', async () => {
  const written = [];
  const createAuditEvent = async (args) => written.push(args);
  const details = { businessId: 'business-1', action: 'quickbooks_api', status: 400, code: '6000', intuitTid: 'txn-ttl' };
  let clock = 0;
  const now = () => clock;
  await recordQuickBooksFailureAuditEvent(details, { createAuditEvent, now });
  clock += 6_000; // past the 5s dedupe window
  await recordQuickBooksFailureAuditEvent(details, { createAuditEvent, now });
  assert.equal(written.length, 2);
});

test('failures for different businesses are never conflated by the dedupe window', async () => {
  const written = [];
  const createAuditEvent = async (args) => written.push(args);
  const details = { action: 'quickbooks_api', status: 400, code: '6000', intuitTid: 'txn-shared' };
  await recordQuickBooksFailureAuditEvent({ ...details, businessId: 'business-1' }, { createAuditEvent });
  await recordQuickBooksFailureAuditEvent({ ...details, businessId: 'business-2' }, { createAuditEvent });
  assert.equal(written.length, 2);
  assert.deepEqual(written.map((entry) => entry.businessId).sort(), ['business-1', 'business-2']);
});

test('a failing Accounting API call persists a durable, tenant-scoped audit event without changing the thrown error', async (t) => {
  const spy = installAuditDdbSpy(t);
  await assert.rejects(
    fetchQuickBooksCompanyInfo({
      accessToken: 'access-token',
      realmId: 'realm-int-1',
      businessId: 'business-int-1',
      actorUserId: 'user-1',
      actorName: 'Owner',
      actorEmail: 'owner@example.com',
      fetchImpl: async () => jsonResponse({ Fault: { Error: [{ code: '6000' }] } }, 400, { intuit_tid: 'txn-int-1' }),
    }),
    (error) => {
      assert.equal(error.message, 'QuickBooks request failed');
      assert.equal(error.status, 400);
      assert.equal(error.code, '6000');
      assert.equal(error.intuitTid, 'txn-int-1');
      return true;
    },
  );
  assert.equal(spy.putItems.length, 1);
  const item = spy.putItems[0];
  assert.equal(item.PK, 'BUSINESS#business-int-1');
  assert.equal(item.action, QUICKBOOKS_API_FAILED_ACTION);
  assert.equal(item.metadata.intuitTid, 'txn-int-1');
  assert.equal(item.metadata.realmId, 'realm-int-1');
});

test('a DynamoDB failure while writing the diagnostic audit event never masks the original QuickBooks error', async (t) => {
  const spy = installAuditDdbSpy(t);
  spy.setFailNextPut(true);
  await assert.rejects(
    createQuickBooksInvoice({
      accessToken: 'access-token',
      realmId: 'realm-int-2',
      businessId: 'business-int-2',
      invoice: { Line: [] },
      requestId: 'request-int-2',
      fetchImpl: async () => jsonResponse({ Fault: { Error: [{ code: '6240' }] } }, 400, { intuit_tid: 'txn-int-2' }),
    }),
    (error) => {
      assert.equal(error.message, 'QuickBooks request failed');
      assert.equal(error.status, 400);
      assert.equal(error.code, '6240');
      assert.equal(error.intuitTid, 'txn-int-2');
      return true;
    },
  );
  // The audit write itself failed, so nothing was recorded - but the real QuickBooks error above
  // still surfaced exactly as it would have without this feature at all.
  assert.equal(spy.putItems.length, 0);
});

test('a successful Accounting API call never writes a failure audit event', async (t) => {
  const spy = installAuditDdbSpy(t);
  const company = await fetchQuickBooksCompanyInfo({
    accessToken: 'access-token',
    realmId: 'realm-int-3',
    businessId: 'business-int-3',
    fetchImpl: async () => jsonResponse({ CompanyInfo: { Id: '1', CompanyName: 'OK Co' } }),
  });
  assert.equal(company.companyName, 'OK Co');
  assert.equal(spy.putItems.length, 0);
});

test('a failure with no businessId in scope (no caller context) writes no audit event, only the console log', async (t) => {
  const spy = installAuditDdbSpy(t);
  await assert.rejects(fetchQuickBooksCompanyInfo({
    accessToken: 'access-token',
    realmId: 'realm-int-4',
    fetchImpl: async () => jsonResponse({}, 500),
  }));
  assert.equal(spy.putItems.length, 0);
});
