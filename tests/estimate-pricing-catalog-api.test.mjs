import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/estimate-pricing-catalog.js';
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
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

const put = (store, businessId, sk, item) => store.set(key(`BUSINESS#${businessId}`, sk), { PK: `BUSINESS#${businessId}`, SK: sk, businessId, ...item });

function seedPlanningItem(store, item) {
  const sk = item.category === 'labour'
    ? `BUDGET_DIVISION_PLAN#${item.budgetId}#CATEGORY#labour#ITEM#${item.id}`
    : `BUDGET_DIVISION_PLAN#${item.budgetId}#DIVISION#${item.divisionId}#CATEGORY#${item.category}#ITEM#${item.id}`;
  put(store, 'biz-a', sk, { entityType: 'BUDGET_DIVISION_PLAN', planningItemId: item.id, ...item });
}

function seedRate(store, rate) {
  put(store, 'biz-a', `BUDGET_RATE#${rate.id}`, { entityType: 'BUDGET_RATE', rateId: rate.id, itemName: rate.id, description: '', defaultMarkupPercent: 0, active: true, sortOrder: 0, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', ...rate });
}

test('Estimate pricing endpoint returns persisted shared Budget items and approved rates', async (t) => {
  const store = installDdb(t);
  put(store, 'biz-a', 'USER#admin-a', { entityType: 'USER', userId: 'admin-a', name: 'Admin', email: 'admin@example.com', role: 'admin', active: true, sessionVersion: 0 });
  await createMobileSessionForUser({ user: { id: 'admin-a', businessId: 'biz-a', name: 'Admin', email: 'admin@example.com', role: 'admin', businessName: 'OliveOps' }, accessToken: 'token-a', expiresInSeconds: 3600 });
  put(store, 'biz-a', 'BUDGET_META#budget-2027', { entityType: 'BUDGET', budgetId: 'budget-2027', name: '2027 annual', fiscalYear: '2027', planningModel: 'divisions_v1', status: 'active' });
  put(store, 'biz-a', 'ESTIMATE#estimate-a', { entityType: 'ESTIMATE', estimateId: 'estimate-a', pricingBudgetId: 'budget-2027', title: 'Dig out area' });
  for (const employee of [{ id: 'ryan', name: 'Ryan Field' }, { id: 'john', name: 'John Field' }]) put(store, 'biz-a', `EMPLOYEE#${employee.id}`, { entityType: 'EMPLOYEE', employeeId: employee.id, active: true, ...employee });
  for (const equipment of [{ id: 'bobcat', name: 'Bobcat E50' }, { id: 'truck', name: 'Dump Truck' }]) put(store, 'biz-a', `EQUIPMENT#${equipment.id}`, { entityType: 'EQUIPMENT', equipmentId: equipment.id, status: 'available', type: 'Equipment', ...equipment });
  put(store, 'biz-a', 'MATERIAL#gravel', { entityType: 'MATERIAL_CATALOG_ITEM', materialId: 'gravel', id: 'gravel', name: 'A Gravel', unit: 'tonne', active: true });

  const items = [
    { id: 'labour-ryan', budgetId: 'budget-2027', divisionId: 'hardscape', category: 'labour', employeeId: 'ryan', name: 'Ryan Field', divisionAllocations: [{ divisionId: 'hardscape', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] },
    { id: 'labour-john', budgetId: 'budget-2027', divisionId: 'hardscape', category: 'labour', employeeId: 'john', name: 'John Field', divisionAllocations: [{ divisionId: 'hardscape', percentage: 100 }] },
    { id: 'equipment-bobcat', budgetId: 'budget-2027', divisionId: 'hardscape', category: 'equipment', equipmentId: 'bobcat', name: 'Bobcat E50' },
    { id: 'equipment-truck', budgetId: 'budget-2027', divisionId: 'snow', category: 'equipment', equipmentId: 'truck', name: 'Dump Truck' },
    { id: 'material-gravel', budgetId: 'budget-2027', divisionId: 'hardscape', category: 'materials', materialCatalogItemId: 'gravel', name: 'A Gravel', unit: 'tonne' },
    { id: 'sub-concrete', budgetId: 'budget-2027', divisionId: 'hardscape', category: 'subcontractors', name: 'Concrete Co', unit: 'hr' },
  ];
  items.forEach((item) => seedPlanningItem(store, item));
  [
    { id: 'rate-ryan', budgetId: 'budget-2027', budgetItemId: 'labour-ryan', employeeId: 'ryan', category: 'labour', unit: 'hr', unitCost: 42, recommendedSellPrice: 70, defaultSellPrice: 72 },
    { id: 'rate-john', budgetId: 'budget-2027', employeeId: 'john', category: 'labour', unit: 'hr', unitCost: 38, recommendedSellPrice: 63, defaultSellPrice: 65 },
    { id: 'rate-bobcat', budgetId: 'budget-2027', equipmentId: 'bobcat', category: 'equipment', unit: 'hr', unitCost: 55, recommendedSellPrice: 92, defaultSellPrice: 95 },
    { id: 'rate-truck', budgetId: 'budget-2027', budgetItemId: 'equipment-truck', category: 'equipment', unit: 'hr', unitCost: 90, recommendedSellPrice: 145, defaultSellPrice: 150 },
    { id: 'rate-gravel', budgetId: 'budget-2027', materialCatalogItemId: 'gravel', category: 'material', unit: 'tonne', unitCost: 28, recommendedSellPrice: 44, defaultSellPrice: 46 },
    { id: 'rate-concrete', budgetId: 'budget-2027', budgetItemId: 'sub-concrete', category: 'subcontractor', unit: 'hr', unitCost: 100, recommendedSellPrice: 130, defaultSellPrice: 135 },
  ].forEach((rate) => seedRate(store, rate));

  const res = response();
  await handler({ method: 'GET', query: { estimateId: 'estimate-a' }, headers: { authorization: 'Bearer token-a' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.budget.name, '2027 annual');
  assert.deepEqual(res.body.catalog.labour.map((item) => [item.name, item.approvedRate]), [['John Field', 65], ['Ryan Field', 72]]);
  assert.deepEqual(res.body.catalog.equipment.map((item) => [item.name, item.approvedRate]), [['Bobcat E50', 95], ['Dump Truck', 150]]);
  assert.equal(res.body.catalog.materials[0].approvedRate, 46);
  assert.equal(res.body.catalog.subcontractors[0].approvedRate, 135);
  assert.equal(res.body.catalog.labour.filter((item) => item.sourceEntityId === 'ryan').length, 1);

  put(store, 'biz-b', 'ESTIMATE#foreign-estimate', { entityType: 'ESTIMATE', estimateId: 'foreign-estimate', pricingBudgetId: 'budget-2027', title: 'Foreign estimate' });
  const foreignRes = response();
  await handler({ method: 'GET', query: { estimateId: 'foreign-estimate' }, headers: { authorization: 'Bearer token-a' } }, foreignRes);
  assert.equal(foreignRes.statusCode, 404);
});
