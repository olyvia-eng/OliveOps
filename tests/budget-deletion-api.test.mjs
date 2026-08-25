import test from 'node:test';
import assert from 'node:assert/strict';

import dataHandler from '../api/data.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';

const key = (pk, sk) => `${pk}|${sk}`;

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader() {},
    json(payload) { this.body = payload; return this; },
  };
}

function installDdb(t, { failTransactionAt } = {}) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);
  let transactionCount = 0;
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    if (type === 'DeleteCommand') {
      store.delete(key(input.Key.PK, input.Key.SK));
      return {};
    }
    if (type === 'TransactWriteCommand') {
      transactionCount += 1;
      if (transactionCount === failTransactionAt) throw new Error('Injected transaction failure');
      for (const operation of input.TransactItems) {
        if (operation.Delete) store.delete(key(operation.Delete.Key.PK, operation.Delete.Key.SK));
        if (operation.Put) store.set(key(operation.Put.Item.PK, operation.Put.Item.SK), { ...operation.Put.Item });
      }
      return {};
    }
    return originalSend(command);
  };
  t.after(() => { ddb.send = originalSend; });
  return store;
}

function seedUser(store, { businessId, userId, role = 'admin', email = `${userId}@example.com` }) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), {
    PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId, userId,
    name: userId, email, role, active: true, passwordHash: 'hash', createdAt: '2026-01-01T00:00:00.000Z',
  });
}

async function seedSession({ userId, businessId, role = 'admin', accessToken }) {
  await createMobileSessionForUser({
    user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role, businessName: businessId },
    accessToken,
    expiresInSeconds: 604800,
  });
}

