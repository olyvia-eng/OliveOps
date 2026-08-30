import test from 'node:test';
import assert from 'node:assert/strict';

import { createJobPlansHandler } from '../api/job-plans.js';

const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
});

const session = (role = 'owner', businessId = 'biz-1') => ({ id: `${role}-1`, role, businessId, name: role, email: `${role}@example.com` });
const job = (overrides = {}) => ({
  id: 'job-1',
  sourceEstimateId: 'estimate-1',
  planningSnapshotVersion: 1,
  planningRevision: 2,
  pricingBudgetId: 'budget-1',
  divisionId: 'division-1',
  contractValue: 1100,
  originalContractRevenue: 1100,
  currentContractRevenue: 1100,
  operationalWorkAreas: [{
    id: 'area-1', sourceEstimateWorkAreaId: 'estimate-area-1', name: 'Driveway', description: '', status: 'not_started', sortOrder: 0,
    lineItems: [{ id: 'line-1', sourceEstimateLineItemId: 'estimate-line-1', category: 'material', itemName: 'Gravel', description: '', quantity: 20, unit: 'tonne', unitCost: 40, plannedCost: 800, sellPrice: 55, contractRevenue: 1100, total: 1100 }],
  }],
  ...overrides,
});

const request = async ({ currentJob = job(), role = 'owner', method = 'PATCH', body, getJob, updateResult = { ok: true }, initializeResult = { ok: true }, loadPricingCatalog } = {}) => {
  let savedPlan = null;
  let initializedPlan = null;
  const handler = createJobPlansHandler({
    requireSession: async () => session(role),
    getJobForBusiness: getJob ?? (async (businessId) => businessId === 'biz-1' ? currentJob : null),
    updateJobPlanForBusiness: async (input) => { savedPlan = input; return updateResult; },
    initializeJobPlanForBusiness: async (input) => { initializedPlan = input; return initializeResult; },
    getEstimateForBusiness: async () => null,
    loadPricingCatalog,
  });
  const res = response();
  await handler({ method, query: { jobId: currentJob.id }, body }, res);
  return { res, savedPlan, initializedPlan };
};

test('owner planned-cost edits recompute totals and preserve contract revenue and provenance', async () => {
  const { res, savedPlan } = await request({ body: { action: 'update-line', workAreaId: 'area-1', lineItemId: 'line-1', unitCost: 48, expectedRevision: 2 } });
  assert.equal(res.statusCode, 200);
  assert.equal(savedPlan.expectedRevision, 2);
  assert.equal(savedPlan.plan.planningRevision, 3);
  assert.equal(savedPlan.plan.currentPlannedCost, 960);
  assert.equal(savedPlan.plan.currentContractRevenue, 1100);
  assert.equal(savedPlan.plan.currentExpectedProfit, 140);
  assert.equal(savedPlan.plan.operationalWorkAreas[0].lineItems[0].sourceEstimateLineItemId, 'estimate-line-1');
});

test('quantity edits preserve sold line revenue', async () => {
  const { savedPlan } = await request({ body: { action: 'update-line', workAreaId: 'area-1', lineItemId: 'line-1', quantity: 25, expectedRevision: 2 } });
  assert.equal(savedPlan.plan.currentPlannedCost, 1000);
  assert.equal(savedPlan.plan.operationalWorkAreas[0].lineItems[0].contractRevenue, 1100);
  assert.equal(savedPlan.plan.operationalWorkAreas[0].lineItems[0].total, 1100);
});

test('foreman can edit scope and quantities but cannot edit costs or remove resources', async () => {
  const quantity = await request({ role: 'foreman', body: { action: 'update-line', workAreaId: 'area-1', lineItemId: 'line-1', quantity: 22, expectedRevision: 2 } });
  assert.equal(quantity.res.statusCode, 200);
  const cost = await request({ role: 'foreman', body: { action: 'update-line', workAreaId: 'area-1', lineItemId: 'line-1', unitCost: 50, expectedRevision: 2 } });
  assert.equal(cost.res.statusCode, 403);
  const removal = await request({ role: 'foreman', body: { action: 'remove-line', workAreaId: 'area-1', lineItemId: 'line-1', expectedRevision: 2 } });
  assert.equal(removal.res.statusCode, 403);
});

