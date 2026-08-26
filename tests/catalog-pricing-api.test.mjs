import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogPricingHandler } from '../api/catalog-pricing.js';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } });
const budget = { id: 'budget-current', name: '2027 Operating Budget', budgetType: 'operating', planningModel: 'divisions_v1', status: 'active', targetMarginPct: 20 };
const divisions = [{ id: 'snow', budgetId: budget.id, name: 'Snow Removal', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } }];
const employees = [{ id: 'employee-a', name: 'Alex', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 30, payrollBurdenPct: 0, active: true }];
const labourClasses = [{ id: 'labourer', name: 'Labourer', active: true, customRates: {} }];
const planningItems = [{ id: 'labour-a', budgetId: budget.id, category: 'labour', employeeId: 'employee-a', plannedHours: 1000, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'snow', hours: 1000 }] }];

const handlerFor = (profile, selectedBudget = budget, overrides = {}) => createCatalogPricingHandler({
  requireSession: async () => ({ businessId: 'biz-a', role: 'owner' }),
  getBusinessProfile: async () => profile,
  getBudgetForBusiness: async (businessId, budgetId) => businessId === 'biz-a' && budgetId === selectedBudget?.id ? selectedBudget : null,
  listBudgetDivisionsForBusiness: async () => divisions,
  listBudgetRatesForBusiness: async () => [],
  listEmployeesForBusiness: async () => employees,
  listEquipmentAssetsForBusiness: async () => [],
  listLabourClassesForBusiness: async () => labourClasses,
  listMaterialCatalogItemsForBusiness: async () => [],
  listDivisionPlanningItemsForBusiness: async () => planningItems,
  ...overrides,
});

test('Catalog never guesses a Pricing Budget and reports invalid configured sources', async () => {
  const unconfigured = response();
  await handlerFor({ id: 'biz-a', pricingBudgetId: null })({ method: 'GET' }, unconfigured);
  assert.deepEqual(unconfigured.body, { ok: true, status: 'unconfigured' });

  const invalid = response();
  await handlerFor({ id: 'biz-a', pricingBudgetId: 'missing' }, null)({ method: 'GET' }, invalid);
  assert.equal(invalid.body.status, 'invalid');
  assert.equal(invalid.body.pricingBudgetId, 'missing');
});

test('Catalog Labour consumes the selected Budget shared pricing result exactly', async () => {
  const res = response();
  await handlerFor({ id: 'biz-a', pricingBudgetId: budget.id })({ method: 'GET' }, res);
  assert.equal(res.body.status, 'ready');
  assert.equal(res.body.budget.id, budget.id);
  const shared = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: [], employees, labourClasses })[0];
  const catalog = res.body.catalog.labour[0];
  assert.deepEqual(
    [catalog.costRate, catalog.divisionOverheadRecoveryPerUnit, catalog.recoveredCostPerUnit, catalog.targetMarginPct, catalog.calculatedRate, catalog.estimateRate],
    [shared.costRate, shared.divisionOverheadPerUnit, shared.recoveredCostPerUnit, shared.targetMarginPct, shared.calculatedRate, shared.estimateRate],
  );
  assert.equal(catalog.divisionName, 'Snow Removal');
  assert.equal(JSON.stringify(res.body.catalog).includes('Legacy / Unassigned'), false);
});

test('Catalog Labour PATCH saves and clears only the requested Division override', async () => {
  let labourClass = { ...labourClasses[0], customRates: { mowing: 88 } };
  const updates = [];
  const handler = handlerFor({ id: 'biz-a', pricingBudgetId: budget.id }, budget, {
    listLabourClassesForBusiness: async () => [labourClass],
    getLabourClassForBusiness: async (businessId, labourClassId) => businessId === 'biz-a' && labourClassId === labourClass.id ? labourClass : null,
    updateLabourClassForBusiness: async ({ labourClass: next }) => { labourClass = next; updates.push(next); },
  });

  const saved = response();
  await handler({ method: 'PATCH', body: { category: 'labour', sourceEntityId: 'labourer', divisionId: 'snow', customRate: 72 } }, saved);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(updates[0].customRates, { mowing: 88, snow: 72 });

  const cleared = response();
  await handler({ method: 'PATCH', body: { category: 'labour', sourceEntityId: 'labourer', divisionId: 'snow', customRate: null } }, cleared);
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(updates[1].customRates, { mowing: 88, snow: null });
});

