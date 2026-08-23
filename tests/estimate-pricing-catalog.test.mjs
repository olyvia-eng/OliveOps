import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAuthoritativeEstimatePricing, buildEstimatePricingCatalog } from '../api/_lib/estimatePricingCatalog.js';
import { createEstimatePricingCatalogHandler } from '../api/estimate-pricing-catalog.js';

const budgetId = 'budget-2027';
const planningItems = [
  { id: 'labour-ryan', budgetId, divisionId: 'hardscape', category: 'labour', employeeId: 'ryan', name: 'Ryan Field', divisionAllocations: [{ divisionId: 'hardscape', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] },
  { id: 'labour-ryan', budgetId, divisionId: 'snow', category: 'labour', employeeId: 'ryan', name: 'Ryan Field', divisionAllocations: [{ divisionId: 'hardscape', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] },
  { id: 'labour-john', budgetId, divisionId: 'hardscape', category: 'labour', employeeId: 'john', name: 'John Field', divisionAllocations: [{ divisionId: 'hardscape', percentage: 100 }] },
  { id: 'equipment-bobcat', budgetId, divisionId: 'hardscape', category: 'equipment', equipmentId: 'bobcat', name: 'Bobcat E50', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 7 }, { divisionId: 'snow', months: 5 }] },
  { id: 'equipment-truck', budgetId, divisionId: 'snow', category: 'equipment', equipmentId: 'truck', name: 'Dump Truck' },
  { id: 'material-gravel', budgetId, divisionId: 'hardscape', category: 'materials', materialCatalogItemId: 'gravel', name: 'A Gravel', unit: 'tonne' },
  { id: 'sub-concrete', budgetId, divisionId: 'hardscape', category: 'subcontractors', vendorId: 'concrete-co', name: 'Concrete Co', unit: 'hr' },
];
const budgetRates = [
  { id: 'rate-ryan', budgetId, budgetItemId: 'labour-ryan', employeeId: 'ryan', category: 'labour', unit: 'hr', unitCost: 42, recommendedSellPrice: 70, defaultSellPrice: 72, active: true },
  { id: 'rate-john', budgetId, employeeId: 'john', category: 'labour', unit: 'hr', unitCost: 38, recommendedSellPrice: 63, defaultSellPrice: 65, active: true },
  { id: 'rate-bobcat', budgetId, equipmentId: 'bobcat', category: 'equipment', unit: 'hr', unitCost: 55, recommendedSellPrice: 92, defaultSellPrice: 95, active: true },
  { id: 'rate-truck', budgetId, budgetItemId: 'equipment-truck', category: 'equipment', unit: 'hr', unitCost: 90, recommendedSellPrice: 145, defaultSellPrice: 150, active: true },
  { id: 'rate-gravel', budgetId, materialCatalogItemId: 'gravel', category: 'material', unit: 'tonne', unitCost: 28, recommendedSellPrice: 44, defaultSellPrice: 46, active: true },
  { id: 'rate-concrete', budgetId, vendorId: 'concrete-co', category: 'subcontractor', unit: 'hr', unitCost: 100, recommendedSellPrice: 130, defaultSellPrice: 135, active: true },
  { id: 'foreign-rate', budgetId: 'foreign-budget', equipmentId: 'bobcat', category: 'equipment', unit: 'hr', unitCost: 1, defaultSellPrice: 1, active: true },
];

const build = (rates = budgetRates) => buildEstimatePricingCatalog({
  budgetId,
  planningItems,
  budgetRates: rates,
  employees: [{ id: 'ryan', name: 'Ryan Field' }, { id: 'john', name: 'John Field' }],
  equipmentAssets: [{ id: 'bobcat', name: 'Bobcat E50' }, { id: 'truck', name: 'Dump Truck' }],
  materialCatalogItems: [{ id: 'gravel', name: 'A Gravel' }],
});

test('overall Budget catalog deduplicates shared allocations and resolves approved prices by canonical identity', () => {
  const catalog = build();

  assert.deepEqual(catalog.labour.map((item) => [item.name, item.approvedRate]), [['John Field', 65], ['Ryan Field', 72]]);
  assert.deepEqual(catalog.equipment.map((item) => [item.name, item.approvedRate]), [['Bobcat E50', 95], ['Dump Truck', 150]]);
  assert.deepEqual(catalog.materials.map((item) => [item.name, item.approvedRate, item.unit]), [['A Gravel', 46, 'tonne']]);
  assert.deepEqual(catalog.subcontractors.map((item) => [item.name, item.approvedRate]), [['Concrete Co', 135]]);
  assert.equal(catalog.labour.filter((item) => item.sourceEntityId === 'ryan').length, 1);
  assert.equal(catalog.equipment.find((item) => item.sourceEntityId === 'bobcat').sourceRateId, 'rate-bobcat');
});

