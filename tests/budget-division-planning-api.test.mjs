import test from 'node:test';
import assert from 'node:assert/strict';
import planningHandler from '../api/budget-division-plans.js';
import importHandler from '../api/budget-division-import.js';
import overheadMigrationHandler from '../api/budget-overhead-migration.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';
import { readFileSync } from 'node:fs';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } });

function installDdb(t, { failTransactions = false } = {}) {
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
      if (failTransactions) {
        const error = new Error('forced transaction failure'); error.name = 'TransactionCanceledException'; throw error;
      }
      for (const operation of input.TransactItems) {
        const write = operation.Put ?? operation.Delete;
        const targetKey = key((write.Item ?? write.Key).PK, (write.Item ?? write.Key).SK);
        const existing = store.get(targetKey);
        const preservesIdentityOwner = operation.Put?.ConditionExpression?.includes('planningItemId = :planningItemId')
          && existing?.planningItemId === operation.Put.ExpressionAttributeValues?.[':planningItemId'];
        if (operation.Put?.ConditionExpression?.includes('attribute_not_exists') && store.has(targetKey) && !preservesIdentityOwner) {
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

function seedEquipment(store, businessId, id) {
  store.set(key(`BUSINESS#${businessId}`, `EQUIPMENT#${id}`), { PK: `BUSINESS#${businessId}`, SK: `EQUIPMENT#${id}`, entityType: 'EQUIPMENT', businessId, equipmentId: id, name: 'Bobcat E50', type: 'Excavator', status: 'available', costType: 'financed', equipmentClassification: 'billable', serialNumber: '', hourlyCost: 0, notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
}

function seedEmployee(store, businessId, id, name = 'Ryan Field') {
  store.set(key(`BUSINESS#${businessId}`, `EMPLOYEE#${id}`), { PK: `BUSINESS#${businessId}`, SK: `EMPLOYEE#${id}`, entityType: 'EMPLOYEE', businessId, employeeId: id, name, email: `${id}@example.com`, phone: '', role: 'Operator', hourlyRate: 45, compensationType: 'hourly', labourType: 'field_producing', active: true, createdAt: '2026-01-01T00:00:00.000Z' });
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
    labourClassification: 'billable', fieldProducingPct: 60, expectedBillablePct: 80, overtimeHours: 120, overtimeMultiplier: 1.5,
    divisionAllocations: [{ divisionId: 'land', hours: 1200 }, { divisionId: 'snow', hours: 800 }],
  } } }, valid);
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.item.fieldProducingPct, 60);
  assert.equal(valid.body.item.divisionAllocations.length, 2);

  const overBillable = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Labourer', plannedHours: 1900, expectedBillablePct: 101, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'land', hours: 1900 }] } } }, overBillable);
  assert.equal(overBillable.statusCode, 400);

  const invalidFieldPct = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Foreman', plannedHours: 1900, fieldProducingPct: 101, expectedBillablePct: 80, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'land', hours: 1900 }] } } }, invalidFieldPct);
  assert.equal(invalidFieldPct.statusCode, 400);
  assert.match(invalidFieldPct.body.error, /Field-producing percent cannot exceed 100/);

  const malformedFieldPct = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Foreman', plannedHours: 1900, fieldProducingPct: 'sixty', expectedBillablePct: 80, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'land', hours: 1900 }] } } }, malformedFieldPct);
  assert.equal(malformedFieldPct.statusCode, 400);
  assert.match(malformedFieldPct.body.error, /fieldProducingPct must be zero or greater/);

  const invalidMultiplier = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Installer', plannedHours: 1900, overtimeMultiplier: 0.5, divisionAllocations: [{ divisionId: 'land', hours: 1900 }] } } }, invalidMultiplier);
  assert.equal(invalidMultiplier.statusCode, 400);

  const incomplete = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Foreman', plannedHours: 2000, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'land', hours: 1600 }] } } }, incomplete);
  assert.equal(incomplete.statusCode, 400);

  const crossBudget = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'land', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Estimator', plannedHours: 1900, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'foreign-division', hours: 1900 }] } } }, crossBudget);
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

test('Equipment planning validates one same-Budget asset allocation across Divisions', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape', 'Hardscaping');
  seedDivision(store, 'biz-a', 'budget-a', 'snow', 'Snow Removal');
  seedBudget(store, 'biz-a', 'budget-other', '2027');
  seedDivision(store, 'biz-a', 'budget-other', 'foreign', 'Foreign');
  seedEquipment(store, 'biz-a', 'equipment-1');

  const valid = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Bobcat E50', equipmentId: 'equipment-1', costType: 'financed', classification: 'billable', equipmentPayment: 2000, equipmentPaymentFrequencyPerYear: 12, yearlyFuelCost: 10000, yearlyInsuranceCost: 3000, yearlyMaintenanceCost: 4000, sellableHoursPerYear: 1200, equipmentHoursPerDay: 8, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 7 }, { divisionId: 'snow', months: 5 }] } } }, valid);
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(valid.body.item.equipmentDivisionAllocations, [{ divisionId: 'hardscape', months: 7 }, { divisionId: 'snow', months: 5 }]);
  assert.equal(valid.body.item.equipmentPaymentFrequencyPerYear, 12);

  const incomplete = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Bobcat E50', equipmentId: 'equipment-1', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 7 }] } } }, incomplete);
  assert.equal(incomplete.statusCode, 400);
  assert.match(incomplete.body.error, /total 12 months/);

  const foreign = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Bobcat E50', equipmentId: 'equipment-1', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 7 }, { divisionId: 'foreign', months: 5 }] } } }, foreign);
  assert.equal(foreign.statusCode, 400);
  assert.match(foreign.body.error, /belong to this Budget/);
});

