import test from 'node:test';
import assert from 'node:assert/strict';
import dataHandler from '../api/data.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';

// Verifies the retrieval surface this feature adds for owner/admin: GET /api/data?entity=audit-events
// already existed (tenant-scoped, owner/admin-only) - these tests cover the added action/intuitTid/
// since/until filtering, and that it stays tenant-safe and role-gated exactly as before.

const key = (pk, sk) => `${pk}|${sk}`;

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') { store.set(key(input.Item.PK, input.Item.SK), { ...input.Item }); return {}; }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      const items = [...store.values()].filter((item) => item.PK === pk && typeof item.SK === 'string' && item.SK.startsWith(prefix));
      return { Items: items };
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedUser(store, { businessId, userId, role, token }) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), {
    PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId, userId,
    name: userId, email: `${userId}@example.com`, role, active: true, passwordHash: 'hash', sessionVersion: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await createMobileSessionForUser({
    user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role, businessName: 'Olive Test' },
    accessToken: token,
    expiresInSeconds: 3600,
  });
}

function seedAuditEvent(store, { businessId, eventId, action, createdAt, metadata }) {
  store.set(key(`BUSINESS#${businessId}`, `AUDIT#${eventId}`), {
    PK: `BUSINESS#${businessId}`, SK: `AUDIT#${eventId}`, entityType: 'AUDIT_EVENT', businessId,
    eventId, action, actorUserId: 'system', actorName: 'OliveOps (automatic QuickBooks request)', actorEmail: '',
    affectedEntryCount: 0, createdAt, metadata,
  });
}

async function get(token, query) {
  const res = response();
  await dataHandler({ method: 'GET', query: { entity: 'audit-events', ...query }, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

test('a QuickBooks failure audit event can be located by action, by intuit_tid, and by date range', async (t) => {
  const store = installDdb(t);
  await seedUser(store, { businessId: 'biz-a', userId: 'owner-a', role: 'owner', token: 'owner-token' });
  seedAuditEvent(store, { businessId: 'biz-a', eventId: 'evt-1', action: 'quickbooks_api_failed', createdAt: '2026-01-05T12:00:00.000Z', metadata: { intuitTid: 'txn-1', status: 400 } });
  seedAuditEvent(store, { businessId: 'biz-a', eventId: 'evt-2', action: 'quickbooks_api_failed', createdAt: '2026-01-10T12:00:00.000Z', metadata: { intuitTid: 'txn-2', status: 500 } });
  seedAuditEvent(store, { businessId: 'biz-a', eventId: 'evt-3', action: 'quickbooks_connected', createdAt: '2026-01-10T12:00:00.000Z', metadata: { intuitTid: 'txn-3' } });

  const byAction = await get('owner-token', { action: 'quickbooks_api_failed' });
  assert.equal(byAction.statusCode, 200);
  assert.deepEqual(byAction.body.items.map((item) => item.id).sort(), ['evt-1', 'evt-2']);

  const byTid = await get('owner-token', { intuitTid: 'txn-2' });
  assert.deepEqual(byTid.body.items.map((item) => item.id), ['evt-2']);

  const byRange = await get('owner-token', { action: 'quickbooks_api_failed', since: '2026-01-08T00:00:00.000Z' });
  assert.deepEqual(byRange.body.items.map((item) => item.id), ['evt-2']);

  const byUntil = await get('owner-token', { action: 'quickbooks_api_failed', until: '2026-01-06T00:00:00.000Z' });
  assert.deepEqual(byUntil.body.items.map((item) => item.id), ['evt-1']);

  const unfiltered = await get('owner-token', {});
  assert.equal(unfiltered.body.items.length, 3);
});

test('an invalid since/until value is ignored rather than rejected', async (t) => {
  const store = installDdb(t);
  await seedUser(store, { businessId: 'biz-a', userId: 'owner-a', role: 'owner', token: 'owner-token' });
  seedAuditEvent(store, { businessId: 'biz-a', eventId: 'evt-1', action: 'quickbooks_api_failed', createdAt: '2026-01-05T12:00:00.000Z', metadata: { intuitTid: 'txn-1' } });

  const result = await get('owner-token', { since: 'not-a-date' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.items.length, 1);
});

test('audit event retrieval remains tenant-scoped - one business cannot see another business\'s QuickBooks failures', async (t) => {
  const store = installDdb(t);
  await seedUser(store, { businessId: 'biz-a', userId: 'owner-a', role: 'owner', token: 'owner-a-token' });
  await seedUser(store, { businessId: 'biz-b', userId: 'owner-b', role: 'owner', token: 'owner-b-token' });
  seedAuditEvent(store, { businessId: 'biz-a', eventId: 'evt-a', action: 'quickbooks_api_failed', createdAt: '2026-01-05T12:00:00.000Z', metadata: { intuitTid: 'txn-a' } });
  seedAuditEvent(store, { businessId: 'biz-b', eventId: 'evt-b', action: 'quickbooks_api_failed', createdAt: '2026-01-05T12:00:00.000Z', metadata: { intuitTid: 'txn-b' } });

  const asBusinessA = await get('owner-a-token', {});
  assert.deepEqual(asBusinessA.body.items.map((item) => item.id), ['evt-a']);

  const asBusinessB = await get('owner-b-token', {});
  assert.deepEqual(asBusinessB.body.items.map((item) => item.id), ['evt-b']);
});

test('QuickBooks failure diagnostics remain invisible to ordinary crew users', async (t) => {
  const store = installDdb(t);
  await seedUser(store, { businessId: 'biz-a', userId: 'crew-a', role: 'crew_member', token: 'crew-token' });
  seedAuditEvent(store, { businessId: 'biz-a', eventId: 'evt-1', action: 'quickbooks_api_failed', createdAt: '2026-01-05T12:00:00.000Z', metadata: { intuitTid: 'txn-1' } });

  const result = await get('crew-token', {});
  assert.equal(result.statusCode, 403);
});
