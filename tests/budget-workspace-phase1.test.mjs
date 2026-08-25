import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeBudgetSnapshotsModel } from '../src/utils/budgetPersistenceState.js';

const appSource = readFileSync('src/App.tsx', 'utf8');
const overviewSource = readFileSync('src/pages/budget/BudgetsOverviewPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');
const divisionSource = readFileSync('src/pages/budget/DivisionWorkspacePage.tsx', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');

test('new Budget creation installs one persisted record before workspace navigation', () => {
  assert.match(overviewSource, /if \(creating\) return/);
  assert.match(overviewSource, /const created = await addBudget/);
  assert.match(overviewSource, /planningModel: 'divisions_v1'/);
  assert.match(overviewSource, /navigate\(`\/budgets\/\$\{created\.id\}\?tab=info`\)/);
  assert.doesNotMatch(overviewSource, /window\.location|setTimeout/);
  assert.match(storeSource, /if \(!payload\.ok \|\| !payload\.budget\)/);
  assert.match(storeSource, /budgets: \[\.\.\.state\.budgets\.filter/);
});

test('stale bootstrap cannot remove a Budget or Division inserted while in flight', () => {
  const existing = { id: 'old', updatedAt: '2027-01-01T00:00:00.000Z' };
  const created = { id: 'new', updatedAt: '2027-01-01T00:00:00.000Z' };
  assert.deepEqual(
    mergeBudgetSnapshotsModel([existing, created], [existing], new Set([existing.id])).map((item) => item.id),
    ['old', 'new'],
  );
});

test('parent and Division routes preserve Budget context without legacy routes', () => {
  assert.match(appSource, /path="budgets\/:budgetId\/divisions\/:divisionId"/);
  assert.match(appSource, /path="budgets\/:budgetId" element=\{<BudgetWorkspacePage/);
  assert.doesNotMatch(appSource, /budgets\/:budgetId\/legacy|budgets\/combined|budgets\/groups\/:groupId/);
  assert.match(divisionSource, /navigate\(`\/budgets\/\$\{budget\.id\}\?tab=divisions`\)/);
  assert.match(divisionSource, /Overview[\s\S]*Labour[\s\S]*Equipment[\s\S]*Materials[\s\S]*Subcontractors[\s\S]*Overhead[\s\S]*Profit & Loss/);
  assert.match(divisionSource, /requestedTab === 'other-costs' \? 'overhead'/);
});

test('Division roll-ups use stored revenue targets and centralized financial calculations', () => {
  const divisions = [{ revenueTarget: 500000 }, { revenueTarget: 700000 }];
  assert.equal(divisions.reduce((sum, item) => sum + item.revenueTarget, 0), 1200000);
  assert.match(workspaceSource, /activeDivisions\.reduce\(\(sum, item\) => sum \+ item\.revenueTarget, 0\)/);
  assert.match(workspaceSource, /calculateBudgetFinancials/);
  assert.match(workspaceSource, /Total Direct Cost[\s\S]*financials\.totalDirectCosts/);
  assert.match(workspaceSource, /Gross Profit[\s\S]*result\.grossProfit/);
  assert.doesNotMatch(workspaceSource, /Contribution before Company/);
});

test('Division Overview edits the canonical Revenue Target without a duplicate field', () => {
  assert.match(divisionSource, /aria-label="Edit Revenue Target"/);
  assert.match(divisionSource, /setRevenueTargetDraft\(String\(division\.revenueTarget\)\)/);
  assert.match(divisionSource, /updateBudgetDivision\(budget\.id, division\.id, \{ revenueTarget \}\)/);
  assert.match(divisionSource, /if \(saved\) setEditingRevenueTarget\(false\)/);
  assert.match(divisionSource, /Revenue target must be zero or greater\./);
  assert.match(divisionSource, /onClick=\{cancelRevenueTargetEdit\}/);
  assert.doesNotMatch(divisionSource, /updateBudget\(.*revenueTarget|revenueTarget: financials\.revenue/);
  assert.match(storeSource, /budgetDivisions: state\.budgetDivisions\.map\(\(item\) => item\.id === id \? payload\.division as BudgetDivision : item\)/);
});

test('Analysis uses the financial statement before existing recovery and pricing', () => {
  assert.match(workspaceSource, /activeTab === 'analysis'[\s\S]*<BudgetAnalysisSummary[\s\S]*<BudgetPricingAnalysis/);
  assert.match(workspaceSource, /financials=\{financials\}/);
  assert.match(workspaceSource, /targetMarginPct=\{budget\.targetMarginPct\}/);
  assert.match(workspaceSource, /onTargetMarginChange=\{\(targetMarginPct\) => updateBudget\(budget\.id, \{ targetMarginPct \}\)\}/);
  assert.doesNotMatch(workspaceSource, /activeTab === 'analysis'[\s\S]{0,300}lg:grid-cols-5/);
  assert.doesNotMatch(workspaceSource, /Summary label="Direct Costs"|Summary label="Gross Profit"|Summary label="Net Profit"/);
  assert.doesNotMatch(workspaceSource, /Division Performance|No Division performance yet/);
});

test('legacy Budgets and group controls are absent from the Budget overview', () => {
  assert.match(overviewSource, /budget\.planningModel === 'divisions_v1'/);
  assert.doesNotMatch(overviewSource, /Legacy budget roll-ups|Legacy planning|FolderArchive/);
  assert.doesNotMatch(overviewSource, /New Group|Group Selected|saveBudgetGroup|dissolveBudgetGroup/);
});

test('Budget Division add and edit forms persist a Division cost code', () => {
  assert.match(workspaceSource, /division\?\.costCode \?\? ''/);
  assert.match(workspaceSource, /costCode: divisionForm\.costCode\.trim\(\)/);
  assert.match(workspaceSource, /label="Cost Code"/);
  assert.match(workspaceSource, /division\.costCode \|\| '—'/);
});