test('catalog keeps Budget items discoverable and distinguishes recommended from unavailable pricing', () => {
  const rates = budgetRates
    .filter((rate) => !['rate-ryan', 'rate-truck'].includes(rate.id))
    .concat({ id: 'recommend-ryan', budgetId, employeeId: 'ryan', category: 'labour', unit: 'hr', unitCost: 42, recommendedSellPrice: 70, defaultSellPrice: 0, active: true });
  const catalog = build(rates);

  assert.equal(catalog.labour.find((item) => item.sourceEntityId === 'ryan').pricingStatus, 'recommended_not_approved');
  assert.equal(catalog.labour.find((item) => item.sourceEntityId === 'ryan').approvedRate, null);
  assert.equal(catalog.equipment.find((item) => item.sourceEntityId === 'truck').pricingStatus, 'unavailable');
});

test('new Estimate items snapshot authoritative approved values and reject cross-Budget sources', () => {
  const catalog = build();
  const forged = {
    id: 'estimate-a', pricingBudgetId: budgetId, lineItems: [{
      id: 'line-ryan', category: 'labour', sourceBudgetId: budgetId, sourceBudgetItemId: 'labour-ryan', sourceEntityId: 'ryan',
      itemName: 'Forged', description: '', quantity: 8, unit: 'hr', unitCost: 1, sellPrice: 2, total: 16,
    }], workAreas: [],
  };
  const result = applyAuthoritativeEstimatePricing({ existingEstimate: { lineItems: [], workAreas: [] }, nextEstimate: forged, catalog });

  assert.equal(result.ok, true);
  assert.equal(result.estimate.lineItems[0].itemName, 'Ryan Field');
  assert.equal(result.estimate.lineItems[0].unitCost, 42);
  assert.equal(result.estimate.lineItems[0].sellPrice, 72);
  assert.equal(result.estimate.lineItems[0].total, 576);
  assert.equal(result.estimate.lineItems[0].sourceRateId, 'rate-ryan');

  const crossBudget = applyAuthoritativeEstimatePricing({
    existingEstimate: { lineItems: [], workAreas: [] },
    nextEstimate: { ...forged, lineItems: [{ ...forged.lineItems[0], sourceBudgetId: 'foreign-budget' }] },
    catalog,
  });
  assert.equal(crossBudget.ok, false);
  assert.match(crossBudget.error, /selected Pricing Budget/);
});

test('existing Estimate snapshots do not silently reprice when the Budget approval changes', () => {
  const rateA = build();
  const existingLine = { id: 'line-bobcat', category: 'equipment', sourceBudgetId: budgetId, sourceBudgetItemId: 'equipment-bobcat', sourceEntityId: 'bobcat', sourceRateId: 'rate-bobcat', itemName: 'Bobcat E50', description: '', quantity: 8, unit: 'hr', unitCost: 55, sellPrice: 95, total: 760 };
  const rateB = build(budgetRates.map((rate) => rate.id === 'rate-bobcat' ? { ...rate, defaultSellPrice: 120 } : rate));
  assert.equal(rateA.equipment.find((item) => item.sourceEntityId === 'bobcat').approvedRate, 95);
  assert.equal(rateB.equipment.find((item) => item.sourceEntityId === 'bobcat').approvedRate, 120);

  const result = applyAuthoritativeEstimatePricing({
    existingEstimate: { id: 'estimate-a', pricingBudgetId: budgetId, lineItems: [existingLine], workAreas: [] },
    nextEstimate: { id: 'estimate-a', pricingBudgetId: budgetId, lineItems: [{ ...existingLine, description: 'Eight planned hours' }], workAreas: [] },
    catalog: rateB,
  });
  assert.equal(result.ok, true);
  assert.equal(result.estimate.lineItems[0].sellPrice, 95);
  assert.equal(result.estimate.lineItems[0].total, 760);
});

