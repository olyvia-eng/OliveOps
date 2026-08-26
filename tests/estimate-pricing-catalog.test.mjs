import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAuthoritativeEstimatePricing, buildEstimatePricingCatalog } from '../api/_lib/estimatePricingCatalog.js';
import { createEstimatePricingCatalogHandler } from '../api/estimate-pricing-catalog.js';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const budgetId = 'budget-2027';
const calculatedBudget = { id: budgetId, name: '2027', status: 'active', planningModel: 'divisions_v1', targetMarginPct: 20, updatedAt: '2026-08-24T00:00:00.000Z' };
const calculatedDivisions = [{
  id: 'hardscape', budgetId, name: 'Hardscape', status: 'active',
  overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } },
}];
const calculatedPlanningItems = [
  { id: 'labour-ryan', budgetId, category: 'labour', employeeId: 'ryan', name: 'Ryan Field', compType: 'hourly', hourlyRate: 20, plannedHours: 500, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 500 }] },
  { id: 'labour-john', budgetId, category: 'labour', employeeId: 'john', name: 'John Field', compType: 'hourly', hourlyRate: 40, plannedHours: 500, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 500 }] },
  { id: 'equipment-bobcat', budgetId, category: 'equipment', divisionId: 'hardscape', equipmentId: 'bobcat', name: 'Bobcat E50', plannedAmount: 12000, sellableHoursPerYear: 1000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12 }] },
  { id: 'equipment-crew-truck', budgetId, category: 'equipment', divisionId: 'hardscape', equipmentId: 'crew-truck', name: 'Crew Truck', classification: 'billable', plannedAmount: 10000, sellableHoursPerYear: 500, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12 }] },
  { id: 'material-gravel', budgetId, category: 'materials', divisionId: 'hardscape', materialCatalogItemId: 'gravel', name: 'A Gravel', unit: 'tonne', unitCost: 10, plannedQuantity: 100 },
  { id: 'sub-concrete', budgetId, category: 'subcontractors', divisionId: 'hardscape', vendorId: 'concrete-co', name: 'Concrete Co', unit: 'job', rate: 100, plannedQuantity: 10 },
];
const calculatedEmployees = [
  { id: 'ryan', name: 'Ryan Field', labourClassId: 'class-labourer', compensationType: 'hourly', hourlyRate: 20, payrollBurdenPct: 0, benefitsExtraCost: 0, bonus: 0 },
  { id: 'john', name: 'John Field', labourClassId: 'class-labourer', compensationType: 'hourly', hourlyRate: 40, payrollBurdenPct: 0, benefitsExtraCost: 0, bonus: 0 },
];
const calculatedLabourClasses = [{ id: 'class-labourer', name: 'Labourer', description: 'General field labour', active: true, customRates: {}, updatedAt: '2026-08-24T00:00:00.000Z' }];
const buildCalculated = (items = calculatedPlanningItems, rates = budgetRates) => buildEstimatePricingCatalog({
  budget: calculatedBudget,
  budgetId,
  divisions: calculatedDivisions,
  divisionId: 'hardscape',
  planningItems: items,
  budgetRates: rates,
  employees: calculatedEmployees,
  labourClasses: calculatedLabourClasses,
  equipmentAssets: [{ id: 'bobcat', name: 'Bobcat E50', equipmentClassification: 'billable' }, { id: 'crew-truck', name: 'Crew Truck', equipmentClassification: 'overhead' }],
  materialCatalogItems: [{ id: 'gravel', name: 'A Gravel' }],
});
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

