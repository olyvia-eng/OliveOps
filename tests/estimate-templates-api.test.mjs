import test from 'node:test';
import assert from 'node:assert/strict';
import { createEstimateTemplatesHandler } from '../api/estimate-templates.js';

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

const budget = { id: 'budget-a', name: '2027', status: 'active', planningModel: 'divisions_v1', targetMarginPct: 20, updatedAt: '2026-09-01T00:00:00.000Z' };
const division = { id: 'division-a', budgetId: budget.id, name: 'Hardscape', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } };
const template = {
  id: 'template-a', schemaVersion: 2, name: 'Interlock Patio', description: 'Patio scope', proposalNotes: 'Scope excludes permits.', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  workAreas: [{ id: 'template-area-a', name: 'Excavation', description: 'Excavate patio', sortOrder: 0, lineItems: [
    { id: 'template-line-labour', category: 'labour', sourceEntityId: 'class-a', itemName: 'Labourer', description: 'Excavation labour', quantity: 8, unit: 'hr', sortOrder: 0, pricingReadiness: 'ready' },
    { id: 'template-line-equipment', category: 'equipment', sourceEntityId: 'equipment-a', itemName: 'Excavator', description: '', quantity: 4, unit: 'hr', sortOrder: 1, pricingReadiness: 'ready' },
    { id: 'template-line-material', category: 'material', sourceEntityId: 'material-a', itemName: 'Granular A', description: '', quantity: 10, unit: 'tonne', sortOrder: 2, pricingReadiness: 'ready' },
    { id: 'template-line-sub', category: 'subcontractor', sourceEntityId: 'sub-a', itemName: 'Hauling', description: '', quantity: 1, unit: 'job', sortOrder: 3, pricingReadiness: 'ready' },
  ] }],
};

function harness(options = {}) {
  let savedTemplate = structuredClone(options.template ?? template);
  const estimates = [];
  const planningItems = [
    { id: 'labour-plan', budgetId: budget.id, category: 'labour', employeeId: 'employee-a', plannedHours: 100, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations: [{ divisionId: division.id, hours: 100 }] },
    { id: 'equipment-plan', budgetId: budget.id, category: 'equipment', equipmentId: 'equipment-a', name: 'Excavator', plannedAmount: 1000, sellableHoursPerYear: 100, equipmentDivisionAllocations: [{ divisionId: division.id, months: 12 }] },
    { id: 'material-plan', budgetId: budget.id, divisionId: division.id, category: 'materials', materialCatalogItemId: 'material-a', name: 'Granular A', unit: 'tonne', unitCost: options.materialCost ?? 10, plannedQuantity: 100 },
    { id: 'sub-plan', budgetId: budget.id, divisionId: division.id, category: 'subcontractors', subcontractorCatalogItemId: 'sub-a', name: 'Hauling', unit: 'job', rate: 100, plannedQuantity: 10 },
  ];
  const deps = {
    requireSession: async () => ({ businessId: 'biz-a', id: 'owner-a', role: 'owner' }),
    getTemplateForBusiness: async (_businessId, id) => id === savedTemplate?.id ? structuredClone(savedTemplate) : null,
    createTemplateForBusiness: async ({ template: next }) => { savedTemplate = structuredClone(next); return { ok: true }; },
    updateTemplateForBusiness: async ({ template: next }) => { savedTemplate = structuredClone(next); return { ok: true }; },
    deleteTemplateForBusiness: async () => { savedTemplate = null; return { ok: true }; },
    getCustomerForBusiness: async (_businessId, id) => id === 'customer-a' ? { id } : null,
    getBudgetForBusiness: async (_businessId, id) => id === budget.id ? budget : null,
    getBudgetDivisionForBusiness: async (_businessId, budgetId, id) => budgetId === budget.id && id === division.id ? division : null,
    listEstimatesForBusiness: async () => estimates,
    createEstimateForBusiness: async ({ estimate }) => { estimates.push(structuredClone(estimate)); return { ok: true }; },
    listDivisionPlanningItemsForBusiness: async () => planningItems,
    listBudgetDivisionsForBusiness: async () => [division],
    listBudgetRatesForBusiness: async () => [],
    listEmployeesForBusiness: async () => [{ id: 'employee-a', name: 'Alex', labourClassId: 'class-a', compensationType: 'hourly', hourlyRate: options.labourCost ?? 30, payrollBurdenPct: 0, benefitsExtraCost: 0, bonus: 0 }],
    listEquipmentAssetsForBusiness: async () => [{ id: 'equipment-a', name: 'Excavator', equipmentClassification: 'billable' }],
    listLabourClassesForBusiness: async () => [{ id: 'class-a', name: 'Labourer', active: true, customRates: {} }],
    listMaterialCatalogItemsForBusiness: async () => options.missingMaterial ? [] : [{ id: 'material-a', name: 'Granular A', unit: 'tonne', defaultUnitCost: options.materialCost ?? 10, active: true }],
    listSubcontractorCatalogItemsForBusiness: async () => [{ id: 'sub-a', name: 'Hauling', unit: 'job', defaultUnitCost: 100 }],
    getLabourClassForBusiness: async (_businessId, id) => id === 'class-a' ? { id } : null,
    getEquipmentAssetForBusiness: async (_businessId, id) => id === 'equipment-a' ? { id } : null,
    getMaterialCatalogItemForBusiness: async (_businessId, id) => id === 'material-a' ? { id } : null,
    getSubcontractorCatalogItemForBusiness: async (_businessId, id) => id === 'sub-a' ? { id } : null,
  };
  const handler = createEstimateTemplatesHandler(deps);
  return {
    estimates,
    get template() { return savedTemplate; },
    async request(method, query, body) { const res = response(); await handler({ method, query, body }, res); return res; },
  };
}