test('Division Average Labour approval is available to new Estimates without replacing legacy employee rates', () => {
  const aggregateRate = {
    id: 'rate-average-hardscape', budgetId, budgetItemId: 'average-labour:hardscape', divisionId: 'hardscape', pricingVersion: 2,
    category: 'labour', unit: 'hr', unitCost: 40, directCostPerUnit: 40, divisionOverheadRecoveryPerUnit: 5,
    recoveredCostPerUnit: 45, targetMarginPercent: 20, recommendedSellPrice: 56.25, defaultSellPrice: 58, active: true,
  };
  const catalog = buildEstimatePricingCatalog({ budgetId, divisionId: 'hardscape', planningItems, budgetRates: [...budgetRates, aggregateRate] });
  const average = catalog.labour.find((item) => item.budgetItemId === 'average-labour:hardscape');
  assert.equal(average.name, 'Average Labour');
  assert.equal(average.approvedRate, 58);
  assert.equal(catalog.labour.some((item) => item.sourceEntityId === 'ryan'), true);

  const requested = { id: 'line-average', category: 'labour', divisionId: 'hardscape', sourceBudgetId: budgetId, sourceBudgetItemId: 'average-labour:hardscape', itemName: '', description: '', quantity: 10, unit: 'hr', unitCost: 0, sellPrice: 0, total: 0 };
  const result = applyAuthoritativeEstimatePricing({ existingEstimate: { lineItems: [], workAreas: [] }, nextEstimate: { id: 'estimate-average', pricingBudgetId: budgetId, lineItems: [requested], workAreas: [] }, catalog });
  assert.equal(result.ok, true);
  assert.equal(result.estimate.lineItems[0].sellPrice, 58);
  assert.equal(result.estimate.lineItems[0].total, 580);
});

test('Division catalogs prefer version-2 rates and snapshot recovery components immutably', () => {
  const versionedRate = {
    id: 'rate-ryan-hardscape-v2', budgetId, budgetItemId: 'labour-ryan', employeeId: 'ryan', divisionId: 'hardscape', pricingVersion: 2,
    category: 'labour', unit: 'hr', unitCost: 42, directCostPerUnit: 42, divisionOverheadRecoveryPerUnit: 8,
    companyOverheadRecoveryPerUnit: 10, recoveredCostPerUnit: 60, targetMarginPercent: 20, recommendedSellPrice: 75, defaultSellPrice: 78, active: true,
  };
  const catalog = buildEstimatePricingCatalog({
    budgetId, divisionId: 'hardscape', planningItems, budgetRates: [...budgetRates, versionedRate],
    employees: [{ id: 'ryan', name: 'Ryan Field' }, { id: 'john', name: 'John Field' }], equipmentAssets: [], materialCatalogItems: [],
  });
  const ryan = catalog.labour.find((item) => item.sourceEntityId === 'ryan');
  assert.equal(ryan.sourceRateId, versionedRate.id);
  assert.equal(ryan.divisionId, 'hardscape');
  assert.equal(ryan.approvedRate, 78);

  const requested = { id: 'line-v2', category: 'labour', divisionId: 'hardscape', sourceBudgetId: budgetId, sourceBudgetItemId: 'labour-ryan', sourceEntityId: 'ryan', itemName: '', description: '', quantity: 2, unit: 'hr', unitCost: 0, sellPrice: 0, total: 0 };
  const result = applyAuthoritativeEstimatePricing({ existingEstimate: { lineItems: [], workAreas: [] }, nextEstimate: { id: 'estimate-v2', pricingBudgetId: budgetId, lineItems: [requested], workAreas: [] }, catalog });
  assert.equal(result.ok, true);
  assert.deepEqual({
    pricingVersion: result.estimate.lineItems[0].pricingVersion,
    direct: result.estimate.lineItems[0].directCostPerUnit,
    division: result.estimate.lineItems[0].divisionOverheadRecoveryPerUnit,
    company: result.estimate.lineItems[0].companyOverheadRecoveryPerUnit,
    recovered: result.estimate.lineItems[0].recoveredCostPerUnit,
    margin: result.estimate.lineItems[0].targetMarginPct,
    recommended: result.estimate.lineItems[0].recommendedRateAtEstimate,
    approved: result.estimate.lineItems[0].sellPrice,
  }, { pricingVersion: 2, direct: 42, division: 8, company: 10, recovered: 60, margin: 20, recommended: 75, approved: 78 });

  const changedCatalog = structuredClone(catalog);
  changedCatalog.labour.find((item) => item.sourceEntityId === 'ryan').approvedRate = 100;
  const unchanged = applyAuthoritativeEstimatePricing({ existingEstimate: result.estimate, nextEstimate: structuredClone(result.estimate), catalog: changedCatalog });
  assert.equal(unchanged.estimate.lineItems[0].sellPrice, 78);

  const snowCatalog = buildEstimatePricingCatalog({ budgetId, divisionId: 'snow', planningItems, budgetRates: [...budgetRates, versionedRate] });
  assert.equal(snowCatalog.labour.find((item) => item.sourceEntityId === 'ryan').sourceRateId, 'rate-ryan');
});

