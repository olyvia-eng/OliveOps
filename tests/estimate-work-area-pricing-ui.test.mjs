import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const modelSource = readFileSync('src/utils/estimateModel.ts', 'utf8');

test('Labour drawer presents calculated Division pricing without approval language', () => {
  assert.match(builderSource, /Add \{CATEGORY_ADD_LABEL\[catalogCategory\]\}/);
  assert.match(builderSource, /pricingBudget\?\.name.*estimateDivision\.name/);
  assert.match(builderSource, /Search \$\{CATEGORY_LABEL\[catalogCategory\]\.toLowerCase\(\)\}/);
  assert.match(builderSource, /Labour pricing is incomplete for/);
  assert.doesNotMatch(builderSource, /No approved labour rate/);
  assert.doesNotMatch(builderSource, /Division labour pricing incomplete/);
  assert.doesNotMatch(builderSource, /Complete Pricing/);
  assert.doesNotMatch(builderSource, /Approve pricing in/);
  assert.match(builderSource, /item\.pricingAvailable && item\.sellRate/);
});

test('Budget-priced Work Area rows expose quantity, snapshot rate, and total without cost or markup controls', () => {
  assert.match(builderSource, /const isBudgetPriced = Boolean\(lineItem\.sourceBudgetItemId \|\| lineItem\.sourceRateId \|\| lineItem\.equipmentId\)/);
  assert.match(builderSource, /'Labour Rate'/);
  assert.match(builderSource, /'Equipment Rate'/);
  assert.match(builderSource, /'Material Rate'/);
  assert.match(builderSource, /formatCurrency\(lineItem\.sellPrice\).*lineItem\.unit/);
  assert.match(builderSource, /formatCurrency\(lineItem\.total\)/);
  assert.doesNotMatch(builderSource, /Markup %/);
  assert.doesNotMatch(builderSource, />Unit Cost</);
});

test('Custom items keep explicit rate and secondary costing without Estimate markup', () => {
  assert.match(builderSource, /<Input label="Rate"/);
  assert.match(builderSource, /<summary[^>]*>Costing<\/summary>/);
  assert.match(builderSource, /<Input label="Estimated Cost"/);
  assert.match(builderSource, /markupPercent: 0/);
  assert.doesNotMatch(builderSource, /customItem\.markupPercent/);
});

test('Estimate Analysis consumes internal cost snapshots while proposals expose customer rates only', () => {
  assert.match(workspaceSource, /computeWorkAreaEstimatedCost/);
  assert.match(workspaceSource, /computeWorkAreaCategoryCostTotals/);
  assert.match(workspaceSource, />Revenue</);
  assert.match(workspaceSource, />Estimated Cost</);
  assert.match(workspaceSource, />Gross Profit</);
  assert.match(workspaceSource, />Gross Margin</);
  assert.match(workspaceSource, /head: \[\['Category', 'Description', 'Qty', 'Unit', 'Rate', 'Line Total'\]\]/);
  assert.match(estimatesSource, /head: \[\['Category', 'Description', 'Qty', 'Unit', 'Rate', 'Line Total'\]\]/);
  assert.doesNotMatch(workspaceSource, /head: \[\[[^\]]*'Unit Cost'/);
  assert.doesNotMatch(estimatesSource, /head: \[\[[^\]]*'Unit Cost'/);
  assert.match(modelSource, /export function normalizeEstimateWorkAreas/);
  assert.match(modelSource, /const unitCost = Math\.max\(0, asNumber\(item\.unitCost, 0\)\)/);
});