const estimateRequest = { templateId: 'template-a', customerId: 'customer-a', pricingBudgetId: 'budget-a', divisionId: 'division-a', proposalNumber: 'PROP-1', title: 'Patio Estimate', validUntil: '2026-10-01' };

test('small Template creation produces an empty v2 scope record', async () => {
  const api = harness({ template: null });
  const res = await api.request('POST', {}, { name: 'Patio', description: 'Reusable patio scope' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.template.schemaVersion, 2);
  assert.deepEqual(res.body.template.workAreas, []);
  assert.equal(res.body.template.proposalNotes, '');
  assert.equal(res.body.template.taxRate, undefined);
});

test('Template edits preserve multiple Work Areas, categories, quantities, units, and ordering without economics', async () => {
  const api = harness();
  const edited = structuredClone(template);
  edited.workAreas.push({ id: 'area-b', name: 'Base Prep', description: '', sortOrder: 1, lineItems: [] });
  const res = await api.request('PATCH', { templateId: template.id }, edited);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.template.workAreas.map((area) => area.name), ['Excavation', 'Base Prep']);
  assert.deepEqual(res.body.template.workAreas[0].lineItems.map((line) => [line.category, line.quantity, line.unit]), [['labour', 8, 'hr'], ['equipment', 4, 'hr'], ['material', 10, 'tonne'], ['subcontractor', 1, 'job']]);
  assert.equal(JSON.stringify(res.body.template).includes('sellPrice'), false);
  assert.equal(JSON.stringify(res.body.template).includes('unitCost'), false);
});

test('Template deletion removes the reusable scope without touching Estimates', async () => {
  const api = harness();
  const created = await api.request('POST', { action: 'create-estimate' }, estimateRequest);
  assert.equal(created.statusCode, 200);

  const deleted = await api.request('DELETE', { templateId: template.id });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.ok, true);
  assert.equal(api.template, null);
  assert.equal(api.estimates.length, 1);
});

