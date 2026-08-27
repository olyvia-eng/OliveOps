import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const budgetPageSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
const typesSource = readFileSync('src/types/index.ts', 'utf8');
const estimateBuilderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');

test('budget page exposes a persisted overhead recovery strategy', () => {
  assert.match(budgetPageSource, /Overhead Recovery &amp; Pricing Strategy/);
  assert.match(budgetPageSource, /Labour %/);
  assert.match(budgetPageSource, /Equipment %/);
  assert.match(budgetPageSource, /Materials %/);
  assert.match(budgetPageSource, /Subcontractors %/);
  assert.match(budgetPageSource, /Total Allocation:/);
  assert.match(budgetPageSource, /updateBudget\(activeBudgetId, \{ overheadRecoveryAllocation: next \}\)/);
  assert.match(typesSource, /overheadRecoveryAllocation\?: \{/);
  assert.match(budgetPageSource, /Desired Net Profit/);
  assert.match(budgetPageSource, /Required Revenue/);
  assert.match(budgetPageSource, /Revenue Gap/);
  assert.match(budgetPageSource, /updateBudget\(activeBudgetId, \{ desiredNetProfit:/);
  assert.match(typesSource, /desiredNetProfit\?: number/);
  assert.doesNotMatch(budgetPageSource, /Estimate Pricing Calculator/);
  assert.doesNotMatch(budgetPageSource, /Suggested Material Markup/);
  assert.doesNotMatch(budgetPageSource, /Suggested Subcontractor Markup/);
});

test('overhead tab includes labour overhead summary and overhead employee section', () => {
  assert.match(budgetPageSource, /Labour Overhead/);
  assert.match(budgetPageSource, /Overhead Labour Employees/);
  assert.match(budgetPageSource, /Employees tagged as overhead in the labour planner appear here\./);
  assert.match(budgetPageSource, /No overhead employees selected yet\. Set Labour Type to Overhead in the Labour tab\./);
  assert.match(budgetPageSource, /\(row\.employee\.labourType \?\? 'field_producing'\) === 'overhead'/);
});

test('budget rates remain canonical and Estimate add-items use selected-Budget results', () => {
  assert.match(budgetPageSource, /findEquipmentRate/);
  assert.match(budgetPageSource, /rate\.equipmentId === item\.equipmentId/);
  assert.match(budgetPageSource, /if \(row\.rate\) updateBudgetRate\(row\.rate\.id, payload\)/);
  assert.match(budgetPageSource, /else addBudgetRate\(payload\)/);
  assert.match(estimateBuilderSource, /applyEstimatePricingToLineItem/);
  assert.doesNotMatch(estimateBuilderSource, /approvedChargeOutRate|legacy budget rate|budgetRatesByCategory/);
  assert.match(estimateBuilderSource, /item\.pricingAvailable && item\.sellRate/);
  assert.doesNotMatch(estimateBuilderSource, /Complete Pricing/);
});
