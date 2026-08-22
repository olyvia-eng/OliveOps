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
  { id: 'admin', budgetId: 'budget', divisionId: 'hardscape', category: 'labour', compType: 'salaried', annualSalary: 50000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', percentage: 50 }, { divisionId: 'snow', percentage: 50 }] },
  { id: 'excavator', budgetId: 'budget', divisionId: 'hardscape', category: 'equipment', classification: 'billable', plannedAmount: 120000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 7 }, { divisionId: 'snow', months: 5 }] },
  { id: 'truck', budgetId: 'budget', divisionId: 'hardscape', category: 'equipment', classification: 'overhead', plannedAmount: 24000, equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 6 }, { divisionId: 'snow', months: 6 }] },
  { id: 'stone', budgetId: 'budget', divisionId: 'hardscape', category: 'materials', unitCost: 100, plannedQuantity: 1000 },
  { id: 'salt', budgetId: 'budget', divisionId: 'snow', category: 'materials', plannedAmount: 80000 },
  { id: 'concrete', budgetId: 'budget', divisionId: 'hardscape', category: 'subcontractors', plannedAmount: 45000 },
  { id: 'plowing', budgetId: 'budget', divisionId: 'snow', category: 'subcontractors', rate: 500, plannedQuantity: 50 },
  { id: 'yard', budgetId: 'budget', divisionId: 'hardscape', category: 'overhead', plannedAmount: 15000 },
  { id: 'phones', budgetId: 'budget', divisionId: 'snow', category: 'overhead', plannedAmount: 5000 },
];

test('Division financials classify costs, apply shared allocations, and never double count', () => {
  const hardscape = model.calculateDivisionFinancials({ divisions, planningItems }, 'hardscape');
  assert.equal(hardscape.directLabour, 60000);
  assert.equal(hardscape.overheadLabour, 25000);
  assert.equal(hardscape.directEquipment, 70000);
  assert.equal(hardscape.overheadEquipment, 12000);
  assert.equal(hardscape.materials, 100000);
  assert.equal(hardscape.subcontractors, 45000);
  assert.equal(hardscape.divisionOverhead, 15000);
  assert.equal(hardscape.totalDirectCosts, 275000);
  assert.equal(hardscape.grossProfit, 675000);
  assert.equal(hardscape.grossMargin, 675000 / 950000 * 100);
  assert.equal(hardscape.operatingProfitBeforeCompanyOverhead, 623000);
  assert.equal(hardscape.allocatedCompanyOverhead, null);
});

test('Budget financials consolidate Divisions once and include company overhead once', () => {
  const result = model.calculateBudgetFinancials({ divisions, planningItems, companyOverheadItems: [{ budgeted: 30000 }, { budgeted: 20000 }] });
  assert.equal(result.revenue, 1550000);
  assert.equal(result.directLabour, 100000);
  assert.equal(result.overheadLabour, 50000);
  assert.equal(result.directEquipment, 120000);
  assert.equal(result.overheadEquipment, 24000);
  assert.equal(result.materials, 180000);
  assert.equal(result.subcontractors, 70000);
  assert.equal(result.divisionOverhead, 20000);
  assert.equal(result.totalDirectCosts, 470000);
  assert.equal(result.grossProfit, 1080000);
  assert.equal(result.grossMargin, 1080000 / 1550000 * 100);
  assert.equal(result.companyOverhead, 50000);
  assert.equal(result.totalOverhead, 144000);
  assert.equal(result.operatingProfit, 936000);
  assert.equal(result.operatingMargin, 936000 / 1550000 * 100);
});

test('Company Overhead reduces overall profit once without changing Division profitability', () => {
  const withoutCompanyOverhead = model.calculateBudgetFinancials({ divisions, planningItems, companyOverheadItems: [] });
  const withCompanyOverhead = model.calculateBudgetFinancials({ divisions, planningItems, companyOverheadItems: [{ budgeted: 50000 }] });

  assert.equal(withoutCompanyOverhead.operatingProfit - withCompanyOverhead.operatingProfit, 50000);
  assert.equal(withCompanyOverhead.companyOverhead, 50000);
  assert.equal(withCompanyOverhead.companyOverheadAllocated, false);
  assert.deepEqual(
    withCompanyOverhead.divisions.map((division) => [division.divisionId, division.divisionOverhead, division.operatingProfitBeforeCompanyOverhead, division.allocatedCompanyOverhead]),
    withoutCompanyOverhead.divisions.map((division) => [division.divisionId, division.divisionOverhead, division.operatingProfitBeforeCompanyOverhead, division.allocatedCompanyOverhead]),
  );
});

test('zero revenue and incomplete planning never present misleading profit', () => {
  const incomplete = model.calculateDivisionFinancials({ divisions: [{ ...divisions[0], revenueTarget: 0 }], planningItems: planningItems.filter((item) => item.category === 'labour') }, 'hardscape');
  assert.equal(incomplete.isComplete, false);
  assert.deepEqual(incomplete.missingCategories, ['equipment', 'materials', 'subcontractors']);
  assert.equal(incomplete.grossProfit, null);
  assert.equal(incomplete.grossMargin, null);
  assert.equal(incomplete.operatingProfitBeforeCompanyOverhead, null);
});

test('a configured zero-revenue Budget calculates dollars but never divides by zero', () => {
  const zeroRevenueDivisions = divisions.map((division) => ({ ...division, revenueTarget: 0 }));
  const result = model.calculateBudgetFinancials({ divisions: zeroRevenueDivisions, planningItems });
  assert.equal(result.isComplete, true);
  assert.equal(result.grossProfit, -470000);
  assert.equal(result.grossMargin, null);
  assert.equal(result.operatingProfit, -564000);
  assert.equal(result.operatingMargin, null);
});

test('duplicate snapshots of the same planning id are counted only once', () => {
  const result = model.calculateBudgetFinancials({ divisions, planningItems: [...planningItems, ...planningItems] });
  assert.equal(result.directLabour, 100000);
  assert.equal(result.directEquipment, 120000);
  assert.equal(result.overheadLabour, 50000);
  assert.equal(result.overheadEquipment, 24000);
});