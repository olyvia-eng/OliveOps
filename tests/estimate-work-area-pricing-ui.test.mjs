import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatTargetMarginPercent } from '../src/pages/budget/budgetAnalysisSummaryModel.js';

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
  assert.doesNotMatch(builderSource, /candidate\.pricingItem\.divisionName/);
  assert.match(builderSource, /No Labour Classes configured/);
  assert.match(builderSource, /Set up Labour Classes in Catalog/);
  assert.match(builderSource, /\/materials\/catalog\?catalog=labour/);
  assert.doesNotMatch(builderSource, /employees\.find/);
  assert.doesNotMatch(builderSource, /employeeName/);
  assert.doesNotMatch(builderSource, /budgetRatesByCategory|applyBudgetRateToEstimateLineItem|applyEquipmentAssetToEstimateLineItem/);
  assert.match(builderSource, /applyEstimatePricingToLineItem\(createEmptyEstimateLineItem\(candidate\.category\), estimate\.pricingBudgetId, pricingItem\)/);
  assert.match(builderSource, /catalogCategory !== 'labour'/);
});

test('Work Area resources expose snapshot economics with editable quantity and actions', () => {
  assert.match(builderSource, /const isBudgetPriced = Boolean\(lineItem\.sourceBudgetItemId \|\| lineItem\.sourceRateId \|\| lineItem\.equipmentId\)/);
  for (const heading of ['Item', 'Quantity', 'Cost', 'Breakeven', 'Total Cost', 'Profit', 'Price', 'Total Price', 'Actions']) assert.match(builderSource, new RegExp(`>${heading}<`));
  assert.match(builderSource, /getEstimateLinePricingEconomics\(lineItem\)/);
  assert.match(builderSource, /const usesHours = category === 'labour' \|\| \(category === 'equipment' && lineItem\.unit === 'hr'\)/);
  assert.match(builderSource, /const quantityLabel = usesHours \? 'Hours' : 'Quantity'/);
  assert.match(builderSource, /setLineItem\(lineItem\.id, 'quantity', parseNumericInputValue\(event\.target\.value\)\)/);
  assert.match(builderSource, /usesHours \|\| isBudgetPriced \? <span>\{lineItem\.unit\}<\/span>/);
  assert.match(builderSource, /formatCurrency\(economics\.totalCost\)/);
  assert.match(builderSource, /formatCurrency\(economics\.totalPrice\)/);
  assert.match(builderSource, /formatTargetMarginPercent\(economics\.profitPercent\)/);
  assert.match(builderSource, /Calculated Price/);
  assert.match(builderSource, /Final Price/);
  assert.match(builderSource, /Price is below breakeven\./);
  assert.doesNotMatch(builderSource, /· \{estimateDivision\.name\}/);
  assert.match(builderSource, /title=\{isExpanded \? 'Collapse item details' : 'Edit description and notes'\}/);
  assert.match(builderSource, /isExpanded \? <div[^>]*>\s*<label[^>]*>Description \/ Notes/);
  assert.doesNotMatch(builderSource, /Budget pricing snapshot/);
  assert.doesNotMatch(builderSource, /Markup %/);
  assert.doesNotMatch(builderSource, />Unit Cost</);
});

test('Work Area totals omit the line count and rebalance financial summaries', () => {
  assert.match(builderSource, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(builderSource, /Sell Price by Category/);
  assert.match(workspaceSource, /Sell Price by Category/);
  assert.doesNotMatch(builderSource, />Line Items<|form\.lineItems\.length/);
});

test('Profit uses the selected Budget target and never exposes raw decimal text', () => {
  assert.equal(formatTargetMarginPercent(15), '15%');
  assert.equal(formatTargetMarginPercent(78.43137254901961), '78.43%');
  assert.doesNotMatch(builderSource, /`\$\{economics\.profitPercent\}%`/);
  assert.doesNotMatch(builderSource, /markupPercent.*Profit|Profit.*markupPercent/);
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

test('worksheet economics read authoritative snapshot fields without applying sales tax to resource cost', () => {
  assert.match(modelSource, /export function getEstimateLinePricingEconomics/);
  assert.match(modelSource, /item\.recoveredCostPerUnit \?\? item\.breakevenRate/);
  assert.match(modelSource, /item\.targetMarginPct == null/);
  assert.match(modelSource, /item\.calculatedRateAtEstimate \?\? item\.recommendedRateAtEstimate/);
  assert.match(modelSource, /totalCost: quantity \* cost/);
  assert.match(modelSource, /totalPrice: quantity \* price/);
  assert.match(modelSource, /isBelowBreakeven: breakeven !== null && price < breakeven/);
  assert.doesNotMatch(builderSource, /Cost \+ Tax/);
});