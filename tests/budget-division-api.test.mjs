import test from 'node:test';
import assert from 'node:assert/strict';

import dataHandler from '../api/data.js';
import budgetDivisionsHandler from '../api/budget-divisions.js';
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

    if (commandType === 'DeleteCommand') {
      store.delete(mapKey(input.Key.PK, input.Key.SK));
      return {};
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

async function seedSessionToken({
  userId = 'user-a',
  businessId = 'biz-a',
  email = 'admin@example.com',
  accessToken = 'budget-token-a',
} = {}) {
  await createMobileSessionForUser({
    user: {
      id: userId,
      businessId,
      name: 'Admin User',
      email,
      role: 'admin',
      businessName: businessId,
    },
    accessToken,
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

test('legacy top-level overhead remains readable for non-destructive migration compatibility', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });
  await seedSessionToken();
  const headers = { authorization: 'Bearer budget-token-a' };

  const budgetRes = createMockRes();
  await dataHandler({ method: 'POST', query: { entity: 'budgets' }, headers, body: { data: buildBudgetRecord() } }, budgetRes);
  assert.equal(budgetRes.statusCode, 200);

  const item = { id: 'company-overhead-accounting', budgetId: 'budget-1', category: 'overhead', description: 'Accounting', costCode: 'ADMIN-001', budgeted: 12000, actual: 0, period: '2026-01' };
  const createRes = createMockRes();
  await dataHandler({ method: 'POST', query: { entity: 'budget' }, headers, body: { data: item } }, createRes);
  assert.equal(createRes.statusCode, 200);
  assert.equal(createRes.body.ok, true);

  const listAfterCreate = createMockRes();
  await dataHandler({ method: 'GET', query: { entity: 'budget' }, headers }, listAfterCreate);
  assert.deepEqual(listAfterCreate.body.items.map((value) => [value.description, value.costCode, value.budgeted]), [['Accounting', 'ADMIN-001', 12000]]);

  const updateRes = createMockRes();
  await dataHandler({ method: 'PATCH', query: { entity: 'budget', id: item.id }, headers, body: { data: { description: 'General Accounting', budgeted: 15000 } } }, updateRes);
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.ok, true);

  const listAfterUpdate = createMockRes();
  await dataHandler({ method: 'GET', query: { entity: 'budget' }, headers }, listAfterUpdate);
  assert.deepEqual(listAfterUpdate.body.items.map((value) => [value.description, value.budgeted]), [['General Accounting', 15000]]);

  const deleteRes = createMockRes();
  await dataHandler({ method: 'DELETE', query: { entity: 'budget', id: item.id }, headers }, deleteRes);
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.ok, true);

  const listAfterDelete = createMockRes();
  await dataHandler({ method: 'GET', query: { entity: 'budget' }, headers }, listAfterDelete);
  assert.deepEqual(listAfterDelete.body.items, []);
});

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

test('budget create and update return authoritative workspace metadata', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });
  await seedSessionToken();

  const createRes = createMockRes();
  await dataHandler({
    method: 'POST',
    query: { entity: 'budgets' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: {
      data: buildBudgetRecord({
        id: 'budget-workspace',
        name: '2027 Annual Budget',
        fiscalYear: '2027',
        description: 'Company-wide operating budget for 2027.',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        planningModel: 'divisions_v1',
      }),
    },
  }, createRes);

  assert.equal(createRes.statusCode, 200);
  assert.equal(createRes.body.budget.name, '2027 Annual Budget');
  assert.equal(createRes.body.budget.description, 'Company-wide operating budget for 2027.');
  assert.equal(createRes.body.budget.startDate, '2027-01-01');
  assert.equal(createRes.body.budget.endDate, '2027-12-31');
  assert.equal(createRes.body.budget.planningModel, 'divisions_v1');

  const patchRes = createMockRes();
  await dataHandler({
    method: 'PATCH',
    query: { entity: 'budgets', id: 'budget-workspace' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: { data: { description: 'Updated operating plan.' } },
  }, patchRes);

  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.body.budget.description, 'Updated operating plan.');
});

