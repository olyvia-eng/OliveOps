import test from 'node:test';
import assert from 'node:assert/strict';

import dataHandler from '../api/data.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mapKey(pk, sk) {
  return `${pk}|${sk}`;
}

function installDdbMock(t) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);

  ddb.send = async (command) => {
    const commandType = command?.constructor?.name;
    const input = command?.input ?? {};

    if (commandType === 'PutCommand') {
      const item = { ...input.Item };
      store.set(mapKey(item.PK, item.SK), item);
      return {};
    }

    if (commandType === 'GetCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      return { Item: store.get(key) };
    }

    if (commandType === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      const items = [];

      for (const item of store.values()) {
        if (item.PK === pk && typeof item.SK === 'string' && item.SK.startsWith(prefix)) {
          items.push(item);
        }
      }

      return { Items: items };
    }

    return originalSend(command);
  };

  t.after(() => {
    ddb.send = originalSend;
  });

  return store;
}

function seedBusinessUser(store, { businessId, userId, role = 'admin', email = 'admin@example.com' }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `USER#${userId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `USER#${userId}`,
      entityType: 'USER',
      businessId,
      userId,
      name: 'Admin User',
      email,
      role,
      active: true,
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

async function seedSessionToken() {
  await createMobileSessionForUser({
    user: {
      id: 'user-a',
      businessId: 'biz-a',
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      businessName: 'Business A',
    },
    accessToken: 'budget-token-a',
    expiresInSeconds: 604800,
  });
}

function buildBudgetRecord(overrides = {}) {
  return {
    id: 'budget-1',
    name: '2026 Pricing Budget',
    budgetType: 'operating',
    division: 'company_wide',
    fiscalYear: '2026',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('budget create accepts arbitrary division text and preserves stored value', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });
  await seedSessionToken();

  const createReq = {
    method: 'POST',
    query: { entity: 'budgets' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: { data: buildBudgetRecord({ division: 'construction and concrete' }) },
  };
  const createRes = createMockRes();

  await dataHandler(createReq, createRes);

  assert.equal(createRes.statusCode, 200);
  assert.equal(createRes.body.ok, true);

  const listReq = {
    method: 'GET',
    query: { entity: 'budgets' },
    headers: { authorization: 'Bearer budget-token-a' },
  };
  const listRes = createMockRes();

  await dataHandler(listReq, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.ok, true);
  assert.equal(listRes.body.items[0].division, 'construction and concrete');
});

test('budget create requires a non-empty division value', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });
  await seedSessionToken();

  const req = {
    method: 'POST',
    query: { entity: 'budgets' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: {
      data: buildBudgetRecord({
        id: 'budget-invalid-create',
        division: '   ',
      }),
    },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Budget division is required.');
});

test('budget update accepts arbitrary division values', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });
  await seedSessionToken();

  const createReq = {
    method: 'POST',
    query: { entity: 'budgets' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: {
      data: buildBudgetRecord({
        id: 'budget-valid-update',
        division: 'company_wide',
      }),
    },
  };
  const createRes = createMockRes();

  await dataHandler(createReq, createRes);
  assert.equal(createRes.statusCode, 200);

  const patchReq = {
    method: 'PATCH',
    query: { entity: 'budgets', id: 'budget-valid-update' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: {
      data: {
        division: 'special projects north',
      },
    },
  };
  const patchRes = createMockRes();

  await dataHandler(patchReq, patchRes);

  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.body.ok, true);

  const listReq = {
    method: 'GET',
    query: { entity: 'budgets' },
    headers: { authorization: 'Bearer budget-token-a' },
  };
  const listRes = createMockRes();

  await dataHandler(listReq, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.ok, true);
  assert.equal(listRes.body.items[0].division, 'special projects north');
});