test('Catalog resource PATCH creates and clears explicit Division-scoped rates', async () => {
  const resourcePlanningItems = [
    { id: 'equipment-plan', budgetId: budget.id, category: 'equipment', equipmentId: 'equipment-a', name: 'Skid Steer', unit: 'hr', budgeted: 12000, equipmentDivisionAllocations: [{ divisionId: 'snow', months: 12 }] },
    { id: 'material-plan', budgetId: budget.id, category: 'materials', materialCatalogItemId: 'material-a', divisionId: 'snow', name: 'Salt', unit: 'tonne', unitCost: 140, plannedQuantity: 20 },
    { id: 'subcontractor-plan', budgetId: budget.id, category: 'subcontractors', vendorId: 'vendor-a', divisionId: 'snow', name: 'North Plowing', unit: 'hr', unitCost: 95, plannedQuantity: 100 },
  ];
  const rates = [];
  const handler = handlerFor({ id: 'biz-a', pricingBudgetId: budget.id }, budget, {
    listDivisionPlanningItemsForBusiness: async () => resourcePlanningItems,
    listEquipmentAssetsForBusiness: async () => [{ id: 'equipment-a', name: 'Skid Steer', equipmentClassification: 'billable' }],
    listMaterialCatalogItemsForBusiness: async () => [{ id: 'material-a', name: 'Salt', unit: 'tonne' }],
    listBudgetRatesForBusiness: async () => rates,
    generateId: () => `rate-${rates.length + 1}`,
    createBudgetRateForBusiness: async ({ budgetRate }) => { rates.push(budgetRate); },
    updateBudgetRateForBusiness: async ({ budgetRate }) => { const index = rates.findIndex((rate) => rate.id === budgetRate.id); rates[index] = budgetRate; },
  });

  for (const [category, sourceEntityId] of [['equipment', 'equipment-a'], ['material', 'material-a'], ['subcontractor', 'vendor-a']]) {
    const saved = response();
    await handler({ method: 'PATCH', body: { category, sourceEntityId, divisionId: 'snow', customRate: 125 } }, saved);
    assert.equal(saved.statusCode, 200, `${category} save should succeed`);
    const rate = rates.find((item) => item.category === category);
    assert.equal(rate.customRate, 125);
    assert.equal(rate.divisionId, 'snow');
    assert.equal(rate.budgetId, budget.id);

    const cleared = response();
    await handler({ method: 'PATCH', body: { category, sourceEntityId, divisionId: 'snow', customRate: null } }, cleared);
    assert.equal(cleared.statusCode, 200, `${category} clear should succeed`);
    assert.equal(rates.find((item) => item.category === category).customRate, null);
  }
});

test('Catalog PATCH enforces write authorization and rejects resources outside the selected Budget', async () => {
  let repositoryCalled = false;
  const unauthorized = createCatalogPricingHandler({
    requireSession: async (_req, res) => { res.status(403).json({ ok: false, error: 'Forbidden' }); return null; },
    getBusinessProfile: async () => { repositoryCalled = true; },
  });
  const denied = response();
  await unauthorized({ method: 'PATCH', body: {} }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(repositoryCalled, false);

  const spoofed = response();
  await handlerFor({ id: 'biz-a', pricingBudgetId: budget.id })({ method: 'PATCH', body: { category: 'labour', sourceEntityId: 'other-tenant-class', divisionId: 'snow', customRate: 99 } }, spoofed);
  assert.equal(spoofed.statusCode, 404);
});