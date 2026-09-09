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
  assert.match(summarySource, /Total Revenue/);
  assert.match(summarySource, /Total Costs/);
  assert.match(summarySource, /Projected Profit/);
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

test('dollar and percent toggle changes summary display while target remains one percentage input', () => {
  assert.match(summarySource, /useState<AnalysisValueMode>\('dollars'\)/);
  assert.match(summarySource, /normalizeTargetMargin\(targetMarginPct\)/);
  assert.match(summarySource, /setCanonicalMargin\(nextMargin\)/);
  assert.match(summarySource, /onTargetMarginChange\(nextMargin\)/);
  assert.match(summarySource, /value === 'dollars' \? '\$' : '%'/);
  assert.match(summarySource, /valueFor = \(amount: number, percent: number \| null\) => mode === 'dollars'/);
  assert.match(summarySource, /aria-label="Target Profit Margin"[\s\S]*max=\{MAX_TARGET_MARGIN_PCT\}[\s\S]*step=\{0\.1\}/);
  assert.doesNotMatch(summarySource, /Target Profit Margin in \$\{mode\}|targetMarginFromDollars/);
});

test('chart consumes current summary segments and exposes rather than normalizes additional revenue needed', () => {
  assert.match(summarySource, /PieChart/);
  assert.match(summarySource, /data=\{pieData\}/);
  assert.match(summarySource, /summary\.chartSegments/);
  assert.doesNotMatch(summarySource, /Revenue distribution chart view|Stacked|Separate revenue distribution bars/);
  assert.match(summarySource, /pieData\.map/);
  assert.match(summarySource, /summary\.additionalRevenueNeeded/);
  assert.match(summaryModelSource, /financials\.operatingProfit/);
  assert.match(summarySource, /formatPercent\(summary\.currentProfitMarginPct\)[\s\S]*Projected Margin/);
  assert.match(summarySource, /Current loss/);
});

test('current profit stays distinct from target profit and Pricing reads the same margin', () => {
  assert.match(summaryModelSource, /currentProfit = Number\.isFinite\(financials\.operatingProfit\)/);
  assert.match(summaryModelSource, /requiredRevenue = totalPlannedCosts \/ \(1 - targetNetProfitPct \/ 100\)/);
  assert.match(summaryModelSource, /targetNetProfit = requiredRevenue - totalPlannedCosts/);
  assert.match(summarySource, /Profit Goal &amp; Comparison/);
  assert.match(summarySource, /See how your current budget compares to your target profit margin/);
  assert.match(summarySource, /Target Profit Margin/);
  assert.match(summarySource, /At Your Target Margin/);
  assert.match(summarySource, /Your Current Budget/);
  assert.match(summarySource, /Required Revenue/);
  assert.match(summarySource, /Target Profit/);
  assert.match(summarySource, /Projected Profit/);
  assert.match(summarySource, /Projected Margin/);
  assert.match(summarySource, /Additional Revenue Needed/);
  assert.match(summarySource, /If you generated[\s\S]*summary\.requiredRevenue[\s\S]*cover your current budgeted costs and achieve a/);
  assert.match(summarySource, /Default is 20%/);
  assert.doesNotMatch(summarySource, /revenue gap/);
  assert.match(summarySource, /isValidTargetMarginInput\(parsed\)/);
  assert.doesNotMatch(summarySource, /summary\.revenue \* nextMargin/);
  assert.match(workspaceSource, /targetMarginPct=\{budget\.targetMarginPct\}/);
  assert.match(pricingModelSource, /budget\.targetMarginPct \?\? 20/);
});

test('profit comparison presents explicit above-target and below-target states', () => {
  assert.match(summarySource, /currentProfitMarginPct !== null && summary\.currentProfitMarginPct > summary\.targetNetProfitPct/);
  assert.match(summarySource, /Your current budget is above your/);
  assert.match(summarySource, /Your current budget meets your/);
  assert.match(summarySource, /targetMarginLabel} target margin/);
  assert.match(summarySource, /summary\.additionalRevenueNeeded/);
  assert.match(summarySource, /more revenue[\s\S]*to reach your/);
  assert.doesNotMatch(summarySource, /extra profit/i);
});

test('existing Overhead Recovery and Pricing remain below the financial summary', () => {
  assert.match(workspaceSource, /<BudgetAnalysisSummary[\s\S]*<BudgetPricingAnalysis/);
  const pricingSource = readFileSync('src/components/budget/BudgetPricingAnalysis.tsx', 'utf8');
  assert.match(pricingSource, />\s*Overhead Recovery\s*<\/h2>/);
  assert.match(pricingSource, />\s*Pricing\s*<\/h2>/);
  assert.match(workspaceSource, /financials=\{financials\}/);
  assert.match(pricingSource, /Revenue \/ Hour/);
  for (const label of ['Labour', 'Equipment', 'Materials', 'Subcontractors']) assert.match(pricingSource, new RegExp(`label: ["']${label}["']`));
});