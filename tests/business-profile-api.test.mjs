import test from 'node:test';
import assert from 'node:assert/strict';
import businessHandler from '../api/business.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } });

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') { store.set(key(input.Item.PK, input.Item.SK), { ...input.Item }); return {}; }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'UpdateCommand') {
      const itemKey = key(input.Key.PK, input.Key.SK);
      const existing = store.get(itemKey);
      if (!existing) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
      const next = { ...existing, timezone: input.ExpressionAttributeValues[':timezone'], legalName: input.ExpressionAttributeValues[':legalName'], phone: input.ExpressionAttributeValues[':phone'], email: input.ExpressionAttributeValues[':email'], website: input.ExpressionAttributeValues[':website'], businessAddress: input.ExpressionAttributeValues[':businessAddress'], taxLabel: input.ExpressionAttributeValues[':taxLabel'], proposalTerms: input.ExpressionAttributeValues[':proposalTerms'], updatedAt: input.ExpressionAttributeValues[':updatedAt'] };
      store.set(itemKey, next);
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedUser(store, { userId, role, token }) {
  store.set(key('BUSINESS#biz-a', `USER#${userId}`), { PK: 'BUSINESS#biz-a', SK: `USER#${userId}`, entityType: 'USER', businessId: 'biz-a', userId, name: userId, email: `${userId}@example.com`, role, active: true, passwordHash: 'hash', sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' });
  await createMobileSessionForUser({ user: { id: userId, businessId: 'biz-a', name: userId, email: `${userId}@example.com`, role, businessName: 'Olive Test' }, accessToken: token, expiresInSeconds: 3600 });
}

async function request(token, method, body) {
  const res = response();
  await businessHandler({ method, query: {}, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('business profile uses Toronto fallback and persists a valid tenant timezone', async (t) => {
  const store = installDdb(t);
  store.set(key('BUSINESS#biz-a', 'PROFILE'), { PK: 'BUSINESS#biz-a', SK: 'PROFILE', entityType: 'BUSINESS', businessId: 'biz-a', name: 'Olive Test', createdAt: '2026-01-01T00:00:00.000Z' });
  await seedUser(store, { userId: 'owner-a', role: 'owner', token: 'owner-token' });

  const legacy = await request('owner-token', 'GET');
  assert.equal(legacy.statusCode, 200);
  assert.equal(legacy.body.business.timezone, 'America/Toronto');

  const invalid = await request('owner-token', 'PATCH', { timezone: 'Not/AZone', businessId: 'biz-b' });
  assert.equal(invalid.statusCode, 400);

  const saved = await request('owner-token', 'PATCH', { timezone: 'America/Vancouver', businessId: 'biz-b' });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.business.id, 'biz-a');
  assert.equal(saved.body.business.timezone, 'America/Vancouver');
  assert.equal(store.get(key('BUSINESS#biz-a', 'PROFILE')).timezone, 'America/Vancouver');
});

test('company proposal identity and reusable terms persist without changing tenant ownership', async (t) => {
  const store = installDdb(t);
  store.set(key('BUSINESS#biz-a', 'PROFILE'), { PK: 'BUSINESS#biz-a', SK: 'PROFILE', entityType: 'BUSINESS', businessId: 'biz-a', name: 'Olive Test', timezone: 'America/Toronto', createdAt: '2026-01-01T00:00:00.000Z' });
  await seedUser(store, { userId: 'owner-proposal', role: 'owner', token: 'owner-proposal-token' });

  const saved = await request('owner-proposal-token', 'PATCH', { legalName: 'Olive Test Ltd.', phone: '905-555-0100', email: 'office@example.ca', website: 'example.ca', businessAddress: '1 Main Street', taxLabel: 'HST', proposalTerms: 'Customer terms', businessId: 'biz-b' });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.business.id, 'biz-a');
  assert.equal(saved.body.business.legalName, 'Olive Test Ltd.');
  assert.equal(saved.body.business.proposalTerms, 'Customer terms');
  assert.equal(store.get(key('BUSINESS#biz-a', 'PROFILE')).taxLabel, 'HST');
});

test('crew members cannot read or change company timezone', async (t) => {
  const store = installDdb(t);
  store.set(key('BUSINESS#biz-a', 'PROFILE'), { PK: 'BUSINESS#biz-a', SK: 'PROFILE', entityType: 'BUSINESS', businessId: 'biz-a', name: 'Olive Test', createdAt: '2026-01-01T00:00:00.000Z' });
  await seedUser(store, { userId: 'crew-a', role: 'crew_member', token: 'crew-token' });
  assert.equal((await request('crew-token', 'GET')).statusCode, 403);
  assert.equal((await request('crew-token', 'PATCH', { timezone: 'UTC' })).statusCode, 403);
});

test('legacy Business pricingBudgetId remains readable but profile updates leave it dormant', async (t) => {
  const store = installDdb(t);
  store.set(key('BUSINESS#biz-a', 'PROFILE'), { PK: 'BUSINESS#biz-a', SK: 'PROFILE', entityType: 'BUSINESS', businessId: 'biz-a', name: 'Olive Test', timezone: 'America/Toronto', pricingBudgetId: 'legacy-budget', createdAt: '2026-01-01T00:00:00.000Z' });
  await seedUser(store, { userId: 'owner-pricing', role: 'owner', token: 'owner-pricing-token' });

  const loaded = await request('owner-pricing-token', 'GET');
  assert.equal(loaded.body.business.pricingBudgetId, 'legacy-budget');
  const saved = await request('owner-pricing-token', 'PATCH', { timezone: 'America/Vancouver', pricingBudgetId: 'ignored-new-value' });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.business.pricingBudgetId, 'legacy-budget');
  assert.equal(store.get(key('BUSINESS#biz-a', 'PROFILE')).pricingBudgetId, 'legacy-budget');
});