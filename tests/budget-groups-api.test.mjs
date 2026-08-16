import test from 'node:test';
import assert from 'node:assert/strict';

import budgetGroupsHandler from '../api/budget-groups.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { saveEquipmentBudgetAllocationForItem } from '../api/_lib/budgetGroups.js';

function createMockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const key = (pk, sk) => `${pk}|${sk}`;

function installDdbMock(t) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const input = command.input ?? {};
    const type = command.constructor?.name;
    if (type === 'PutCommand') {
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'DeleteCommand') {
      store.delete(key(input.Key.PK, input.Key.SK));
      return {};
    }
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    if (type === 'TransactWriteCommand') {
      for (const operation of input.TransactItems) {
        if (operation.Put) store.set(key(operation.Put.Item.PK, operation.Put.Item.SK), { ...operation.Put.Item });
        if (operation.Delete) store.delete(key(operation.Delete.Key.PK, operation.Delete.Key.SK));
      }
      return {};
    }
    return originalSend(command);
  };
  t.after(() => { ddb.send = originalSend; });
  return store;
}

function seedUser(store, businessId, userId, email) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), {
    PK: `BUSINESS#${businessId}`,
    SK: `USER#${userId}`,
    entityType: 'USER',
    businessId,
    userId,
    name: 'Admin',
    email,
    role: 'admin',
    active: true,
    passwordHash: 'hash',
  });
}

function seedBudget(store, businessId, id, fiscalYear = '2027') {
  store.set(key(`BUSINESS#${businessId}`, `BUDGET_META#${id}`), {
    PK: `BUSINESS#${businessId}`,
    SK: `BUDGET_META#${id}`,
    entityType: 'BUDGET',
    businessId,
    budgetId: id,
    id,
    name: id,
    budgetType: 'operating',
    division: 'company_wide',
    fiscalYear,
    status: 'draft',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
  });
}

async function seedSession({ businessId, userId, email, token }) {
  await createMobileSessionForUser({
    user: { id: userId, businessId, name: 'Admin', email, role: 'admin', businessName: businessId },
    accessToken: token,
    expiresInSeconds: 3600,
  });
}

test('Budget Group creation persists membership and remains tenant scoped', async (t) => {
  const store = installDdbMock(t);
  seedUser(store, 'biz-a', 'user-a', 'a@example.com');
  seedUser(store, 'biz-b', 'user-b', 'b@example.com');
  seedBudget(store, 'biz-a', 'snow');
  seedBudget(store, 'biz-a', 'landscape');
  await seedSession({ businessId: 'biz-a', userId: 'user-a', email: 'a@example.com', token: 'group-a' });
  await seedSession({ businessId: 'biz-b', userId: 'user-b', email: 'b@example.com', token: 'group-b' });

  const createRes = createMockRes();
  await budgetGroupsHandler({
    method: 'POST',
    query: {},
    headers: { authorization: 'Bearer group-a' },
    body: { id: 'operations-2027', name: 'Operations', year: '2027', budgetIds: ['snow', 'landscape'] },
  }, createRes);

  assert.equal(createRes.statusCode, 200);
  assert.equal(createRes.body.group.budgetIds.length, 2);
  assert.equal(store.get(key('BUSINESS#biz-a', 'BUDGET_META#snow')).budgetGroupId, 'operations-2027');

  const otherTenantRes = createMockRes();
  await budgetGroupsHandler({
    method: 'GET',
    query: {},
    headers: { authorization: 'Bearer group-b' },
  }, otherTenantRes);
  assert.deepEqual(otherTenantRes.body.groups, []);
});

test('Budget Group rejects budgets from a different fiscal year', async (t) => {
  const store = installDdbMock(t);
  seedUser(store, 'biz-a', 'user-a', 'a@example.com');
  seedBudget(store, 'biz-a', 'current', '2027');
  seedBudget(store, 'biz-a', 'future', '2028');
  await seedSession({ businessId: 'biz-a', userId: 'user-a', email: 'a@example.com', token: 'mixed-year' });

  const res = createMockRes();
  await budgetGroupsHandler({
    method: 'POST',
    query: {},
    headers: { authorization: 'Bearer mixed-year' },
    body: { id: 'mixed', name: 'Mixed', year: '2027', budgetIds: ['current', 'future'] },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /same fiscal year/i);
});

test('equipment allocation rejects capacity above twelve months within a group', async (t) => {
  const store = installDdbMock(t);
  seedBudget(store, 'biz-a', 'snow');
  seedBudget(store, 'biz-a', 'landscape');
  store.set(key('BUSINESS#biz-a', 'BUDGET_GROUP#operations'), {
    PK: 'BUSINESS#biz-a',
    SK: 'BUDGET_GROUP#operations',
    entityType: 'BUDGET_GROUP',
    businessId: 'biz-a',
    budgetGroupId: 'operations',
    name: 'Operations',
    year: '2027',
    budgetIds: ['snow', 'landscape'],
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
  });
  store.get(key('BUSINESS#biz-a', 'BUDGET_META#snow')).budgetGroupId = 'operations';
  store.get(key('BUSINESS#biz-a', 'BUDGET_META#landscape')).budgetGroupId = 'operations';

  const first = await saveEquipmentBudgetAllocationForItem({
    businessId: 'biz-a', budgetId: 'snow', equipmentId: 'loader', budgetItemId: 'snow-loader', monthsAllocated: 7.5,
  });
  const second = await saveEquipmentBudgetAllocationForItem({
    businessId: 'biz-a', budgetId: 'landscape', equipmentId: 'loader', budgetItemId: 'landscape-loader', monthsAllocated: 5,
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.error, /4.5 months of annual cost responsibility remain/i);
});