test('Budget Divisions are isolated by parent Budget and business', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });
  await seedSessionToken();
  store.set(mapKey('BUSINESS#biz-a', 'BUDGET_META#budget-1'), {
    PK: 'BUSINESS#biz-a', SK: 'BUDGET_META#budget-1', entityType: 'BUDGET', businessId: 'biz-a', budgetId: 'budget-1', ...buildBudgetRecord(),
  });
  store.set(mapKey('BUSINESS#biz-a', 'BUDGET_META#budget-2'), {
    PK: 'BUSINESS#biz-a', SK: 'BUDGET_META#budget-2', entityType: 'BUDGET', businessId: 'biz-a', budgetId: 'budget-2', ...buildBudgetRecord({ id: 'budget-2' }),
  });

  const createRes = createMockRes();
  await budgetDivisionsHandler({
    method: 'POST',
    query: { budgetId: 'budget-1' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: { data: { id: 'division-snow', budgetId: 'budget-1', name: 'Snow Removal', costCode: ' DIV-SNOW ', description: '', revenueTarget: 500000, status: 'active', sortOrder: 0 } },
  }, createRes);
  assert.equal(createRes.statusCode, 200);
  assert.equal(createRes.body.division.revenueTarget, 500000);
  assert.equal(createRes.body.division.costCode, 'DIV-SNOW');

  const listRes = createMockRes();
  await budgetDivisionsHandler({ method: 'GET', query: { budgetId: 'budget-1' }, headers: { authorization: 'Bearer budget-token-a' } }, listRes);
  assert.deepEqual(listRes.body.divisions.map((division) => division.name), ['Snow Removal']);
  assert.equal(listRes.body.divisions[0].costCode, 'DIV-SNOW');

  const createSiblingRes = createMockRes();
  await budgetDivisionsHandler({
    method: 'POST',
    query: { budgetId: 'budget-1' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: { data: { id: 'division-landscape', budgetId: 'budget-1', name: 'Landscaping', costCode: 'DIV-LAND', description: '', revenueTarget: 300000, status: 'active', sortOrder: 1 } },
  }, createSiblingRes);
  assert.equal(createSiblingRes.statusCode, 200);

  const updateTargetRes = createMockRes();
  await budgetDivisionsHandler({
    method: 'PATCH',
    query: { budgetId: 'budget-1', id: 'division-snow' },
    headers: { authorization: 'Bearer budget-token-a' },
    body: { data: { revenueTarget: 625000 } },
  }, updateTargetRes);
  assert.equal(updateTargetRes.statusCode, 200);
  assert.equal(updateTargetRes.body.division.revenueTarget, 625000);

  const reloadRes = createMockRes();
  await budgetDivisionsHandler({ method: 'GET', query: { budgetId: 'budget-1' }, headers: { authorization: 'Bearer budget-token-a' } }, reloadRes);
  assert.deepEqual(
    reloadRes.body.divisions.sort((left, right) => left.sortOrder - right.sortOrder).map((division) => [division.id, division.revenueTarget]),
    [['division-snow', 625000], ['division-landscape', 300000]],
  );

  const wrongParentRes = createMockRes();
  await budgetDivisionsHandler({ method: 'GET', query: { budgetId: 'budget-2', id: 'division-snow' }, headers: { authorization: 'Bearer budget-token-a' } }, wrongParentRes);
  assert.equal(wrongParentRes.statusCode, 404);

  seedBusinessUser(store, { businessId: 'biz-b', userId: 'user-b', email: 'admin-b@example.com' });
  store.set(mapKey('BUSINESS#biz-b', 'BUDGET_META#budget-1'), {
    PK: 'BUSINESS#biz-b', SK: 'BUDGET_META#budget-1', entityType: 'BUDGET', businessId: 'biz-b', budgetId: 'budget-1', ...buildBudgetRecord(),
  });
  await seedSessionToken({ userId: 'user-b', businessId: 'biz-b', email: 'admin-b@example.com', accessToken: 'budget-token-b' });
  const foreignBusinessRes = createMockRes();
  await budgetDivisionsHandler({ method: 'PATCH', query: { budgetId: 'budget-1', id: 'division-snow' }, headers: { authorization: 'Bearer budget-token-b' }, body: { data: { revenueTarget: 1 } } }, foreignBusinessRes);
  assert.equal(foreignBusinessRes.statusCode, 404);

  const ownerReloadRes = createMockRes();
  await budgetDivisionsHandler({ method: 'GET', query: { budgetId: 'budget-1', id: 'division-snow' }, headers: { authorization: 'Bearer budget-token-a' } }, ownerReloadRes);
  assert.equal(ownerReloadRes.body.division.revenueTarget, 625000);
});