test('Estimate creation from Template generates fresh IDs and snapshots selected Budget pricing', async () => {
  const api = harness();
  const res = await api.request('POST', { action: 'create-estimate' }, estimateRequest);
  assert.equal(res.statusCode, 200);
  const estimate = res.body.estimate;
  assert.equal(estimate.templateId, template.id);
  assert.equal(estimate.workAreas[0].sourceTemplateWorkAreaId, 'template-area-a');
  assert.notEqual(estimate.workAreas[0].id, 'template-area-a');
  assert.deepEqual(estimate.workAreas[0].lineItems.map((line) => line.sourceTemplateLineItemId), template.workAreas[0].lineItems.map((line) => line.id));
  assert.equal(estimate.workAreas[0].lineItems.every((line) => !template.workAreas[0].lineItems.some((source) => source.id === line.id)), true);
  assert.deepEqual(estimate.workAreas[0].lineItems.map((line) => line.category), ['labour', 'equipment', 'material', 'subcontractor']);
  assert.equal(estimate.workAreas[0].lineItems.every((line) => Number.isFinite(line.unitCost) && Number.isFinite(line.sellPrice) && line.total === line.quantity * line.sellPrice), true);
  assert.equal(estimate.taxRate, 13);
  assert.equal(estimate.notes, template.proposalNotes);
});

test('later Template and Budget changes do not alter an existing Estimate snapshot', async () => {
  const first = harness({ materialCost: 10 });
  const created = await first.request('POST', { action: 'create-estimate' }, estimateRequest);
  const snapshot = structuredClone(created.body.estimate);
  const changedTemplate = structuredClone(template);
  changedTemplate.workAreas[0].lineItems[2].quantity = 99;
  await first.request('PATCH', { templateId: template.id }, changedTemplate);
  assert.deepEqual(created.body.estimate, snapshot);

  const repriced = harness({ materialCost: 25 });
  const second = await repriced.request('POST', { action: 'create-estimate' }, { ...estimateRequest, proposalNumber: 'PROP-2' });
  const firstMaterial = snapshot.workAreas[0].lineItems.find((line) => line.category === 'material');
  const secondMaterial = second.body.estimate.workAreas[0].lineItems.find((line) => line.category === 'material');
  assert.notEqual(firstMaterial.sellPrice, secondMaterial.sellPrice);
  assert.equal(snapshot.workAreas[0].lineItems.find((line) => line.category === 'material').sellPrice, firstMaterial.sellPrice);
});

test('missing Catalog resources become explicit review-only lines without fabricated pricing', async () => {
  const api = harness({ missingMaterial: true });
  const res = await api.request('POST', { action: 'create-estimate' }, estimateRequest);
  assert.equal(res.statusCode, 200);
  const material = res.body.estimate.workAreas[0].lineItems.find((line) => line.category === 'material');
  assert.equal(material.pricingReadiness, 'needs_review');
  assert.equal(material.sourceEntityId, undefined);
  assert.equal(material.unitCost, 0);
  assert.equal(material.sellPrice, 0);
  assert.equal(material.total, 0);
});

test('cross-tenant Template, Budget, and Catalog references are rejected', async () => {
  const api = harness();
  assert.equal((await api.request('POST', { action: 'create-estimate' }, { ...estimateRequest, templateId: 'foreign-template' })).statusCode, 404);
  assert.equal((await api.request('POST', { action: 'create-estimate' }, { ...estimateRequest, pricingBudgetId: 'foreign-budget' })).statusCode, 400);
  const forged = structuredClone(template);
  forged.workAreas[0].lineItems[0].sourceEntityId = 'foreign-class';
  const catalog = await api.request('PATCH', { templateId: template.id }, forged);
  assert.equal(catalog.statusCode, 400);
  assert.equal(catalog.body.error, 'Template resources must belong to this business.');
});

test('Template API rejects monetary fields instead of creating a second pricing authority', async () => {
  const api = harness();
  const forged = structuredClone(template);
  forged.workAreas[0].lineItems[0].sellPrice = 999;
  const res = await api.request('PATCH', { templateId: template.id }, forged);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /sellPrice is not part of the Template line-item contract/);
});