test('one employee Labour item is shared across allocated Divisions and remains one Budget record', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape', 'Hardscaping');
  seedDivision(store, 'biz-a', 'budget-a', 'snow', 'Snow Removal');
  seedEmployee(store, 'biz-a', 'ryan');

  const created = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: {
    employeeId: 'ryan', name: 'Ryan Field', compType: 'salaried', annualSalary: 90000, plannedHours: 2000,
    labourClassification: 'billable', expectedBillablePct: 80, overtimeHours: 0, overtimeMultiplier: 1.5,
    divisionAllocations: [{ divisionId: 'hardscape', hours: 1200 }, { divisionId: 'snow', hours: 800 }],
  } } }, created);
  assert.equal(created.statusCode, 200);
  const labourItemId = created.body.item.id;
  assert.ok(store.has(key('BUSINESS#biz-a', `BUDGET_DIVISION_PLAN#budget-a#CATEGORY#labour#ITEM#${labourItemId}`)));
  assert.equal([...store.values()].filter((item) => item.entityType === 'BUDGET_DIVISION_PLAN' && item.category === 'labour').length, 1);

  const hardscape = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'labour' }, headers: { authorization: 'Bearer token-a' } }, hardscape);
  const snow = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'labour' }, headers: { authorization: 'Bearer token-a' } }, snow);
  assert.equal(hardscape.body.items[0].id, labourItemId);
  assert.equal(snow.body.items[0].id, labourItemId);
  assert.equal(hardscape.body.items[0].divisionAllocations.find((item) => item.divisionId === 'hardscape').hours, 1200);
  assert.equal(snow.body.items[0].divisionAllocations.find((item) => item.divisionId === 'snow').hours, 800);

  const duplicate = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { data: { employeeId: 'ryan', name: 'Ryan Field', plannedHours: 1900, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'snow', hours: 1900 }] } } }, duplicate);
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.body.error, /already in the Budget/);

  const editedFromSnow = response();
  await planningHandler({ method: 'PATCH', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'labour', id: labourItemId }, headers: { authorization: 'Bearer token-a' }, body: { data: { divisionAllocations: [{ divisionId: 'hardscape', hours: 1000 }, { divisionId: 'snow', hours: 1000 }] } } }, editedFromSnow);
  assert.equal(editedFromSnow.statusCode, 200);
  assert.equal(editedFromSnow.body.item.id, labourItemId);
  assert.deepEqual(editedFromSnow.body.item.divisionAllocations, [{ divisionId: 'hardscape', hours: 1000 }, { divisionId: 'snow', hours: 1000 }]);
  assert.equal([...store.values()].filter((item) => item.entityType === 'BUDGET_DIVISION_PLAN' && item.category === 'labour').length, 1);

  const removeSnowAllocation = response();
  await planningHandler({ method: 'PATCH', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'labour', id: labourItemId }, headers: { authorization: 'Bearer token-a' }, body: { data: { divisionAllocations: [{ divisionId: 'hardscape', hours: 2000 }, { divisionId: 'snow', hours: 0 }] } } }, removeSnowAllocation);
  assert.equal(removeSnowAllocation.statusCode, 200);
  const snowAfter = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'labour' }, headers: { authorization: 'Bearer token-a' } }, snowAfter);
  assert.deepEqual(snowAfter.body.items, []);
  const hardscapeAfter = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'labour' }, headers: { authorization: 'Bearer token-a' } }, hardscapeAfter);
  assert.equal(hardscapeAfter.body.items[0].id, labourItemId);
});