function seedBudget(store, businessId, budgetId, overrides = {}) {
  store.set(key(`BUSINESS#${businessId}`, `BUDGET_META#${budgetId}`), {
    PK: `BUSINESS#${businessId}`, SK: `BUDGET_META#${budgetId}`, entityType: 'BUDGET', businessId, budgetId,
    id: budgetId, name: '2027 Budget', budgetType: 'operating', division: 'company_wide', fiscalYear: '2027',
    planningModel: 'divisions_v1', status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

test('an unused draft Budget deletes all owned records while preserving independent Job snapshots', async (t) => {
  const store = installDdb(t);
  seedUser(store, { businessId: 'biz-a', userId: 'admin-a' });
  await seedSession({ userId: 'admin-a', businessId: 'biz-a', accessToken: 'delete-token-a' });
  seedBudget(store, 'biz-a', 'budget-a', { budgetGroupId: 'group-a' });
  const pk = 'BUSINESS#biz-a';
  const owned = [
    ['BUDGET_DIVISION#budget-a#DIVISION#snow', 'BUDGET_DIVISION'],
    ['BUDGET_DIVISION_PLAN#budget-a#CATEGORY#labour#ITEM#labour-a', 'BUDGET_DIVISION_PLAN'],
    ['BUDGET_DIVISION_PLAN#budget-a#CATEGORY#labour#IDENTITY#labour-a', 'BUDGET_DIVISION_PLAN_IDENTITY'],
    ['BUDGET_RATE#rate-a', 'BUDGET_RATE'],
    ['BUDGET#item-a', 'BUDGET_ITEM'],
    ['LABOUR_BUDGET#labour-legacy-a', 'LABOUR_BUDGET_PLAN'],
    ['LABOUR_HOURS_GOAL#hours-a', 'LABOUR_HOURS_SALES_GOAL'],
    ['REVENUE_GOAL#revenue-a', 'REVENUE_SALES_GOAL'],
    ['EQUIPMENT_ALLOCATION#group-a#equipment-a#budget-a', 'EQUIPMENT_BUDGET_ALLOCATION'],
  ];
  for (const [sk, entityType] of owned) store.set(key(pk, sk), { PK: pk, SK: sk, entityType, businessId: 'biz-a', budgetId: 'budget-a' });
  store.set(key(pk, 'BUDGET_GROUP#group-a'), { PK: pk, SK: 'BUDGET_GROUP#group-a', entityType: 'BUDGET_GROUP', businessId: 'biz-a', budgetGroupId: 'group-a', name: '2027', year: '2027', budgetIds: ['budget-a'] });
  store.set(key(pk, 'JOB#job-a'), {
    PK: pk, SK: 'JOB#job-a', entityType: 'JOB', businessId: 'biz-a', jobId: 'job-a', pricingBudgetId: 'budget-a',
    title: 'Historical Job', status: 'completed', workAreas: [{ id: 'area-a', lineItems: [{ description: 'Labour', sellPrice: 125 }] }],
    originalEstimateSnapshot: { pricingBudgetId: 'budget-a', total: 125 },
  });

  const res = response();
  await dataHandler({ method: 'DELETE', query: { entity: 'budgets', id: 'budget-a' }, headers: { authorization: 'Bearer delete-token-a' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(store.has(key(pk, 'BUDGET_META#budget-a')), false);
  for (const [sk] of owned) assert.equal(store.has(key(pk, sk)), false, `${sk} should be removed`);
  assert.equal(store.has(key(pk, 'BUDGET_GROUP#group-a')), false);
  assert.equal(store.get(key(pk, 'JOB#job-a')).originalEstimateSnapshot.total, 125);
});

test('an Estimate that still requires the live Budget blocks deletion with dependency counts', async (t) => {
  const store = installDdb(t);
  seedUser(store, { businessId: 'biz-a', userId: 'admin-a' });
  await seedSession({ userId: 'admin-a', businessId: 'biz-a', accessToken: 'dependency-token-a' });
  seedBudget(store, 'biz-a', 'budget-a');
  const pk = 'BUSINESS#biz-a';
  store.set(key(pk, 'ESTIMATE#estimate-a'), { PK: pk, SK: 'ESTIMATE#estimate-a', entityType: 'ESTIMATE', businessId: 'biz-a', estimateId: 'estimate-a', title: 'Estimate A', pricingBudgetId: 'budget-a', lineItems: [] });
  store.set(key(pk, 'BUDGET_DIVISION#budget-a#DIVISION#snow'), { PK: pk, SK: 'BUDGET_DIVISION#budget-a#DIVISION#snow', entityType: 'BUDGET_DIVISION', businessId: 'biz-a', budgetId: 'budget-a' });

  const res = response();
  await dataHandler({ method: 'DELETE', query: { entity: 'budgets', id: 'budget-a' }, headers: { authorization: 'Bearer dependency-token-a' } }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'BUDGET_IN_USE');
  assert.deepEqual(res.body.dependencies, { estimates: 1 });
  assert.match(res.body.error, /1 Estimate/);
  assert.equal(store.has(key(pk, 'BUDGET_META#budget-a')), true);
  assert.equal(store.has(key(pk, 'BUDGET_DIVISION#budget-a#DIVISION#snow')), true);
  assert.equal(store.has(key(pk, 'ESTIMATE#estimate-a')), true);
});

test('cross-tenant and unauthorized Budget deletion attempts are rejected without revealing or deleting the Budget', async (t) => {
  const store = installDdb(t);
  seedUser(store, { businessId: 'biz-a', userId: 'admin-a' });
  seedUser(store, { businessId: 'biz-b', userId: 'admin-b' });
  seedUser(store, { businessId: 'biz-a', userId: 'foreman-a', role: 'foreman' });
  await seedSession({ userId: 'admin-b', businessId: 'biz-b', accessToken: 'tenant-token-b' });
  await seedSession({ userId: 'foreman-a', businessId: 'biz-a', role: 'foreman', accessToken: 'foreman-token-a' });
  seedBudget(store, 'biz-a', 'budget-a');

  const foreign = response();
  await dataHandler({ method: 'DELETE', query: { entity: 'budgets', id: 'budget-a' }, headers: { authorization: 'Bearer tenant-token-b' } }, foreign);
  assert.equal(foreign.statusCode, 404);

  const unauthorized = response();
  await dataHandler({ method: 'DELETE', query: { entity: 'budgets', id: 'budget-a' }, headers: { authorization: 'Bearer foreman-token-a' } }, unauthorized);
  assert.equal(unauthorized.statusCode, 403);
  assert.equal(store.has(key('BUSINESS#biz-a', 'BUDGET_META#budget-a')), true);
});

test('an unused active Budget can be deleted because no singleton active-Budget lifecycle exists', async (t) => {
  const store = installDdb(t);
  seedUser(store, { businessId: 'biz-a', userId: 'admin-a' });
  await seedSession({ userId: 'admin-a', businessId: 'biz-a', accessToken: 'active-token-a' });
  seedBudget(store, 'biz-a', 'budget-active', { status: 'active' });

  const res = response();
  await dataHandler({ method: 'DELETE', query: { entity: 'budgets', id: 'budget-active' }, headers: { authorization: 'Bearer active-token-a' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.has(key('BUSINESS#biz-a', 'BUDGET_META#budget-active')), false);
});

test('large cascades keep the parent on a failed batch and complete deterministically on retry', async (t) => {
  const store = installDdb(t, { failTransactionAt: 2 });
  seedUser(store, { businessId: 'biz-a', userId: 'admin-a' });
  await seedSession({ userId: 'admin-a', businessId: 'biz-a', accessToken: 'retry-token-a' });
  seedBudget(store, 'biz-a', 'budget-large');
  const pk = 'BUSINESS#biz-a';
  for (let index = 0; index < 105; index += 1) {
    const sk = `BUDGET_RATE#rate-${String(index).padStart(3, '0')}`;
    store.set(key(pk, sk), { PK: pk, SK: sk, entityType: 'BUDGET_RATE', businessId: 'biz-a', budgetId: 'budget-large' });
  }

  const failed = response();
  await dataHandler({ method: 'DELETE', query: { entity: 'budgets', id: 'budget-large' }, headers: { authorization: 'Bearer retry-token-a' } }, failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(store.has(key(pk, 'BUDGET_META#budget-large')), true);
  assert.equal([...store.values()].filter((item) => item.entityType === 'BUDGET_RATE' && item.budgetId === 'budget-large').length, 5);

  const retried = response();
  await dataHandler({ method: 'DELETE', query: { entity: 'budgets', id: 'budget-large' }, headers: { authorization: 'Bearer retry-token-a' } }, retried);
  assert.equal(retried.statusCode, 200);
  assert.equal(store.has(key(pk, 'BUDGET_META#budget-large')), false);
  assert.equal([...store.values()].some((item) => item.budgetId === 'budget-large'), false);
});