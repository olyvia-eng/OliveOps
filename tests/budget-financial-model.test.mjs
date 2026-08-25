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
  { id: 'ryan', budgetId: 'budget', divisionId: 'hardscape', category: 'labour', compType: 'salaried', annualSalary: 100000, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] },
  { id: 'admin', budgetId: 'budget', divisionId: 'hardscape', category: 'labour', name: 'Office Administrator', compType: 'salaried', annualSalary: 50000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', percentage: 50 }, { divisionId: 'snow', percentage: 50 }] },
  { id: 'excavator', budgetId: 'budget', divisionId: 'hardscape', category: 'equipment', classification: 'billable', plannedAmount: 120000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 7 }, { divisionId: 'snow', months: 5 }] },
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