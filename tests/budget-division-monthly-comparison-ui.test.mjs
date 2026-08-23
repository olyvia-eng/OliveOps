import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const statementSource = readFileSync('src/components/budget/ProfitLossView.tsx', 'utf8');
const comparisonSource = readFileSync('src/components/budget/DivisionMonthlyComparison.tsx', 'utf8');
const modelSource = readFileSync('src/pages/budget/divisionMonthlyFinancialModel.js', 'utf8');
const workspaceSource = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');

test('main P&L removes Division Breakdown and opens Compare from the heading', () => {
  assert.doesNotMatch(statementSource, /Division Breakdown/);
  assert.match(statementSource, /const \[compareOpen, setCompareOpen\] = useState\(false\)/);
  assert.match(statementSource, /onClick=\{\(\) => setCompareOpen\(true\)\}[\s\S]*>Compare</);
  assert.match(statementSource, /<DivisionMonthlyComparison open=\{compareOpen\}/);
  assert.match(workspaceSource, /<BudgetProfitLossView budget=\{budget\} divisions=\{divisions\} financials=\{financials\}/);
});

test('Compare scopes its selector to the current Budget and refreshes on Division change', () => {
  assert.match(comparisonSource, /divisions\.filter\(\(division\) => division\.budgetId === budget\.id\)/);
  assert.match(comparisonSource, /label="Division"/);
  assert.match(comparisonSource, /setDivisionId\(event\.target\.value\)/);
  assert.match(comparisonSource, /calculateDivisionMonthlyFinancials\(\{ budget, divisionId/);
});

test('fiscal month tabs and YTD use one shared monthly result', () => {
  assert.match(comparisonSource, /result\.periods\.map/);
  assert.match(comparisonSource, /aria-label="Comparison period"/);
  assert.match(comparisonSource, />YTD<\/button>/);
  assert.match(comparisonSource, /aggregateDivisionFinancialPeriods\(result\.months, selectedIndex\)/);
  assert.match(modelSource, /startDate: key === start\.slice/);
  assert.match(modelSource, /endDate: key === end\.slice/);
});

test('monthly table compares the required metrics and margins use point changes', () => {
  for (const label of ['Revenue', 'Labour Cost', 'Equipment Cost', 'Material Cost', 'Subcontractor Cost', 'Overhead', 'Net Profit', 'Net Profit %']) assert.match(comparisonSource, new RegExp(`label: '${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(comparisonSource, /selected\.label/);
  assert.match(comparisonSource, /previous\.label/);
  assert.match(comparisonSource, /margin \? ' pts' : '%'/);
  assert.match(modelSource, /key === 'netProfitMargin'[\s\S]*selected\[key\] - previous\[key\]/);
});

test('trend chart reads the same monthly values and supports Revenue and Labour selection', () => {
  assert.match(comparisonSource, /trend = result\.months\.map\(\(month\) => \(\{ label: month\.tabLabel, value: month\[trendMetric\] \}\)\)/);
  assert.match(comparisonSource, /<LineChart data=\{trend\}/);
  assert.match(comparisonSource, /setTrendMetric/);
  assert.match(comparisonSource, /value="revenue"|key: 'revenue'/);
  assert.match(comparisonSource, /key: 'labourCost'/);
});

test('missing actuals, source limitations, and responsive behavior are explicit', () => {
  assert.match(comparisonSource, /Actual data unavailable/);
  assert.match(comparisonSource, /Actual data coverage/);
  assert.match(comparisonSource, /overflow-x-auto/);
  assert.match(comparisonSource, /xl:grid-cols/);
  assert.match(comparisonSource, /size="large"/);
  assert.match(modelSource, /unlinked company overhead cannot be allocated to a Division/);
  assert.doesNotMatch(modelSource, /\/ 12/);
});