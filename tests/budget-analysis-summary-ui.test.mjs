import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const summarySource = readFileSync('src/components/budget/BudgetAnalysisSummary.tsx', 'utf8');
const summaryModelSource = readFileSync('src/pages/budget/budgetAnalysisSummaryModel.js', 'utf8');
const workspaceSource = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');
const pricingModelSource = readFileSync('src/pages/budget/budgetPricingModel.js', 'utf8');

test('Analysis renders one compact financial statement in the requested order', () => {
  assert.match(summarySource, /Financial Summary/);
  assert.match(summaryModelSource, /label: 'Revenue'[\s\S]*label: 'Labour Cost'[\s\S]*label: 'Equipment Cost'[\s\S]*label: 'Material Cost'[\s\S]*label: 'Subcontractor Cost'[\s\S]*label: 'Overhead Cost'[\s\S]*label: 'Net Profit'/);
  assert.doesNotMatch(summarySource, /<Card[\s\S]*map\(\(line\) => <Card/);
});

test('financial values come from the centralized Budget financial model', () => {
  assert.match(summaryModelSource, /financials\.revenue/);
  assert.match(summaryModelSource, /financials\.directLabour/);
  assert.match(summaryModelSource, /financials\.directEquipment/);
  assert.match(summaryModelSource, /financials\.materials/);
  assert.match(summaryModelSource, /financials\.subcontractors/);
  assert.match(summaryModelSource, /financials\.totalOverhead/);
  assert.doesNotMatch(summaryModelSource, /Company Overhead|companyOverhead/);
});

test('dollar and percent modes derive from one canonical target margin', () => {
  assert.match(summarySource, /useState<AnalysisValueMode>\('dollars'\)/);
  assert.match(summarySource, /normalizeTargetMargin\(targetMarginPct\)/);
  assert.match(summarySource, /targetMarginFromDollars\(parsed, summary\.revenue\)/);
  assert.match(summarySource, /setCanonicalMargin\(nextMargin\)/);
  assert.match(summarySource, /onTargetMarginChange\(nextMargin\)/);
  assert.match(summarySource, /value === 'dollars' \? '\$' : '%'/);
  assert.match(summaryModelSource, /amount \/ revenue \* 100/);
});

test('chart consumes summary segments and exposes rather than normalizes shortfall', () => {
  assert.match(summarySource, /summary\.chartSegments\.map/);
  assert.match(summarySource, /summary\.revenueMarkerPct/);
  assert.match(summarySource, /Revenue limit/);
  assert.match(summarySource, /summary\.shortfall/);
  assert.match(summaryModelSource, /chartTotal = Math\.max\(revenue, requiredRevenue, 1\)/);
  assert.match(summaryModelSource, /chartSegments = lines\.slice\(1\)/);
});

test('current profit stays distinct from target profit and Pricing reads the same margin', () => {
  assert.match(summaryModelSource, /currentProfit = revenue - totalPlannedCosts/);
  assert.match(summaryModelSource, /targetNetProfit = revenue \* targetNetProfitPct \/ 100/);
  assert.match(summarySource, /Current Budget Profit/);
  assert.match(workspaceSource, /targetMarginPct=\{budget\.targetMarginPct\}/);
  assert.match(pricingModelSource, /budget\.targetMarginPct \?\? 20/);
});

test('existing Overhead Recovery and Pricing remain below the financial summary', () => {
  assert.match(workspaceSource, /<BudgetAnalysisSummary[\s\S]*<BudgetPricingAnalysis/);
  const pricingSource = readFileSync('src/components/budget/BudgetPricingAnalysis.tsx', 'utf8');
  assert.match(pricingSource, />Overhead Recovery<\/h2>/);
  assert.match(pricingSource, />Pricing<\/h2>/);
  for (const label of ['Labour', 'Equipment', 'Materials', 'Subcontractors']) assert.match(pricingSource, new RegExp(`label: '${label}'`));
});