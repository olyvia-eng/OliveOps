import test from 'node:test';
import assert from 'node:assert/strict';
import planningHandler from '../api/budget-division-plans.js';
import importHandler from '../api/budget-division-import.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';
import { readFileSync } from 'node:fs';

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
    if (type === 'DeleteCommand') { store.delete(key(input.Key.PK, input.Key.SK)); return {}; }
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    if (type === 'TransactWriteCommand') {
      for (const operation of input.TransactItems) {
        const write = operation.Put ?? operation.Delete;
        const targetKey = key((write.Item ?? write.Key).PK, (write.Item ?? write.Key).SK);
        if (operation.Put?.ConditionExpression?.includes('attribute_not_exists') && store.has(targetKey)) {
          const error = new Error('duplicate'); error.name = 'TransactionCanceledException'; throw error;
        }
        if (operation.Put?.ConditionExpression?.includes('attribute_exists') && !store.has(targetKey)) {
          const error = new Error('missing'); error.name = 'TransactionCanceledException'; throw error;
        }
      }
      for (const operation of input.TransactItems) {
        if (operation.Put) store.set(key(operation.Put.Item.PK, operation.Put.Item.SK), { ...operation.Put.Item });
        if (operation.Delete) store.delete(key(operation.Delete.Key.PK, operation.Delete.Key.SK));
      }
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

function seedTenant(store, { businessId = 'biz-a', userId = 'user-a', role = 'admin', token = 'token-a' } = {}) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), { PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId, userId, name: 'User', email: `${userId}@example.com`, role, active: true, passwordHash: 'hash', createdAt: '2026-01-01T00:00:00.000Z' });
  return createMobileSessionForUser({ user: { id: userId, businessId, name: 'User', email: `${userId}@example.com`, role, businessName: businessId }, accessToken: token, expiresInSeconds: 3600 });
}

function seedBudget(store, businessId, id, year, planningModel = 'divisions_v1') {
  store.set(key(`BUSINESS#${businessId}`, `BUDGET_META#${id}`), { PK: `BUSINESS#${businessId}`, SK: `BUDGET_META#${id}`, entityType: 'BUDGET', businessId, budgetId: id, name: `${year} Operating Budget`, budgetType: 'operating', division: 'company_wide', fiscalYear: year, planningModel, status: 'active', createdAt: `${year}-01-01T00:00:00.000Z`, updatedAt: `${year}-01-01T00:00:00.000Z` });
}

function seedDivision(store, businessId, budgetId, id, name = 'Landscaping') {
  store.set(key(`BUSINESS#${businessId}`, `BUDGET_DIVISION#${budgetId}#DIVISION#${id}`), { PK: `BUSINESS#${businessId}`, SK: `BUDGET_DIVISION#${budgetId}#DIVISION#${id}`, entityType: 'BUDGET_DIVISION', businessId, budgetId, divisionId: id, name, revenueTarget: 0, status: 'active', sortOrder: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
}

test('Division planner imports selected source items with new ids and blocks repeated duplicates', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-2026', '2026');
  seedBudget(store, 'biz-a', 'budget-2027', '2027');
  seedDivision(store, 'biz-a', 'budget-2026', 'division-source');
  seedDivision(store, 'biz-a', 'budget-2027', 'division-target');

  const createRes = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-2026', divisionId: 'division-source', category: 'subcontractors' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Concrete Supplier', rate: 125, plannedQuantity: 10, plannedAmount: 1250 } } }, createRes);
  assert.equal(createRes.statusCode, 200);
  const sourceId = createRes.body.item.id;

  const optionsRes = response();
  await importHandler({ method: 'GET', query: { budgetId: 'budget-2027', divisionId: 'division-target', category: 'subcontractors' }, headers: { authorization: 'Bearer token-a' } }, optionsRes);
  assert.equal(optionsRes.body.recommendedSourceBudgetId, 'budget-2026');
  assert.deepEqual(optionsRes.body.sourceBudgets[0].divisions.map((item) => item.name), ['Landscaping']);

  const previewRes = response();
  await importHandler({ method: 'GET', query: { budgetId: 'budget-2027', divisionId: 'division-target', category: 'subcontractors', sourceBudgetId: 'budget-2026', sourceDivisionId: 'division-source' }, headers: { authorization: 'Bearer token-a' } }, previewRes);
  assert.equal(previewRes.body.items[0].name, 'Concrete Supplier');
  assert.equal(previewRes.body.items[0].alreadyAdded, false);

  const importRes = response();
  await importHandler({ method: 'POST', query: {}, headers: { authorization: 'Bearer token-a' }, body: { budgetId: 'budget-2027', divisionId: 'division-target', category: 'subcontractors', sourceBudgetId: 'budget-2026', sourceDivisionId: 'division-source', sourceItemIds: [previewRes.body.items[0].sourceItemId] } }, importRes);
  assert.equal(importRes.statusCode, 200);
  assert.equal(importRes.body.importedCount, 1);
  assert.notEqual(importRes.body.items[0].id, sourceId);
  assert.equal(importRes.body.items[0].budgetId, 'budget-2027');
  assert.equal(importRes.body.items[0].divisionId, 'division-target');

  const sourceListRes = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-2026', divisionId: 'division-source', category: 'subcontractors' }, headers: { authorization: 'Bearer token-a' } }, sourceListRes);
  assert.equal(sourceListRes.body.items[0].rate, 125);
  assert.equal(sourceListRes.body.items[0].id, sourceId);

  const repeatPreview = response();
  await importHandler({ method: 'GET', query: { budgetId: 'budget-2027', divisionId: 'division-target', category: 'subcontractors', sourceBudgetId: 'budget-2026', sourceDivisionId: 'division-source' }, headers: { authorization: 'Bearer token-a' } }, repeatPreview);
  assert.equal(repeatPreview.body.items[0].alreadyAdded, true);
});

