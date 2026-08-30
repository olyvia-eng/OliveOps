import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['src/pages/budget/budgetFinancialModel.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const divisions = [
  { id: 'hardscape', budgetId: 'budget', name: 'Hardscaping', revenueTarget: 950000, status: 'active', sortOrder: 0 },
  { id: 'snow', budgetId: 'budget', name: 'Snow & Ice', revenueTarget: 600000, status: 'active', sortOrder: 1 },
];
const planningItems = [
  { id: 'ryan', budgetId: 'budget', divisionId: 'hardscape', category: 'labour', compType: 'salaried', annualSalary: 100000, plannedHours: 2000, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] },
  { id: 'admin', budgetId: 'budget', divisionId: 'hardscape', category: 'labour', name: 'Office Administrator', compType: 'salaried', annualSalary: 50000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', percentage: 50 }, { divisionId: 'snow', percentage: 50 }] },
  { id: 'excavator', budgetId: 'budget', divisionId: 'hardscape', category: 'equipment', classification: 'billable', plannedAmount: 120000, yearlyMaintenanceCost: 12000, yearlyFuelCost: 24000, yearlyInsuranceCost: 6000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 7 }, { divisionId: 'snow', months: 5 }] },
  { id: 'truck', budgetId: 'budget', divisionId: 'hardscape', category: 'equipment', name: 'Crew Truck - 101', classification: 'overhead', plannedAmount: 24000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 6 }, { divisionId: 'snow', months: 6 }] },
  { id: 'stone', budgetId: 'budget', divisionId: 'hardscape', category: 'materials', unitCost: 100, plannedQuantity: 1000 },
  { id: 'salt', budgetId: 'budget', divisionId: 'snow', category: 'materials', plannedAmount: 80000 },
  { id: 'concrete', budgetId: 'budget', divisionId: 'hardscape', category: 'subcontractors', plannedAmount: 45000 },
  { id: 'plowing', budgetId: 'budget', divisionId: 'snow', category: 'subcontractors', rate: 500, plannedQuantity: 50 },
  { id: 'yard', budgetId: 'budget', divisionId: 'hardscape', category: 'overhead', name: 'Shop / Rent', plannedAmount: 15000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 100 }] },
  { id: 'phones', budgetId: 'budget', divisionId: 'snow', category: 'overhead', name: 'Phones', plannedAmount: 5000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 0 }, { divisionId: 'snow', percentage: 100 }] },
  { id: 'secretary', budgetId: 'budget', divisionId: 'hardscape', category: 'overhead', name: 'Insurance', plannedAmount: 60000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 40 }, { divisionId: 'snow', percentage: 60 }] },
];

test('Division financials classify costs, apply shared allocations, and never double count', () => {
  const hardscape = model.calculateDivisionFinancials({ divisions, planningItems }, 'hardscape');
  assert.equal(hardscape.directLabour, 60000);
  assert.equal(hardscape.overheadLabour, 25000);
  assert.equal(hardscape.directEquipment, 70000);
  assert.equal(hardscape.overheadEquipment, 12000);
  assert.equal(hardscape.materials, 100000);
  assert.equal(hardscape.subcontractors, 45000);
  assert.equal(hardscape.allocatedOverhead, 39000);
  assert.equal(hardscape.totalDirectCosts, 275000);
  assert.equal(hardscape.grossProfit, 675000);
  assert.equal(hardscape.grossMargin, 675000 / 950000 * 100);
  assert.equal(hardscape.operatingProfit, 599000);
});

test('Division overhead detail exposes each allocated source and reconciles to Total Overhead', () => {
  const hardscape = model.calculateDivisionFinancials({ divisions, planningItems }, 'hardscape');

  assert.deepEqual(hardscape.overheadItems, [
    { itemId: 'admin', name: 'Office Administrator', category: 'labour', amount: 25000 },
    { itemId: 'truck', name: 'Crew Truck - 101', category: 'equipment', amount: 12000 },
    { itemId: 'yard', name: 'Shop / Rent', category: 'other', amount: 15000 },
    { itemId: 'secretary', name: 'Insurance', category: 'other', amount: 24000 },
  ]);
  assert.equal(hardscape.overheadItems.some((item) => item.itemId === 'phones'), false);
  assert.equal(hardscape.overheadItems.reduce((sum, item) => sum + item.amount, 0), hardscape.totalOverhead);
});

test('Division direct-cost detail exposes allocated sources and reconciles by category', () => {
  const hardscape = model.calculateDivisionFinancials({ divisions, planningItems }, 'hardscape');
  assert.deepEqual(hardscape.directCostItems.map((item) => [item.itemId, item.category, item.amount]), [
    ['ryan', 'labour', 60000],
    ['excavator', 'equipment', 70000],
    ['stone', 'materials', 100000],
    ['concrete', 'subcontractors', 45000],
  ]);
  assert.equal(hardscape.directCostItems.reduce((sum, item) => sum + item.amount, 0), hardscape.totalDirectCosts);
});

