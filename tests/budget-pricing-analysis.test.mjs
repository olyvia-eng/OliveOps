import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const pricingSource = readFileSync('src/components/budget/BudgetPricingAnalysis.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');

const budget = {
  id: 'budget-2027', targetMarginPct: 20,
};
const divisions = [{ id: 'hardscape', budgetId: budget.id, name: 'Hardscaping', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 50, equipmentPercent: 30, materialsPercent: 20, subcontractorsPercent: 0 } } }];
const planningItems = [
  { id: 'ryan', budgetId: budget.id, divisionId: 'hardscape', category: 'labour', employeeId: 'employee-ryan', name: 'Ryan', compType: 'hourly', hourlyRate: 30, plannedHours: 2000, expectedBillablePct: 80, payrollBurdenPct: 20, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 2000 }] },
  { id: 'bobcat', budgetId: budget.id, divisionId: 'hardscape', category: 'equipment', equipmentId: 'equipment-bobcat', name: 'Bobcat E50', plannedAmount: 52000, sellableHoursPerYear: 1200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12, sellableHours: 1200 }] },
  { id: 'gravel', budgetId: budget.id, divisionId: 'hardscape', category: 'materials', materialCatalogItemId: 'material-gravel', name: 'A Gravel', unit: 'tonne', unitCost: 28, plannedQuantity: 100 },
  { id: 'concrete', budgetId: budget.id, divisionId: 'hardscape', category: 'subcontractors', name: 'Concrete Co', unit: 'hr', rate: 100, plannedQuantity: 50 },
  { id: 'shared-overhead', budgetId: budget.id, divisionId: 'hardscape', category: 'overhead', name: 'Office', plannedAmount: 100000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 100 }] },
];

test('Budget Analysis creates one Average Labour row and resolves its Division approval', () => {
  const rows = buildBudgetPricingRows({
    budget,
    divisions,
    planningItems,
    budgetRates: [{ id: 'rate-average-labour', budgetId: budget.id, budgetItemId: 'average-labour:hardscape', divisionId: 'hardscape', pricingVersion: 2, category: 'labour', defaultSellPrice: 80 }],
  });

  assert.equal(rows.length, 4);
  assert.equal(rows.some((row) => row.item.employeeId), false);
  const labour = rows.find((row) => row.item.id === 'average-labour:hardscape');
  assert.equal(labour.item.name, 'Average Labour');
  assert.equal(labour.costRate, 45);
  assert.equal(labour.billableHours, 1600);
  assert.equal(labour.overheadPerUnit, 31.25);
  assert.equal(labour.recommendedRate, 95.3125);
  assert.equal(labour.approvedRate, 80);
  assert.equal(labour.pricingStatus, 'approved');

  const equipment = rows.find((row) => row.item.id === 'bobcat');
  assert.ok(Math.abs(equipment.costRate - 43.3333333333) < 0.000001);
  assert.equal(equipment.overheadPerUnit, 25);
  assert.ok(Math.abs(equipment.recommendedRate - 85.4166666667) < 0.000001);
});

test('Average Labour is weighted by allocated billable hours and excludes overhead employees', () => {
  const twoDivisions = [
    divisions[0],
    { id: 'snow', budgetId: budget.id, name: 'Snow', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } },
  ];
  const items = [
    { id: 'senior', budgetId: budget.id, category: 'labour', name: 'Senior', compType: 'hourly', hourlyRate: 40, plannedHours: 1000, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 750 }, { divisionId: 'snow', hours: 250 }] },
    { id: 'junior', budgetId: budget.id, category: 'labour', name: 'Junior', compType: 'hourly', hourlyRate: 20, plannedHours: 3000, expectedBillablePct: 50, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 1500 }, { divisionId: 'snow', hours: 1500 }] },
    { id: 'manager', budgetId: budget.id, category: 'labour', name: 'Manager', compType: 'salaried', annualSalary: 60000, plannedHours: 2000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', hours: 1000 }, { divisionId: 'snow', hours: 1000 }] },
    { id: 'office', budgetId: budget.id, category: 'overhead', plannedAmount: 20000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 50 }, { divisionId: 'snow', percentage: 50 }] },
    { id: 'loader', budgetId: budget.id, category: 'equipment', equipmentId: 'loader', name: 'Loader', plannedAmount: 48000, sellableHoursPerYear: 1200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 6, sellableHours: 600 }, { divisionId: 'snow', months: 6, sellableHours: 600 }] },
  ];
  const rows = buildBudgetPricingRows({ budget, divisions: twoDivisions, planningItems: items, budgetRates: [] });
  const hardscape = rows.find((row) => row.item.id === 'average-labour:hardscape');
  assert.equal(rows.filter((row) => row.aggregateLabour).length, 2);
  assert.equal(rows.some((row) => ['senior', 'junior', 'manager'].includes(row.item.id)), false);
  assert.equal(hardscape.billableHours, 1500);
  assert.equal(hardscape.annualCost, 60000);
  assert.equal(hardscape.costRate, 40);
  assert.equal(hardscape.contributors.length, 2);
  assert.equal(hardscape.overheadPool, 20000);
  assert.ok(Math.abs(hardscape.overheadPerUnit - (20000 / 1500)) < 0.000001);
  assert.equal(rows.filter((row) => row.item.id === 'loader').length, 2);
});