test('stale revisions are rejected before persistence and conditional conflicts remain 409', async () => {
  const stale = await request({ body: { action: 'update-line', workAreaId: 'area-1', lineItemId: 'line-1', quantity: 21, expectedRevision: 1 } });
  assert.equal(stale.res.statusCode, 409);
  assert.equal(stale.savedPlan, null);
  const raced = await request({ body: { action: 'update-line', workAreaId: 'area-1', lineItemId: 'line-1', quantity: 21, expectedRevision: 2 }, updateResult: { ok: false, code: 'STALE_REVISION' } });
  assert.equal(raced.res.statusCode, 409);
});

test('legacy initialization is one-time and clones original snapshot lines with stable persisted IDs', async () => {
  const legacy = job({ planningSnapshotVersion: undefined, planningRevision: undefined, operationalWorkAreas: undefined, originalEstimateSnapshot: { subtotal: 1100, workAreas: job().operationalWorkAreas } });
  const first = await request({ currentJob: legacy, method: 'POST', body: { action: 'initialize' } });
  assert.equal(first.res.statusCode, 200);
  assert.equal(first.initializedPlan.plan.planningRevision, 1);
  assert.notEqual(first.initializedPlan.plan.operationalWorkAreas[0].id, 'area-1');
  assert.equal(first.initializedPlan.plan.operationalWorkAreas[0].sourceEstimateWorkAreaId, 'estimate-area-1');
  const initialized = { ...legacy, planningSnapshotVersion: 1, planningRevision: 1, operationalWorkAreas: first.initializedPlan.plan.operationalWorkAreas };
  const repeated = await request({ currentJob: initialized, method: 'POST', body: { action: 'initialize' } });
  assert.equal(repeated.res.body.initialized, false);
  assert.equal(repeated.initializedPlan, null);
});

test('manual legacy Jobs initialize named empty areas and preserve initial contract value', async () => {
  const manual = job({ sourceEstimateId: undefined, contractValue: 2500, originalContractRevenue: undefined, currentContractRevenue: undefined, planningSnapshotVersion: undefined, planningRevision: undefined, operationalWorkAreas: undefined, originalEstimateSnapshot: undefined, workAreas: ['Front', 'Back'] });
  const result = await request({ currentJob: manual, method: 'POST', body: { action: 'initialize' } });
  assert.deepEqual(result.initializedPlan.plan.operationalWorkAreas.map((area) => area.name), ['Front', 'Back']);
  assert.equal(result.initializedPlan.plan.originalContractRevenue, 2500);
  assert.equal(result.initializedPlan.plan.currentContractRevenue, 2500);
});

test('new authorized Job resources snapshot pricing but add zero contract revenue', async () => {
  const catalog = {
    budgetId: 'budget-1', labour: [], equipment: [], subcontractors: [],
    materials: [{ type: 'material', sourceEntityId: 'material-1', materialCatalogItemId: 'material-1', sourceOrigin: 'catalog_only', pricingReadiness: 'priced', name: 'Mulch', description: '', unit: 'yard', costRate: 20, recommendedRate: 30, sellRate: 30, pricingAvailable: true, pricingStatus: 'calculated', divisionId: 'division-1', directCostPerUnit: 20, recoveredCostPerUnit: 24, targetMarginPct: 20 }],
  };
  const result = await request({ method: 'POST', body: { action: 'add-resource', workAreaId: 'area-1', materialCatalogItemId: 'material-1', quantity: 2, expectedRevision: 2 }, loadPricingCatalog: async () => catalog });
  assert.equal(result.res.statusCode, 200);
  const line = result.savedPlan.plan.operationalWorkAreas[0].lineItems.at(-1);
  assert.equal(line.materialCatalogItemId, 'material-1');
  assert.equal(line.plannedCost, 40);
  assert.equal(line.contractRevenue, 0);
  assert.equal(line.total, 0);
  assert.equal(line.recommendedSellPriceAtAddition, 30);
  assert.equal(result.savedPlan.plan.currentContractRevenue, 1100);
});

test('tenant-scoped lookup rejects unavailable Jobs', async () => {
  const result = await request({ getJob: async () => null, body: { action: 'update-line', expectedRevision: 2 } });
  assert.equal(result.res.statusCode, 404);
  assert.equal(result.savedPlan, null);
});

test('removing a sold planning line does not reduce overall contract revenue', async () => {
  const { savedPlan } = await request({ body: { action: 'remove-line', workAreaId: 'area-1', lineItemId: 'line-1', expectedRevision: 2 } });
  assert.equal(savedPlan.plan.currentPlannedCost, 0);
  assert.equal(savedPlan.plan.currentContractRevenue, 1100);
  assert.equal(savedPlan.plan.currentExpectedProfit, 1100);
  assert.deepEqual(savedPlan.plan.workAreas, ['Driveway']);
});