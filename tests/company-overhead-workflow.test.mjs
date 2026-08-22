import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const companyOverhead = readFileSync('src/components/budget/CompanyOverheadSection.tsx', 'utf8');
const budgetWorkspace = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');
const divisionWorkspace = readFileSync('src/pages/budget/DivisionWorkspacePage.tsx', 'utf8');
const divisionPlanning = readFileSync('src/components/budget/DivisionPlanningTab.tsx', 'utf8');
const store = readFileSync('src/store/index.ts', 'utf8');

test('Company Overhead has a clear empty state and add action', () => {
  assert.match(companyOverhead, /No company overhead yet/);
  assert.match(companyOverhead, /Add company-wide operating costs that aren't specific to an individual division\./);
  assert.match(companyOverhead, /Add Company Overhead/);
  assert.match(companyOverhead, /Company-wide operating costs that are not specific to one division\./);
});

test('Company Overhead form requires a name and positive non-defaulted annual amount', () => {
  assert.match(companyOverhead, /annualAmount: ''/);
  assert.match(companyOverhead, /Boolean\(form\.description\.trim\(\)\)/);
  assert.match(companyOverhead, /form\.annualAmount\.trim\(\) !== ''/);
  assert.match(companyOverhead, /annualAmount > 0/);
  assert.match(companyOverhead, /label="Overhead cost" required/);
  assert.match(companyOverhead, /label="Annual amount" required/);
  assert.match(companyOverhead, /disabled=\{saving \|\| !formIsValid\}/);
});

test('Company Overhead add and edit await individual persistence and preserve failed forms', () => {
  assert.match(companyOverhead, /await addBudgetItem/);
  assert.match(companyOverhead, /await updateBudgetItem/);
  assert.match(companyOverhead, /if \(!saved\)[\s\S]*setFormError[\s\S]*return/);
  assert.match(companyOverhead, /setEditing\(null\)/);
  assert.match(companyOverhead, /description: item\.description/);
  assert.match(companyOverhead, /annualAmount: String\(item\.budgeted\)/);
  assert.match(companyOverhead, /role="alert"/);
  assert.match(store, /addBudgetItem: async \(item, allocationMonths\)/);
  assert.match(store, /updateBudgetItem: async \(id, data, allocationMonths\)/);
});

test('Company Overhead delete requires confirmation and reports persistence failure', () => {
  assert.match(companyOverhead, /title="Delete Company Overhead"/);
  assert.match(companyOverhead, /This cannot be undone\./);
  assert.match(companyOverhead, /await deleteBudgetItem\(deleting\.id\)/);
  assert.match(companyOverhead, /if \(!deleted\)[\s\S]*setDeleteError[\s\S]*return/);
  assert.match(store, /deleteBudgetItem: async \(id\)/);
});

test('Company Overhead list shows actions and a persisted-item total', () => {
  assert.match(companyOverhead, /Overhead Cost[\s\S]*Cost Code[\s\S]*Annual Amount/);
  assert.match(companyOverhead, /aria-label=\{`Edit \$\{item\.description\}`\}/);
  assert.match(companyOverhead, /aria-label=\{`Delete \$\{item\.description\}`\}/);
  assert.match(companyOverhead, /Total Company Overhead/);
  assert.match(companyOverhead, /formatCurrency\(total\)/);
  assert.match(budgetWorkspace, /total=\{financials\.companyOverhead\}/);
});

test('Company Overhead remains a top-level persisted Budget item across reloads', () => {
  assert.match(budgetWorkspace, /companyOverheadItems = budgetItems\.filter/);
  assert.match(budgetWorkspace, /item\.budgetId === budget\.id && item\.category === 'overhead'/);
  assert.match(companyOverhead, /budgetId: budget\.id/);
  assert.match(companyOverhead, /category: 'overhead'/);
  assert.match(store, /body: JSON\.stringify\(\{ data: \{ \.\.\.budgetItem, budgeted: item\.budgeted \}, allocationMonths \}\)/);
});

test('Company Overhead submissions are guarded before React rerenders', () => {
  assert.match(companyOverhead, /saveInFlight\.current/);
  assert.match(companyOverhead, /if \(!editing \|\| !formIsValid \|\| saveInFlight\.current\) return/);
  assert.match(companyOverhead, /deleteInFlight\.current/);
  assert.match(companyOverhead, /if \(!deleting \|\| deleteInFlight\.current\) return/);
});

test('Division Overhead keeps its scoped category while using clearer labels', () => {
  assert.match(divisionWorkspace, /key: 'overhead', label: 'Division Overhead'/);
  assert.match(divisionWorkspace, /category=\{activeTab\}/);
  assert.match(divisionPlanning, /label: 'Division Overhead'/);
  assert.match(divisionPlanning, /Costs specific to this division that are not already captured as labour, equipment, materials, or subcontractor costs\./);
  assert.match(divisionPlanning, /item\.divisionId === division\.id/);
});

test('top-level Save Changes is not part of Company Overhead persistence', () => {
  assert.match(budgetWorkspace, /saveIfDirty[\s\S]*updateBudget\(budget\.id/);
  assert.doesNotMatch(budgetWorkspace, /saveIfDirty[\s\S]{0,1200}(addBudgetItem|updateBudgetItem|deleteBudgetItem)/);
  assert.match(companyOverhead, /await (addBudgetItem|updateBudgetItem|deleteBudgetItem)/);
});