test('legacy Division-scoped Labour migrates on budget-wide reorder and deletes all key forms', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape', 'Hardscaping');
  seedDivision(store, 'biz-a', 'budget-a', 'snow', 'Snow Removal');
  seedEmployee(store, 'biz-a', 'ryan');
  const legacyItemSk = 'BUDGET_DIVISION_PLAN#budget-a#DIVISION#hardscape#CATEGORY#labour#ITEM#legacy-ryan';
  const legacyIdentitySk = `BUDGET_DIVISION_PLAN#budget-a#DIVISION#hardscape#CATEGORY#labour#IDENTITY#${Buffer.from('employee:ryan').toString('base64url')}`;
  store.set(key('BUSINESS#biz-a', legacyItemSk), {
    PK: 'BUSINESS#biz-a', SK: legacyItemSk, entityType: 'BUDGET_DIVISION_PLAN', businessId: 'biz-a', planningItemId: 'legacy-ryan',
    id: 'legacy-ryan', budgetId: 'budget-a', divisionId: 'hardscape', category: 'labour', employeeId: 'ryan', name: 'Ryan Field',
    compType: 'salaried', annualSalary: 90000, plannedHours: 2000, labourClassification: 'billable', expectedBillablePct: 80,
    divisionAllocations: [{ divisionId: 'hardscape', percentage: 100 }], sortOrder: 0,
  });
  store.set(key('BUSINESS#biz-a', legacyIdentitySk), { PK: 'BUSINESS#biz-a', SK: legacyIdentitySk, entityType: 'BUDGET_DIVISION_PLAN_IDENTITY', planningItemId: 'legacy-ryan' });

  const reorder = response();
  await planningHandler({ method: 'PUT', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'labour' }, headers: { authorization: 'Bearer token-a' }, body: { orderedIds: ['legacy-ryan'] } }, reorder);
  assert.equal(reorder.statusCode, 200);
  assert.equal(reorder.body.items[0].id, 'legacy-ryan');

  const edited = response();
  await planningHandler({ method: 'PATCH', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'labour', id: 'legacy-ryan' }, headers: { authorization: 'Bearer token-a' }, body: { data: { divisionAllocations: [{ divisionId: 'hardscape', hours: 1000 }, { divisionId: 'snow', hours: 1000 }] } } }, edited);
  assert.equal(edited.statusCode, 200);
  const canonicalItemSk = 'BUDGET_DIVISION_PLAN#budget-a#CATEGORY#labour#ITEM#legacy-ryan';
  const canonicalIdentitySk = `BUDGET_DIVISION_PLAN#budget-a#CATEGORY#labour#IDENTITY#${Buffer.from('employee:ryan').toString('base64url')}`;
  assert.ok(store.has(key('BUSINESS#biz-a', canonicalItemSk)));
  assert.ok(store.has(key('BUSINESS#biz-a', canonicalIdentitySk)));
  assert.equal(store.has(key('BUSINESS#biz-a', legacyItemSk)), false);
  assert.equal(store.has(key('BUSINESS#biz-a', legacyIdentitySk)), false);

  const deleted = response();
  await planningHandler({ method: 'DELETE', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'labour', id: 'legacy-ryan' }, headers: { authorization: 'Bearer token-a' } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(store.has(key('BUSINESS#biz-a', canonicalItemSk)), false);
  assert.equal(store.has(key('BUSINESS#biz-a', canonicalIdentitySk)), false);
  assert.equal([...store.values()].filter((item) => item.entityType === 'BUDGET_DIVISION_PLAN' && item.category === 'labour').length, 0);
});