test('Average Labour remains unavailable with zero planned billable hours', () => {
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [{ id: 'manager', budgetId: budget.id, category: 'labour', compType: 'salaried', annualSalary: 60000, plannedHours: 2000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', hours: 2000 }] }], budgetRates: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].billableHours, 0);
  assert.equal(rows[0].costRate, 0);
  assert.equal(rows[0].recommendedRate, 0);
  assert.equal(rows[0].pricingStatus, 'unavailable');
});

test('Budget Analysis leaves recommendations unavailable when pricing units are missing', () => {
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [{ id: 'idle', budgetId: budget.id, divisionId: 'hardscape', category: 'equipment', equipmentId: 'idle', name: 'Idle Equipment', plannedAmount: 10000, sellableHoursPerYear: 0 }], budgetRates: [] });
  assert.equal(rows[0].costRate, 0);
  assert.equal(rows[0].recommendedRate, 0);
  assert.equal(rows[0].pricingStatus, 'unavailable');
});

test('Estimate Pricing rows expose explicit saved, dirty, saving, and failed states', () => {
  assert.match(pricingSource, /persisted: string/);
  assert.match(pricingSource, /ratesMatch\(state\.draft, state\.persisted\)/);
  assert.match(pricingSource, /onChange=\{\(event\) => setDraft\(row\.key, event\.target\.value\)\}/);
  assert.match(pricingSource, /'Saving…'/);
  assert.match(pricingSource, /'Try Again'/);
  assert.match(pricingSource, /'Save'/);
  assert.match(pricingSource, /'Saved ✓'/);
  assert.match(pricingSource, /role="alert"/);
  assert.match(pricingSource, /setRateStates\(\(current\) => \(\{ \.\.\.current, \[row\.key\]: \{ draft: persisted, persisted, status: 'idle' \} \}\)\)/);
  assert.match(pricingSource, /\.\.\.current\[row\.key\],[\s\S]*status: 'failed'/);
});

test('Pricing Recommendations use contractor-facing labour and equipment terms', () => {
  assert.match(pricingSource, /pricingTable\(labourRows, 'Labour Cost', 'Labour Rate'\)/);
  assert.match(pricingSource, /pricingTable\(equipmentRows, 'Equipment Cost', 'Equipment Rate'\)/);
  assert.match(pricingSource, />Target Net Profit</);
  assert.match(pricingSource, /Overhead allocated to labour:/);
  assert.match(pricingSource, /Planned billable labour hours:/);
  assert.match(pricingSource, /Overhead recovery:/);
  assert.match(pricingSource, /Breakeven:/);
  assert.match(pricingSource, /÷ \(1 - \{row\.targetMarginPct\.toFixed\(0\)\}% Target Net Profit\)/);
  assert.doesNotMatch(pricingSource, />Type</);
  assert.doesNotMatch(pricingSource, />Direct Cost</);
  assert.doesNotMatch(pricingSource, />Recommended</);
  assert.doesNotMatch(pricingSource, />Company OH</);
  assert.match(pricingSource, /Using recommended rate/);
  assert.match(pricingSource, /Custom rate/);
  assert.doesNotMatch(pricingSource, />Use recommended<\/button>/);
});

test('Estimate Pricing prevents duplicate saves and awaits individual persistence', () => {
  assert.match(pricingSource, /savesInFlight\.current\.has\(row\.key\)/);
  assert.match(pricingSource, /savesInFlight\.current\.add\(row\.key\)/);
  assert.match(pricingSource, /row\.rate\?\.pricingVersion === 2/);
  assert.match(pricingSource, /pricingVersion: 2/);
  assert.match(pricingSource, /divisionOverheadRecoveryPerUnit: row\.divisionOverheadPerUnit/);
  assert.match(pricingSource, /await updateBudgetRate\(row\.rate\.id, payload\)/);
  assert.match(pricingSource, /await addBudgetRate\(payload\)/);
  assert.match(storeSource, /addBudgetRate: async \(rateInput\)/);
  assert.match(storeSource, /updateBudgetRate: async \(id, data\)/);
});

test('unavailable pricing omits editable and save controls', () => {
  assert.match(pricingSource, /isUnavailable \? <>[\s\S]*Rate unavailable[\s\S]*unavailableReason\(row\.item\.category\)[\s\S]*colSpan=\{2\}>—<\/td>/);
  assert.match(pricingSource, /Complete labour cost information first\./);
});

test('persisted approved rates reconstruct the saved baseline after reload', () => {
  const persistedRates = [{ id: 'rate-average', budgetId: budget.id, budgetItemId: 'average-labour:hardscape', divisionId: 'hardscape', pricingVersion: 2, category: 'labour', defaultSellPrice: 62.5 }];
  const firstRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: persistedRates });
  const reloadedRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: structuredClone(persistedRates) });

  assert.equal(firstRender.find((row) => row.item.id === 'average-labour:hardscape').approvedRate, 62.5);
  assert.equal(reloadedRender.find((row) => row.item.id === 'average-labour:hardscape').approvedRate, 62.5);
  assert.match(pricingSource, /const persisted = row\.approvedRate > 0 \? String\(row\.approvedRate\) : ''/);
});

test('page Save Changes persists Budget fields, not individually saved pricing rates', () => {
  assert.match(workspaceSource, /saveIfDirty[\s\S]*updateBudget\(budget\.id/);
  assert.doesNotMatch(workspaceSource, /saveIfDirty[\s\S]{0,1000}(addBudgetRate|updateBudgetRate)/);
  assert.match(pricingSource, /await (updateBudgetRate|addBudgetRate)/);
});