test('Division equipment composition uses allocated source economics and reconciles to authoritative total', () => {
  const hardscape = model.calculateDivisionFinancials({ divisions, planningItems }, 'hardscape');
  assert.deepEqual(hardscape.equipmentCostComposition, {
    maintenance: 7000,
    fuel: 14000,
    insurance: 3500,
    replacementReserve: 0,
    paymentsOther: 45500,
  });
  assert.equal(Object.values(hardscape.equipmentCostComposition).reduce((sum, value) => sum + value, 0), hardscape.directEquipment);
});

test('Division revenue per hour uses allocated expected billable hours and handles zero safely', () => {
  const hardscape = model.calculateDivisionFinancials({ divisions, planningItems }, 'hardscape');
  const snow = model.calculateDivisionFinancials({ divisions, planningItems }, 'snow');
  assert.equal(hardscape.plannedBillableHours, 960);
  assert.equal(hardscape.revenuePerHour, 950000 / 960);
  assert.equal(snow.plannedBillableHours, 640);
  assert.equal(snow.revenuePerHour, 600000 / 640);

  const noHours = model.calculateDivisionFinancials({ divisions, planningItems: planningItems.filter((item) => item.category !== 'labour') }, 'hardscape');
  assert.equal(noHours.plannedBillableHours, 0);
  assert.equal(noHours.revenuePerHour, null);
});

test('Snow Removal live-shape allocations produce 3,376 billable hours and $2.96 revenue per hour', () => {
  const snowDivision = [{ id: 'snow-live', budgetId: 'snow-budget', name: 'Snow Removal', revenueTarget: 10000, status: 'active', sortOrder: 0 }];
  const snowLabour = [
    { id: 'matt', budgetId: 'snow-budget', divisionId: 'snow-live', category: 'labour', name: 'Matt Jones', plannedHours: 1900, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'snow-live', hours: 950 }, { divisionId: 'landscape-live', hours: 950 }] },
    { id: 'jane', budgetId: 'snow-budget', divisionId: 'landscape-live', category: 'labour', name: 'Jane Smith', plannedHours: 1900, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'snow-live', hours: 950 }, { divisionId: 'landscape-live', hours: 950 }] },
    { id: 'john', budgetId: 'snow-budget', divisionId: 'snow-live', category: 'labour', name: 'John Smith', plannedHours: 1600, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'snow-live', hours: 800 }, { divisionId: 'landscape-live', hours: 800 }] },
    { id: 'mike', budgetId: 'snow-budget', divisionId: 'snow-live', category: 'labour', name: 'Mike White', plannedHours: 1900, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'snow-live', hours: 1520 }, { divisionId: 'landscape-live', hours: 380 }] },
  ];

  const snow = model.calculateDivisionFinancials({ divisions: snowDivision, planningItems: [...snowLabour, structuredClone(snowLabour[0])] }, 'snow-live');
  assert.equal(snow.plannedBillableHours, 3376);
  assert.equal(snow.revenuePerHour, 10000 / 3376);
  assert.equal(Number(snow.revenuePerHour.toFixed(2)), 2.96);
});

test('shared overhead detail shows only each Division allocated share', () => {
  const hardscape = model.calculateDivisionFinancials({ divisions, planningItems }, 'hardscape');
  const snow = model.calculateDivisionFinancials({ divisions, planningItems }, 'snow');

  assert.equal(hardscape.overheadItems.find((item) => item.itemId === 'secretary')?.amount, 24000);
  assert.equal(snow.overheadItems.find((item) => item.itemId === 'secretary')?.amount, 36000);
});

test('Budget financials roll up allocated Division overhead and count shared costs once', () => {
  const result = model.calculateBudgetFinancials({ divisions, planningItems });
  assert.equal(result.revenue, 1550000);
  assert.equal(result.directLabour, 100000);
  assert.equal(result.overheadLabour, 50000);
  assert.equal(result.directEquipment, 120000);
  assert.equal(result.overheadEquipment, 24000);
  assert.equal(result.materials, 180000);
  assert.equal(result.subcontractors, 70000);
  assert.equal(result.allocatedOverhead, 80000);
  assert.equal(result.totalDirectCosts, 470000);
  assert.equal(result.grossProfit, 1080000);
  assert.equal(result.grossMargin, 1080000 / 1550000 * 100);
  assert.equal(result.totalOverhead, 154000);
  assert.equal(result.operatingProfit, 926000);
  assert.equal(result.operatingMargin, 926000 / 1550000 * 100);
  assert.equal(result.divisions.reduce((sum, division) => sum + division.allocatedOverhead, 0), 80000);
  assert.equal(result.overheadItems.reduce((sum, item) => sum + item.amount, 0), result.totalOverhead);
  assert.equal(result.directCostItems.reduce((sum, item) => sum + item.amount, 0), result.totalDirectCosts);
  assert.equal(result.directCostItems.find((item) => item.itemId === 'ryan')?.amount, 100000);
  assert.equal(Object.values(result.equipmentCostComposition).reduce((sum, value) => sum + value, 0), result.directEquipment);
  assert.deepEqual(result.overheadItems.find((item) => item.itemId === 'secretary'), {
    itemId: 'secretary', name: 'Insurance', category: 'other', amount: 60000,
  });
});