test('shared Overhead is stored once and remains readable from every allocated Division', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape', 'Hardscaping');
  seedDivision(store, 'biz-a', 'budget-a', 'snow', 'Snow Removal');

  const created = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'overhead' }, headers: { authorization: 'Bearer token-a' }, body: { data: { name: 'Shop / Yard', description: 'Shop / Yard', costCode: 'OH-100', plannedAmount: 18000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] } } }, created);
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.item.category, 'overhead');
  assert.ok(store.has(key('BUSINESS#biz-a', `BUDGET_DIVISION_PLAN#budget-a#CATEGORY#overhead#ITEM#${created.body.item.id}`)));

  const listed = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'overhead' }, headers: { authorization: 'Bearer token-a' } }, listed);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.items[0].description, 'Shop / Yard');
  assert.equal(listed.body.items[0].plannedAmount, 18000);

  const snowListed = response();
  await planningHandler({ method: 'GET', query: { budgetId: 'budget-a', divisionId: 'snow', category: 'overhead' }, headers: { authorization: 'Bearer token-a' } }, snowListed);
  assert.equal(snowListed.statusCode, 200);
  assert.equal(snowListed.body.items[0].id, created.body.item.id);
});

test('legacy top-level overhead normalizes once and retains its source record', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'snow', 'Snow Removal');
  seedDivision(store, 'biz-a', 'budget-a', 'landscape', 'Landscaping');
  seedDivision(store, 'biz-a', 'budget-a', 'excavation', 'Excavation');
  const legacyKey = key('BUSINESS#biz-a', 'BUDGET#secretary');
  store.set(legacyKey, { PK: 'BUSINESS#biz-a', SK: 'BUDGET#secretary', entityType: 'BUDGET_ITEM', businessId: 'biz-a', budgetItemId: 'secretary', id: 'secretary', budgetId: 'budget-a', category: 'overhead', description: 'Secretary', costCode: 'OH-ADMIN', budgeted: 60000, actual: 0, period: '2027-01' });

  const first = response();
  await overheadMigrationHandler({ method: 'POST', headers: { authorization: 'Bearer token-a' }, body: { budgetId: 'budget-a' } }, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.migratedCount, 1);
  assert.equal(first.body.legacyRecordsRetained, 1);
  assert.deepEqual(first.body.items[0].overheadDivisionAllocations.map((allocation) => allocation.percentage), [33.33, 33.33, 33.34]);
  assert.equal(store.has(legacyKey), true);

  const second = response();
  await overheadMigrationHandler({ method: 'POST', headers: { authorization: 'Bearer token-a' }, body: { budgetId: 'budget-a' } }, second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.migratedCount, 0);
  assert.equal(second.body.items.length, 1);
});

test('Budget equipment save atomically updates approved Catalog identity and Budget assumptions', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape');
  seedEquipment(store, 'biz-a', 'equipment-1');
  const assetKey = key('BUSINESS#biz-a', 'EQUIPMENT#equipment-1');
  store.get(assetKey).serialNumber = 'SERIAL-1';
  store.get(assetKey).notes = 'Preserve this';

  const create = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: {
    catalogPatch: { name: 'Bobcat E60', type: 'Mini Excavator', equipmentClassification: 'overhead', costType: 'owned' },
    data: { equipmentId: 'equipment-1', expectedReplacementCost: 120000, expectedResaleValue: 30000, remainingUsefulMonths: 60, plannedAmount: 18000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12 }] },
  } }, create);

  assert.equal(create.statusCode, 200);
  assert.equal(create.body.equipmentAsset.name, 'Bobcat E60');
  assert.equal(create.body.equipmentAsset.serialNumber, 'SERIAL-1');
  assert.equal(create.body.equipmentAsset.notes, 'Preserve this');
  assert.equal(create.body.item.expectedReplacementCost, 120000);
  assert.equal(create.body.item.name, undefined);
  assert.equal(create.body.item.classification, undefined);
  assert.equal(create.body.item.costType, undefined);
  assert.equal(store.get(assetKey).name, 'Bobcat E60');
});

test('Budget equipment transaction failure leaves Catalog and Budget planning unchanged', async (t) => {
  const store = installDdb(t, { failTransactions: true });
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape');
  seedEquipment(store, 'biz-a', 'equipment-1');
  const assetKey = key('BUSINESS#biz-a', 'EQUIPMENT#equipment-1');

  const failed = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: {
    catalogPatch: { name: 'Unsaved Rename', type: 'Loader', equipmentClassification: 'overhead', costType: 'owned' },
    data: { equipmentId: 'equipment-1', yearlyFuelCost: 9000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12 }] },
  } }, failed);

  assert.equal(failed.statusCode, 409);
  assert.equal(store.get(assetKey).name, 'Bobcat E50');
  assert.equal([...store.values()].some((item) => item.entityType === 'BUDGET_DIVISION_PLAN'), false);
});