test('adding approved Labour, Equipment, Material, and Subcontractor pricing preserves Estimate totals', () => {
  const catalog = build();
  const requested = [
    ['line-ryan', 'labour-ryan', 'ryan', 8],
    ['line-bobcat', 'equipment-bobcat', 'bobcat', 8],
    ['line-gravel', 'material-gravel', 'gravel', 10],
    ['line-concrete', 'sub-concrete', 'concrete-co', 4],
  ].map(([id, sourceBudgetItemId, sourceEntityId, quantity]) => ({
    id, category: 'labour', sourceBudgetId: budgetId, sourceBudgetItemId, sourceEntityId,
    itemName: '', description: '', quantity, unit: 'unit', unitCost: 0, sellPrice: 0, total: 0,
  }));
  const result = applyAuthoritativeEstimatePricing({
    existingEstimate: { lineItems: [], workAreas: [] },
    nextEstimate: { id: 'estimate-a', pricingBudgetId: budgetId, lineItems: requested, workAreas: [] },
    catalog,
  });

  assert.equal(result.ok, true);
  const estimatedCost = result.estimate.lineItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const sellPrice = result.estimate.lineItems.reduce((sum, item) => sum + item.total, 0);
  assert.equal(estimatedCost, 8 * 42 + 8 * 55 + 10 * 28 + 4 * 100);
  assert.equal(sellPrice, 8 * 72 + 8 * 95 + 10 * 46 + 4 * 135);
  assert.equal(sellPrice - estimatedCost, 880);
  assert.deepEqual(result.estimate.lineItems.map((item) => item.category), ['labour', 'equipment', 'material', 'subcontractor']);
});

test('pricing endpoint derives the selected Budget from the tenant-owned Estimate', async () => {
  const handler = createEstimatePricingCatalogHandler({
    requireSession: async () => ({ businessId: 'biz-a', role: 'admin' }),
    getEstimateForBusiness: async (businessId, estimateId) => businessId === 'biz-a' && estimateId === 'estimate-a' ? { id: estimateId, pricingBudgetId: budgetId, divisionId: 'hardscape' } : null,
    getBudgetForBusiness: async (businessId, requestedBudgetId) => businessId === 'biz-a' && requestedBudgetId === budgetId ? { id: budgetId, name: '2027 annual', planningModel: 'divisions_v1' } : null,
    getBudgetDivisionForBusiness: async (businessId, requestedBudgetId, divisionId) => businessId === 'biz-a' && requestedBudgetId === budgetId && divisionId === 'hardscape' ? { id: divisionId, budgetId: requestedBudgetId } : null,
    listDivisionPlanningItemsForBusiness: async (businessId) => businessId === 'biz-a' ? planningItems : [],
    listBudgetRatesForBusiness: async (businessId) => businessId === 'biz-a' ? budgetRates : [],
    listEmployeesForBusiness: async () => [{ id: 'ryan', name: 'Ryan Field' }, { id: 'john', name: 'John Field' }],
    listEquipmentAssetsForBusiness: async () => [{ id: 'bobcat', name: 'Bobcat E50' }, { id: 'truck', name: 'Dump Truck' }],
    listMaterialCatalogItemsForBusiness: async () => [{ id: 'gravel', name: 'A Gravel' }],
  });
  const response = { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'GET', query: { estimateId: 'estimate-a', budgetId: 'foreign-budget' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.budget.id, budgetId);
  assert.equal(response.body.catalog.labour.length, 2);

  const divisionResponse = { ...response, statusCode: 200, body: null };
  await handler({ method: 'GET', query: { estimateId: 'estimate-a', divisionId: 'hardscape' } }, divisionResponse);
  assert.equal(divisionResponse.statusCode, 200);
  assert.equal(divisionResponse.body.catalog.labour.every((item) => item.divisionId === 'hardscape'), true);

  const forgedDivisionResponse = { ...response, statusCode: 200, body: null };
  await handler({ method: 'GET', query: { estimateId: 'estimate-a', divisionId: 'foreign-division' } }, forgedDivisionResponse);
  assert.equal(forgedDivisionResponse.statusCode, 200);
  assert.equal(forgedDivisionResponse.body.catalog.labour.every((item) => item.divisionId === 'hardscape'), true);

  const foreignResponse = { ...response, statusCode: 200, body: null };
  await handler({ method: 'GET', query: { estimateId: 'foreign-estimate' } }, foreignResponse);
  assert.equal(foreignResponse.statusCode, 404);
});