test('legacy Budget catalog deduplicates shared allocations and resolves saved prices by canonical identity', () => {
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

test('legacy catalog items snapshot authoritative saved values and reject cross-Budget sources', () => {
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

test('existing Estimate snapshots do not silently reprice or lose legacy employee identity', () => {
  const rateA = build();
  const existingLine = { id: 'line-ryan', category: 'labour', employeeId: 'ryan', employeeName: 'Ryan Field', sourceBudgetId: budgetId, sourceBudgetItemId: 'labour-ryan', sourceEntityId: 'ryan', sourceRateId: 'rate-ryan', itemName: 'Ryan Field', description: '', quantity: 8, unit: 'hr', unitCost: 42, sellPrice: 72, total: 576 };
  const rateB = build(budgetRates.map((rate) => rate.id === 'rate-bobcat' ? { ...rate, defaultSellPrice: 120 } : rate));
  assert.equal(rateA.equipment.find((item) => item.sourceEntityId === 'bobcat').approvedRate, 95);
  assert.equal(rateB.equipment.find((item) => item.sourceEntityId === 'bobcat').approvedRate, 120);

  const result = applyAuthoritativeEstimatePricing({
    existingEstimate: { id: 'estimate-a', pricingBudgetId: budgetId, lineItems: [existingLine], workAreas: [] },
    nextEstimate: { id: 'estimate-a', pricingBudgetId: budgetId, lineItems: [{ ...existingLine, description: 'Ten planned hours', quantity: 10, unitCost: 1, sellPrice: 999, markupPercent: 999, total: 9990 }], workAreas: [] },
    catalog: rateB,
  });
  assert.equal(result.ok, true);
  assert.equal(result.estimate.lineItems[0].sellPrice, 72);
  assert.equal(result.estimate.lineItems[0].unitCost, 42);
  assert.equal(result.estimate.lineItems[0].quantity, 10);
  assert.equal(result.estimate.lineItems[0].description, 'Ten planned hours');
  assert.equal(result.estimate.lineItems[0].total, 720);
  assert.equal(result.estimate.lineItems[0].employeeId, 'ryan');
  assert.equal(result.estimate.lineItems[0].employeeName, 'Ryan Field');
});

test('calculated Division Labour pricing exposes a class without employee identities', () => {
  const catalog = buildCalculated();
  assert.deepEqual(catalog.labour.map((item) => [item.name, item.labourClassId, item.sellRate, item.costRate, item.pricingStatus]), [
    ['Labourer', 'class-labourer', 37.5, 30, 'calculated'],
  ]);
  assert.equal(JSON.stringify(catalog.labour).includes('Ryan Field'), false);
  assert.equal(JSON.stringify(catalog.labour).includes('John Field'), false);

  const requested = { id: 'line-average', category: 'labour', divisionId: 'hardscape', sourceBudgetId: budgetId, sourceBudgetItemId: 'labour-class:class-labourer', sourceEntityId: 'class-labourer', itemName: '', description: '', quantity: 10, unit: 'hr', unitCost: 0, sellPrice: 0, total: 0 };
  const result = applyAuthoritativeEstimatePricing({ existingEstimate: { lineItems: [], workAreas: [] }, nextEstimate: { id: 'estimate-average', pricingBudgetId: budgetId, lineItems: [requested], workAreas: [] }, catalog });
  assert.equal(result.ok, true);
  assert.equal(result.estimate.lineItems[0].itemName, 'Labourer');
  assert.equal(result.estimate.lineItems[0].labourClassId, 'class-labourer');
  assert.equal(result.estimate.lineItems[0].unitCost, 30);
  assert.equal(result.estimate.lineItems[0].sellPrice, 37.5);
  assert.equal(result.estimate.lineItems[0].total, 375);
  assert.equal(result.estimate.lineItems[0].markupPercent, 0);

  const forgedClass = applyAuthoritativeEstimatePricing({
    existingEstimate: { lineItems: [], workAreas: [] },
    nextEstimate: { id: 'estimate-forged', pricingBudgetId: budgetId, lineItems: [{ ...requested, id: 'line-forged', sourceEntityId: 'class-from-another-business' }], workAreas: [] },
    catalog,
  });
  assert.equal(forgedClass.ok, false);
  assert.match(forgedClass.error, /source identity is invalid/);

  const authorizationCatalog = buildEstimatePricingCatalog({ budget: calculatedBudget, budgetId, divisions: calculatedDivisions, includeAllDivisions: true, planningItems: calculatedPlanningItems, budgetRates, employees: calculatedEmployees, labourClasses: calculatedLabourClasses });
  const authorized = applyAuthoritativeEstimatePricing({ existingEstimate: { lineItems: [], workAreas: [] }, nextEstimate: { id: 'estimate-average', pricingBudgetId: budgetId, lineItems: [requested], workAreas: [] }, catalog: authorizationCatalog });
  assert.equal(authorized.ok, true);
  assert.equal(authorized.estimate.lineItems[0].sourceRateId, undefined);
  assert.equal(authorized.estimate.lineItems[0].sellPrice, 37.5);
});

test('Labour Class custom rate overrides calculated rate without truthiness fallback', () => {
  const catalog = buildEstimatePricingCatalog({
    budget: calculatedBudget, budgetId, divisions: calculatedDivisions, divisionId: 'hardscape', planningItems: calculatedPlanningItems,
    budgetRates: [], employees: calculatedEmployees, labourClasses: [{ ...calculatedLabourClasses[0], customRates: { hardscape: 68 } }],
  });
  assert.deepEqual([catalog.labour[0].calculatedRate, catalog.labour[0].customRate, catalog.labour[0].estimateRate, catalog.labour[0].sellRate], [37.5, 68, 68, 68]);
});

test('the selected Division resolves its own rate for the same Labour Class', () => {
  const snowDivision = { ...calculatedDivisions[0], id: 'snow', name: 'Snow Removal' };
  const sharedPlans = calculatedPlanningItems.map((item) => item.category === 'labour'
    ? { ...item, plannedHours: 1000, divisionAllocations: [{ divisionId: 'hardscape', hours: 500 }, { divisionId: 'snow', hours: 500 }] }
    : item);
  const labourClasses = [{ ...calculatedLabourClasses[0], customRates: { hardscape: 68, snow: 97 } }];
  const buildForDivision = (selectedDivisionId) => buildEstimatePricingCatalog({
    budget: calculatedBudget, budgetId, divisions: [...calculatedDivisions, snowDivision], divisionId: selectedDivisionId,
    planningItems: sharedPlans, budgetRates: [], employees: calculatedEmployees, labourClasses,
  });

  const hardscape = buildForDivision('hardscape');
  const snow = buildForDivision('snow');
  assert.deepEqual(hardscape.labour.map((item) => [item.name, item.divisionId, item.estimateRate]), [['Labourer', 'hardscape', 68]]);
  assert.deepEqual(snow.labour.map((item) => [item.name, item.divisionId, item.estimateRate]), [['Labourer', 'snow', 97]]);
});

test('Estimate equipment eligibility excludes overhead assets without altering historical snapshots', () => {
  const catalog = buildCalculated(calculatedPlanningItems, []);
  assert.deepEqual(catalog.equipment.map((item) => [item.name, item.pricingAvailable]), [['Bobcat E50', true]]);

  const billableRequest = { id: 'line-bobcat-new', category: 'equipment', sourceBudgetId: budgetId, sourceBudgetItemId: 'equipment-bobcat', sourceEntityId: 'bobcat', divisionId: 'hardscape', quantity: 3 };
  const added = applyAuthoritativeEstimatePricing({
    existingEstimate: { lineItems: [], workAreas: [] },
    nextEstimate: { pricingBudgetId: budgetId, lineItems: [billableRequest], workAreas: [] },
    catalog,
  });
  assert.equal(added.ok, true);
  assert.deepEqual([added.estimate.lineItems[0].itemName, added.estimate.lineItems[0].sellPrice], ['Bobcat E50', 15]);

  const forgedOverhead = applyAuthoritativeEstimatePricing({
    existingEstimate: { lineItems: [], workAreas: [] },
    nextEstimate: { pricingBudgetId: budgetId, lineItems: [{ ...billableRequest, id: 'line-truck-new', sourceBudgetItemId: 'equipment-crew-truck', sourceEntityId: 'crew-truck' }], workAreas: [] },
    catalog,
  });
  assert.equal(forgedOverhead.ok, false);

  const historical = {
    id: 'line-truck-existing', category: 'equipment', sourceBudgetId: budgetId, sourceBudgetItemId: 'equipment-crew-truck', sourceEntityId: 'crew-truck',
    itemName: 'Crew Truck', description: 'Historical item', quantity: 2, unit: 'hr', unitCost: 20, sellPrice: 40, total: 80,
  };
  const preserved = applyAuthoritativeEstimatePricing({
    existingEstimate: { pricingBudgetId: budgetId, lineItems: [historical], workAreas: [] },
    nextEstimate: { pricingBudgetId: budgetId, lineItems: [{ ...historical, quantity: 4 }], workAreas: [] },
    catalog,
  });
  assert.equal(preserved.ok, true);
  assert.deepEqual([preserved.estimate.lineItems[0].itemName, preserved.estimate.lineItems[0].sellPrice, preserved.estimate.lineItems[0].quantity, preserved.estimate.lineItems[0].total], ['Crew Truck', 40, 4, 160]);
});

test('Budget Analysis and Estimate authorization use current Employee compensation over stale Labour plans', () => {
  const employees = calculatedEmployees.map((employee) => employee.id === 'ryan'
    ? { ...employee, hourlyRate: 60 }
    : { ...employee, hourlyRate: 20 });
  const rows = buildBudgetPricingRows({
    budget: calculatedBudget,
    divisions: calculatedDivisions,
    planningItems: calculatedPlanningItems,
    budgetRates: [],
    employees,
    labourClasses: calculatedLabourClasses,
  });
  const catalog = buildEstimatePricingCatalog({
    budget: calculatedBudget,
    budgetId,
    divisions: calculatedDivisions,
    divisionId: 'hardscape',
    planningItems: calculatedPlanningItems,
    budgetRates: [],
    employees,
    labourClasses: calculatedLabourClasses,
  });
  const labourRow = rows.find((row) => row.item.labourClassId === 'class-labourer');

  assert.equal(labourRow.costRate, 40);
  assert.equal(labourRow.sellRate, undefined);
  assert.deepEqual(catalog.labour.map((item) => [item.sourceEntityId, item.costRate, item.sellRate]), [
    ['class-labourer', 40, 50],
  ]);

  const requested = { id: 'line-current', category: 'labour', divisionId: 'hardscape', sourceBudgetId: budgetId, sourceBudgetItemId: 'labour-class:class-labourer', sourceEntityId: 'class-labourer', quantity: 2 };
  const added = applyAuthoritativeEstimatePricing({ existingEstimate: { lineItems: [], workAreas: [] }, nextEstimate: { pricingBudgetId: budgetId, lineItems: [requested], workAreas: [] }, catalog });
  assert.equal(added.ok, true);
  assert.deepEqual([added.estimate.lineItems[0].unitCost, added.estimate.lineItems[0].sellPrice], [40, 50]);

  const changedCatalog = buildEstimatePricingCatalog({
    budget: calculatedBudget,
    budgetId,
    divisions: calculatedDivisions,
    divisionId: 'hardscape',
    planningItems: calculatedPlanningItems,
    budgetRates: [],
    employees: employees.map((employee) => ({ ...employee, hourlyRate: 100 })),
    labourClasses: calculatedLabourClasses,
  });
  const preserved = applyAuthoritativeEstimatePricing({ existingEstimate: added.estimate, nextEstimate: structuredClone(added.estimate), catalog: changedCatalog });
  assert.deepEqual([preserved.estimate.lineItems[0].unitCost, preserved.estimate.lineItems[0].sellPrice], [40, 50]);
});

test('true financial-model incompleteness does not fall back to legacy employee approvals', () => {
  const noBillableLabour = calculatedPlanningItems.map((item) => item.category === 'labour'
    ? { ...item, expectedBillablePct: 0, approvedRate: 999, costRate: 999 }
    : item);
  const catalog = buildCalculated(noBillableLabour);

  assert.deepEqual(catalog.labour.map((item) => [item.name, item.sellRate, item.pricingAvailable, item.pricingStatus]), [
    ['Labourer', null, false, 'unavailable'],
  ]);
  assert.match(catalog.labour[0].pricingReason, /No planned billable hours/);
});

test('all Division categories use calculated pricing without saved approval records', () => {
  const catalog = buildCalculated(calculatedPlanningItems, []);
  assert.deepEqual({
    labour: catalog.labour.map((item) => item.sellRate),
    equipment: catalog.equipment.map((item) => item.sellRate),
    materials: catalog.materials.map((item) => item.sellRate),
    subcontractors: catalog.subcontractors.map((item) => item.sellRate),
  }, {
    labour: [37.5],
    equipment: [15],
    materials: [12.5],
    subcontractors: [125],
  });
  assert.equal([catalog.labour, catalog.equipment, catalog.materials, catalog.subcontractors]
    .flat().every((item) => item.pricingAvailable && item.pricingStatus === 'calculated' && item.approvedRate === null), true);

  const requested = [
    ['line-labourer', 'labour-class:class-labourer', 'class-labourer', 8],
    ['line-bobcat', 'equipment-bobcat', 'bobcat', 8],
    ['line-gravel', 'material-gravel', 'gravel', 20],
    ['line-concrete', 'sub-concrete', 'concrete-co', 1],
  ].map(([id, sourceBudgetItemId, sourceEntityId, quantity]) => ({
    id, sourceBudgetId: budgetId, sourceBudgetItemId, sourceEntityId, divisionId: 'hardscape', quantity,
  }));
  const result = applyAuthoritativeEstimatePricing({
    existingEstimate: { lineItems: [], workAreas: [] },
    nextEstimate: { id: 'estimate-calculated', pricingBudgetId: budgetId, lineItems: requested, workAreas: [] },
    catalog,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.estimate.lineItems.map((item) => [item.category, item.unitCost, item.sellPrice, item.total]), [
    ['labour', 30, 37.5, 300],
    ['equipment', 12, 15, 120],
    ['material', 10, 12.5, 250],
    ['subcontractor', 100, 125, 125],
  ]);
});

test('new Estimates use explicit custom equipment rates without reinterpreting legacy sell prices', () => {
  const rate = { id: 'equipment-custom', budgetId, budgetItemId: 'equipment-bobcat', equipmentId: 'bobcat', category: 'equipment', pricingVersion: 2, divisionId: 'hardscape', defaultSellPrice: 32.43, customRate: 35, active: true };
  const catalog = buildCalculated(calculatedPlanningItems, [rate]);
  const equipment = catalog.equipment[0];
  assert.deepEqual([equipment.calculatedRate, equipment.customRate, equipment.estimateRate, equipment.sellRate], [15, 35, 35, 35]);

  const requested = { id: 'line-custom-equipment', sourceBudgetId: budgetId, sourceBudgetItemId: 'equipment-bobcat', sourceEntityId: 'bobcat', divisionId: 'hardscape', quantity: 2 };
  const result = applyAuthoritativeEstimatePricing({
    existingEstimate: { lineItems: [], workAreas: [] },
    nextEstimate: { id: 'estimate-custom-equipment', pricingBudgetId: budgetId, lineItems: [requested], workAreas: [] },
    catalog,
  });
  assert.equal(result.ok, true);
  assert.deepEqual([result.estimate.lineItems[0].sellPrice, result.estimate.lineItems[0].calculatedRateAtEstimate, result.estimate.lineItems[0].customRateAtEstimate, result.estimate.lineItems[0].estimateRateAtEstimate], [35, 15, 35, 35]);
});

test('Division catalog snapshots calculated labour components immutably', () => {
  const catalog = buildCalculated();
  const labourer = catalog.labour.find((item) => item.labourClassId === 'class-labourer');
  assert.equal(labourer.sourceRateId, undefined);
  assert.equal(labourer.divisionId, 'hardscape');
  assert.equal(labourer.sellRate, 37.5);

  const requested = { id: 'line-v2', category: 'labour', divisionId: 'hardscape', sourceBudgetId: budgetId, sourceBudgetItemId: 'labour-class:class-labourer', sourceEntityId: 'class-labourer', itemName: '', description: '', quantity: 2, unit: 'hr', unitCost: 0, sellPrice: 0, total: 0 };
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
  }, { pricingVersion: 2, direct: 30, division: 0, company: 0, recovered: 30, margin: 20, recommended: 37.5, approved: 37.5 });

  const changedCatalog = structuredClone(catalog);
  changedCatalog.labour.find((item) => item.labourClassId === 'class-labourer').sellRate = 100;
  const unchanged = applyAuthoritativeEstimatePricing({ existingEstimate: result.estimate, nextEstimate: structuredClone(result.estimate), catalog: changedCatalog });
  assert.equal(unchanged.estimate.lineItems[0].sellPrice, 37.5);
  assert.equal(unchanged.estimate.lineItems[0].labourClassName, 'Labourer');
});

test('adding legacy Labour, Equipment, Material, and Subcontractor pricing preserves Estimate totals', () => {
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
  assert.deepEqual(result.estimate.lineItems.map((item) => item.markupPercent), [0, 0, 0, 0]);
});

test('pricing endpoint derives the selected Budget from the tenant-owned Estimate', async () => {
  const handler = createEstimatePricingCatalogHandler({
    requireSession: async () => ({ businessId: 'biz-a', role: 'admin' }),
    getEstimateForBusiness: async (businessId, estimateId) => businessId === 'biz-a' && estimateId === 'estimate-a' ? { id: estimateId, pricingBudgetId: budgetId, divisionId: 'hardscape' } : null,
    getBudgetForBusiness: async (businessId, requestedBudgetId) => businessId === 'biz-a' && requestedBudgetId === budgetId ? calculatedBudget : null,
    getBudgetDivisionForBusiness: async (businessId, requestedBudgetId, divisionId) => businessId === 'biz-a' && requestedBudgetId === budgetId && divisionId === 'hardscape' ? calculatedDivisions[0] : null,
    listBudgetDivisionsForBusiness: async (businessId) => businessId === 'biz-a' ? calculatedDivisions : [],
    listDivisionPlanningItemsForBusiness: async (businessId) => businessId === 'biz-a' ? calculatedPlanningItems : [],
    listBudgetRatesForBusiness: async (businessId) => businessId === 'biz-a' ? budgetRates : [],
    listEmployeesForBusiness: async () => calculatedEmployees,
    listEquipmentAssetsForBusiness: async () => [{ id: 'bobcat', name: 'Bobcat E50' }, { id: 'truck', name: 'Dump Truck' }],
    listLabourClassesForBusiness: async () => calculatedLabourClasses,
    listMaterialCatalogItemsForBusiness: async () => [{ id: 'gravel', name: 'A Gravel' }],
  });
  const response = { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'GET', query: { estimateId: 'estimate-a', budgetId: 'foreign-budget' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.budget.id, budgetId);
  assert.equal(response.body.catalog.labour.length, 1);
  assert.deepEqual(response.body.catalog.labour.map((item) => [item.sourceEntityId, item.sellRate, item.pricingAvailable]), [
    ['class-labourer', 37.5, true],
  ]);

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
