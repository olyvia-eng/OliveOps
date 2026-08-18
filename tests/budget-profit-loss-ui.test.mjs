import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const budget = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');
const division = readFileSync('src/pages/budget/DivisionWorkspacePage.tsx', 'utf8');
const statement = readFileSync('src/components/budget/ProfitLossView.tsx', 'utf8');
const model = readFileSync('src/pages/budget/budgetFinancialModel.ts', 'utf8');
const plannerModel = readFileSync('api/_lib/budgetDivisionPlanningModel.js', 'utf8');

test('Budget and Division navigation expose read-only Profit & Loss routes', () => {
  assert.match(budget, /Company Overhead[\s\S]*Profit & Loss[\s\S]*Analysis/);
  assert.match(budget, /activeTab === 'profit-loss'[\s\S]*BudgetProfitLossView/);
  assert.match(division, /Overhead[\s\S]*Profit & Loss/);
  assert.match(division, /activeTab === 'profit-loss'[\s\S]*DivisionProfitLossView/);
  assert.doesNotMatch(statement, /<Input|<Select|<TextArea|onChange=/);
});

test('Other Costs is a compatible URL alias while persisted planning uses overhead', () => {
  assert.match(division, /requestedTab === 'other-costs' \? 'overhead'/);
  assert.match(plannerModel, /'subcontractors', 'overhead'/);
  assert.match(plannerModel, /overhead: \['costCode', 'plannedAmount'\]/);
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

test('financial statements show hierarchy, incomplete state, and honest company overhead boundary', () => {
  assert.match(statement, /Total Revenue/);
  assert.match(statement, /Total Direct Costs/);
  assert.match(statement, /Gross Profit/);
  assert.match(statement, /Total Overhead/);
  assert.match(statement, /Operating Profit/);
  assert.match(statement, /Budget incomplete/);
  assert.match(statement, /Operating Profit before Company Overhead/);
  assert.match(statement, /Company Overhead is not allocated to Divisions yet/);
  assert.match(statement, /Division Breakdown/);
});

test('Company Overhead tab exposes existing Budget overhead rows without reallocating them', () => {
  assert.match(budget, /companyOverheadItems = budgetItems\.filter/);
  assert.match(budget, /item\.category === 'overhead'/);
  assert.match(budget, /Total Company Overhead/);
  assert.match(budget, /It is not silently allocated to Divisions/);
});