test('overall P&L equals the roll-up of Division operating results', () => {
  const result = model.calculateBudgetFinancials({ divisions, planningItems });
  assert.equal(result.operatingProfit, result.divisions.reduce((sum, division) => sum + division.operatingProfit, 0));
});

test('changing one Division revenue target recalculates its results and the overall Budget only once', () => {
  const revisedDivisions = divisions.map((division) => division.id === 'hardscape' ? { ...division, revenueTarget: 1050000 } : division);
  const hardscape = model.calculateDivisionFinancials({ divisions: revisedDivisions, planningItems }, 'hardscape');
  const snow = model.calculateDivisionFinancials({ divisions: revisedDivisions, planningItems }, 'snow');
  const budget = model.calculateBudgetFinancials({ divisions: revisedDivisions, planningItems });

  assert.equal(hardscape.revenue, 1050000);
  assert.equal(hardscape.grossProfit, 775000);
  assert.equal(hardscape.grossMargin, 775000 / 1050000 * 100);
  assert.equal(snow.revenue, 600000);
  assert.equal(budget.revenue, 1650000);
  assert.equal(budget.grossProfit, 1180000);
  assert.equal(budget.operatingProfit, 1026000);
});

test('zero revenue and incomplete planning never present misleading profit', () => {
  const incomplete = model.calculateDivisionFinancials({ divisions: [{ ...divisions[0], revenueTarget: 0 }], planningItems: planningItems.filter((item) => item.category === 'labour') }, 'hardscape');
  assert.equal(incomplete.isComplete, false);
  assert.deepEqual(incomplete.missingCategories, ['equipment', 'materials', 'subcontractors']);
  assert.equal(incomplete.grossProfit, null);
  assert.equal(incomplete.grossMargin, null);
  assert.equal(incomplete.operatingProfit, null);
});

test('a configured zero-revenue Budget calculates dollars but never divides by zero', () => {
  const zeroRevenueDivisions = divisions.map((division) => ({ ...division, revenueTarget: 0 }));
  const result = model.calculateBudgetFinancials({ divisions: zeroRevenueDivisions, planningItems });
  assert.equal(result.isComplete, true);
  assert.equal(result.grossProfit, -470000);
  assert.equal(result.grossMargin, null);
  assert.equal(result.operatingProfit, -624000);
  assert.equal(result.operatingMargin, null);
});

test('duplicate snapshots of the same planning id are counted only once', () => {
  const result = model.calculateBudgetFinancials({ divisions, planningItems: [...planningItems, ...planningItems] });
  assert.equal(result.directLabour, 100000);
  assert.equal(result.directEquipment, 120000);
  assert.equal(result.overheadLabour, 50000);
  assert.equal(result.overheadEquipment, 24000);
});

test('linked Catalog classification and ownership control financial placement and reserve composition', () => {
  const equipment = {
    id: 'owned-loader', equipmentId: 'loader', budgetId: 'budget', divisionId: 'hardscape', category: 'equipment',
    classification: 'billable', plannedAmount: 28000, yearlyFuelCost: 4000, yearlyInsuranceCost: 2000, yearlyMaintenanceCost: 4000,
    expectedReplacementCost: 120000, expectedResaleValue: 30000, remainingUsefulMonths: 60,
    equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12 }],
  };
  const asset = { id: 'loader', name: 'Owned Loader', costType: 'owned', equipmentClassification: 'overhead' };
  const scopedItems = [...planningItems.filter((item) => item.id !== 'truck' && item.id !== 'excavator'), equipment];
  const result = model.calculateDivisionFinancials({ divisions, planningItems: scopedItems, equipmentAssets: [asset] }, 'hardscape');

  assert.equal(result.directCostItems.some((item) => item.itemId === 'owned-loader'), false);
  assert.deepEqual(result.overheadItems.find((item) => item.itemId === 'owned-loader'), { itemId: 'owned-loader', name: 'Owned Loader', category: 'equipment', amount: 28000 });

  const directResult = model.calculateDivisionFinancials({ divisions, planningItems: scopedItems, equipmentAssets: [{ ...asset, equipmentClassification: 'billable' }] }, 'hardscape');
  assert.equal(directResult.equipmentCostComposition.replacementReserve, 18000);
  assert.equal(Object.values(directResult.equipmentCostComposition).reduce((sum, value) => sum + value, 0), directResult.directEquipment);
  assert.equal(directResult.equipmentCostComposition.paymentsOther, 0);
});