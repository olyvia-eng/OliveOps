import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const budget = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');
const division = readFileSync('src/pages/budget/DivisionWorkspacePage.tsx', 'utf8');
const statement = readFileSync('src/components/budget/ProfitLossView.tsx', 'utf8');
const model = readFileSync('src/pages/budget/budgetFinancialModel.ts', 'utf8');
const plannerModel = readFileSync('api/_lib/budgetDivisionPlanningModel.js', 'utf8');

test('Budget and Division navigation expose read-only Profit & Loss routes', () => {
  assert.match(budget, /Info[\s\S]*Divisions[\s\S]*Profit & Loss[\s\S]*Analysis/);
  assert.doesNotMatch(budget, /company-overhead|CompanyOverheadSection/);
  assert.match(budget, /activeTab === 'profit-loss'[\s\S]*BudgetProfitLossView/);
  assert.match(division, /Overhead[\s\S]*Profit & Loss/);
  assert.match(division, /activeTab === 'profit-loss'[\s\S]*DivisionProfitLossView/);
  assert.doesNotMatch(statement, /<Input|<Select|<TextArea|onChange=/);
});

test('Other Costs is a compatible URL alias while persisted planning uses overhead', () => {
  assert.match(division, /requestedTab === 'other-costs' \? 'overhead'/);
  assert.match(plannerModel, /'subcontractors', 'overhead'/);
  assert.match(plannerModel, /overhead: \['costCode', 'plannedAmount', 'overheadDivisionAllocations', 'legacyBudgetItemId'\]/);
  assert.doesNotMatch(division, /label: 'Other Costs'/);
});

test('all financial surfaces consume the centralized calculation layer', () => {
  assert.match(budget, /calculateBudgetFinancials/);
  assert.match(division, /calculateDivisionFinancials/);
  assert.match(model, /export function calculateDivisionFinancials/);
  assert.match(model, /export function calculateBudgetFinancials/);
  assert.match(budget, /divisionFinancials\.get\(division\.id\)/);
  assert.doesNotMatch(statement, /revenue\s*-\s*|grossProfit\s*-\s*|\/\s*revenue/);
});

test('financial statements show hierarchy and reusable item-level overhead detail', () => {
  assert.doesNotMatch(statement, /function Kpis|function Kpi|lg:grid-cols-5/);
  assert.match(statement, /Total Revenue/);
  assert.match(statement, /Total Direct Costs/);
  assert.match(statement, /Gross Profit/);
  assert.match(statement, /Total Overhead/);
  assert.match(statement, /Net Profit/);
  assert.match(statement, /Net Profit Margin/);
  assert.doesNotMatch(statement, /Operating Profit|Operating Margin/);
  assert.match(statement, /Budget incomplete/);
  assert.match(statement, /function OverheadRows/);
  assert.match(statement, /financials\.overheadItems/);
  assert.match(statement, /Labour[\s\S]*Equipment[\s\S]*Other Overhead/);
  assert.match(statement, /Legacy \/ unitemized overhead/);
  assert.doesNotMatch(statement, /label="Overhead Labour"|label="Overhead Equipment"|label="Allocated Overhead"/);
  assert.doesNotMatch(statement, /before Company Overhead|Company Overhead is not allocated/);
  assert.doesNotMatch(statement, /Division Breakdown/);
  assert.match(statement, />Compare</);
  assert.match(statement, /DivisionMonthlyComparison/);
});

test('legacy overhead is normalized without an active company-level calculation path', () => {
  assert.match(budget, /migrateLegacyBudgetOverhead/);
  assert.doesNotMatch(model, /companyOverheadItems|companyOverheadAllocated/);
  assert.doesNotMatch(statement, /Company Overhead/);
});

test('financial statements render authoritative direct-cost child detail', () => {
  assert.match(statement, /function DirectCostRows/);
  assert.match(statement, /financials\.directCostItems/);
  assert.match(model, /directCostItems/);
});