test('Budget equipment save atomically creates a new Catalog asset without storing Budget economics on it', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape');

  const create = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: {
    createEquipmentAsset: true,
    catalogPatch: { name: 'Plate Compactor', type: 'Compaction', equipmentClassification: 'billable', costType: 'owned' },
    data: { expectedReplacementCost: 12000, expectedResaleValue: 2000, remainingUsefulMonths: 40, yearlyMaintenanceCost: 500, plannedAmount: 3500, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12 }] },
  } }, create);

  assert.equal(create.statusCode, 200);
  assert.equal(create.body.item.equipmentId, create.body.equipmentAsset.id);
  assert.equal(create.body.equipmentAsset.expectedReplacementCost, undefined);
  assert.equal(create.body.equipmentAsset.yearlyMaintenanceCost, undefined);
  assert.ok(store.has(key('BUSINESS#biz-a', `EQUIPMENT#${create.body.equipmentAsset.id}`)));
  assert.ok([...store.values()].some((item) => item.entityType === 'BUDGET_DIVISION_PLAN' && item.equipmentId === create.body.equipmentAsset.id));
});

test('Budget equipment replacement and Catalog patch validation reject invalid or non-owned fields', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-a', '2027');
  seedDivision(store, 'biz-a', 'budget-a', 'hardscape');
  seedEquipment(store, 'biz-a', 'equipment-1');
  const base = { equipmentId: 'equipment-1', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12 }] };
  const patch = { name: 'Bobcat', type: 'Excavator', equipmentClassification: 'billable', costType: 'owned' };

  const resale = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: { catalogPatch: patch, data: { ...base, expectedReplacementCost: 10000, expectedResaleValue: 10001, remainingUsefulMonths: 12 } } }, resale);
  assert.equal(resale.statusCode, 400);
  assert.equal(resale.body.error, 'Expected resale value cannot exceed expected replacement cost.');

  const months = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: { catalogPatch: patch, data: { ...base, expectedReplacementCost: 10000, expectedResaleValue: 10000, remainingUsefulMonths: 0 } } }, months);
  assert.equal(months.statusCode, 400);
  assert.equal(months.body.error, 'Remaining useful months must be greater than zero.');

  const unsupported = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-a', divisionId: 'hardscape', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: { catalogPatch: { ...patch, yearlyFuelCost: 999 }, data: base } }, unsupported);
  assert.equal(unsupported.statusCode, 400);
  assert.match(unsupported.body.error, /cannot be changed from Budget planning/);
});

test('equipment import copies replacement assumptions and authoritative planned amount exactly', async (t) => {
  const store = installDdb(t);
  await seedTenant(store);
  seedBudget(store, 'biz-a', 'budget-2026', '2026');
  seedBudget(store, 'biz-a', 'budget-2027', '2027');
  seedDivision(store, 'biz-a', 'budget-2026', 'source');
  seedDivision(store, 'biz-a', 'budget-2027', 'target');
  seedEquipment(store, 'biz-a', 'equipment-1');
  const created = response();
  await planningHandler({ method: 'POST', query: { budgetId: 'budget-2026', divisionId: 'source', category: 'equipment' }, headers: { authorization: 'Bearer token-a' }, body: { catalogPatch: {
    name: 'Bobcat E50', type: 'Excavator', equipmentClassification: 'billable', costType: 'owned',
  }, data: {
    equipmentId: 'equipment-1', expectedReplacementCost: 90000, expectedResaleValue: 18000, remainingUsefulMonths: 48, plannedAmount: 25000,
    equipmentDivisionAllocations: [{ divisionId: 'source', months: 12 }],
  } } }, created);
  assert.equal(created.body.item.plannedAmount, 18000);
  const preview = response();
  await importHandler({ method: 'GET', query: { budgetId: 'budget-2027', divisionId: 'target', category: 'equipment', sourceBudgetId: 'budget-2026', sourceDivisionId: 'source' }, headers: { authorization: 'Bearer token-a' } }, preview);
  const imported = response();
  await importHandler({ method: 'POST', query: {}, headers: { authorization: 'Bearer token-a' }, body: { budgetId: 'budget-2027', divisionId: 'target', category: 'equipment', sourceBudgetId: 'budget-2026', sourceDivisionId: 'source', sourceItemIds: [preview.body.items[0].sourceItemId] } }, imported);
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.body.items[0].expectedReplacementCost, 90000);
  assert.equal(imported.body.items[0].expectedResaleValue, 18000);
  assert.equal(imported.body.items[0].remainingUsefulMonths, 48);
  assert.equal(imported.body.items[0].plannedAmount, 18000);
});