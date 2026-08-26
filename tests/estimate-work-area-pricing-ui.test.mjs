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
  assert.match(builderSource, /item\.pricingReason/);
  assert.match(builderSource, /Weighted Labour Cost:/);
  assert.match(builderSource, /Breakeven:/);
  assert.match(builderSource, /candidate\.pricingItem\.divisionName/);
  assert.match(builderSource, /No Labour Classes configured/);
  assert.match(builderSource, /Set up Labour Classes in Catalog/);
  assert.match(builderSource, /\/materials\/catalog\?catalog=labour/);
  assert.doesNotMatch(builderSource, /employees\.find/);
  assert.doesNotMatch(builderSource, /employeeName/);
});

test('Work Area resources use compact responsive rows with editable quantity and expandable notes', () => {
  assert.match(builderSource, /const isBudgetPriced = Boolean\(lineItem\.sourceBudgetItemId \|\| lineItem\.sourceRateId \|\| lineItem\.equipmentId\)/);
  assert.match(builderSource, /sm:min-h-\[60px\] xl:flex-nowrap/);
  assert.match(builderSource, /const usesHours = category === 'labour' \|\| category === 'equipment'/);
  assert.match(builderSource, /const quantityLabel = usesHours \? 'Hours' : 'Quantity'/);
  assert.match(builderSource, /setLineItem\(lineItem\.id, 'quantity', parseNumericInputValue\(event\.target\.value\)\)/);
  assert.match(builderSource, /usesHours \|\| isBudgetPriced \? <span>\{lineItem\.unit\}<\/span>/);
  assert.match(builderSource, /formatCurrency\(lineItem\.sellPrice\).*lineItem\.unit/);
  assert.match(builderSource, /formatCurrency\(lineItem\.total\)/);
  assert.match(builderSource, /title=\{isExpanded \? 'Collapse item details' : 'Edit description and notes'\}/);
  assert.match(builderSource, /isExpanded \? <div[^>]*>\s*<label[^>]*>Description \/ Notes/);
  assert.doesNotMatch(builderSource, /Budget pricing snapshot/);
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