test('Division planning rejects mismatched tenants and unauthorized writers', async (t) => {
  const store = installDdb(t);
  await seedTenant(store, { businessId: 'biz-a', userId: 'admin-a', token: 'admin-a-token' });
  await seedTenant(store, { businessId: 'biz-b', userId: 'foreman-b', role: 'foreman', token: 'foreman-b-token' });
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'division-a');
  seedBudget(store, 'biz-b', 'budget-b', '2027');
  seedDivision(store, 'biz-b', 'budget-b', 'division-b');

  const foreignRes = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'division-a', category: 'materials' }, headers: { authorization: 'Bearer foreman-b-token' }, body: { data: { name: 'Topsoil', unit: 'yard', unitCost: 40 } } }, foreignRes);
  assert.equal(foreignRes.statusCode, 403);

  const crossTenantImport = response();
  await importHandler({ method: 'POST', query: {}, headers: { authorization: 'Bearer admin-a-token' }, body: { budgetId: 'budget-a', divisionId: 'division-a', category: 'materials', sourceBudgetId: 'budget-b', sourceDivisionId: 'division-b', sourceItemIds: ['anything'] } }, crossTenantImport);
  assert.equal(crossTenantImport.statusCode, 404);
});

test('Labour planning validates classification, overtime, and exact same-Budget Division allocation', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'land', 'Landscaping');
  seedDivision(store, 'biz-a', 'budget-a', 'snow', 'Snow Removal');
  seedBudget(store, 'biz-a', 'budget-other', '2027');
  seedDivision(store, 'biz-a', 'budget-other', 'foreign-division', 'Excavation');

  const valid = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: {
    name: 'Operator', compType: 'hourly', hourlyRate: 30, plannedHours: 2000,
    labourClassification: 'billable', expectedBillablePct: 80, overtimeHours: 120, overtimeMultiplier: 1.5,
    divisionAllocations: [{ divisionId: 'land', percentage: 60 }, { divisionId: 'snow', percentage: 40 }],
  } } }, valid);
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.item.divisionAllocations.length, 2);

  const overBillable = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Labourer', expectedBillablePct: 101, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'land', percentage: 100 }] } } }, overBillable);
  assert.equal(overBillable.statusCode, 400);

  const invalidMultiplier = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Installer', overtimeMultiplier: 0.5, divisionAllocations: [{ divisionId: 'land', percentage: 100 }] } } }, invalidMultiplier);
  assert.equal(invalidMultiplier.statusCode, 400);

  const incomplete = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Foreman', overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'land', percentage: 80 }] } } }, incomplete);
  assert.equal(incomplete.statusCode, 400);

  const crossBudget = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Estimator', overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'foreign-division', percentage: 100 }] } } }, crossBudget);
  assert.equal(crossBudget.statusCode, 400);
  assert.match(crossBudget.body.error, /belong to this Budget/);
});

test('non-financial roles cannot retrieve Labour planning costs from endpoint or bootstrap', async (t) => {
  const store = installDdb(t);
  await seedTenant(store, { businessId: 'biz-a', userId: 'foreman-a', role: 'foreman', token: 'foreman-a-token' });
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'land');
  const getRes = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer foreman-a-token' } }, getRes);
  assert.equal(getRes.statusCode, 403);
  const bootstrapSource = readFileSync('api/bootstrap.js', 'utf8');
  assert.match(bootstrapSource, /session\.role === 'owner' \|\| session\.role === 'admin' \? budgetDivisionPlanningItems : \[\]/);
});