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
  assert.doesNotMatch(budgetPageSource, /Estimate Pricing Calculator/);
  assert.doesNotMatch(budgetPageSource, /Suggested Material Markup/);
  assert.doesNotMatch(budgetPageSource, /Suggested Subcontractor Markup/);
});

test('budget rates and estimate add-items use a single combined entry per catalog item', () => {
  assert.match(budgetPageSource, /Suggested Sell/);
  assert.match(budgetPageSource, /Final Sell/);
  assert.match(budgetPageSource, /Overhead Recovery/);
  assert.doesNotMatch(estimateBuilderSource, /budgetRatesByCategory\.equipment\.filter\(\(value\) => !matchedEquipmentRateIds\.has\(value\.id\)\)/);
  assert.doesNotMatch(estimateBuilderSource, /budgetRatesByCategory\.material\.filter\(\(value\) => !matchedMaterialRateIds\.has\(value\.id\)\)/);
  assert.match(estimateBuilderSource, /No pricing rate in selected budget/);
  assert.match(estimateBuilderSource, /Add Pricing Rate/);
});
