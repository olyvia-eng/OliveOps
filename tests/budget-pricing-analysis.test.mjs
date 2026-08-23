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

test('Budget Analysis calculates recommendations once per shared item and resolves canonical approvals', () => {
  const rows = buildBudgetPricingRows({
    budget,
    divisions,
    planningItems,
    budgetRates: [{ id: 'rate-ryan', budgetId: budget.id, budgetItemId: 'ryan', employeeId: 'employee-ryan', category: 'labour', defaultSellPrice: 80 }],
  });

  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.item.employeeId === 'employee-ryan').length, 1);
  const labour = rows.find((row) => row.item.id === 'ryan');
  assert.equal(labour.costRate, 45);
  assert.equal(labour.overheadPerUnit, 31.25);
  assert.equal(labour.recommendedRate, 95.3125);
  assert.equal(labour.approvedRate, 80);
  assert.equal(labour.pricingStatus, 'approved');

  const equipment = rows.find((row) => row.item.id === 'bobcat');
  assert.ok(Math.abs(equipment.costRate - 43.3333333333) < 0.000001);
  assert.equal(equipment.overheadPerUnit, 25);
  assert.ok(Math.abs(equipment.recommendedRate - 85.4166666667) < 0.000001);
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

test('Estimate Pricing exposes components and keeps one explicit save action', () => {
  assert.match(pricingSource, />Direct Cost</);
  assert.match(pricingSource, />Overhead Recovery</);
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
  const persistedRates = [{ id: 'rate-ryan', budgetId: budget.id, budgetItemId: 'ryan', employeeId: 'employee-ryan', category: 'labour', defaultSellPrice: 62.5 }];
  const firstRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: persistedRates });
  const reloadedRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: structuredClone(persistedRates) });

  assert.equal(firstRender.find((row) => row.item.id === 'ryan').approvedRate, 62.5);
  assert.equal(reloadedRender.find((row) => row.item.id === 'ryan').approvedRate, 62.5);
  assert.match(pricingSource, /const persisted = row\.approvedRate > 0 \? String\(row\.approvedRate\) : ''/);
});

test('page Save Changes persists Budget fields, not individually saved pricing rates', () => {
  assert.match(workspaceSource, /saveIfDirty[\s\S]*updateBudget\(budget\.id/);
  assert.doesNotMatch(workspaceSource, /saveIfDirty[\s\S]{0,1000}(addBudgetRate|updateBudgetRate)/);
  assert.match(pricingSource, /await (updateBudgetRate|addBudgetRate)/);
});
