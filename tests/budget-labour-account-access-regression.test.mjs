import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('labour planner uses shared employee modals and employee catalog add flow', () => {
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const sharedModalSource = readFileSync('src/components/employees/EmployeeEditModal.tsx', 'utf8');
  const authRepoSource = readFileSync('api/_lib/authRepo.js', 'utf8');
  const typesSource = readFileSync('src/types/index.ts', 'utf8');
  const budgetCategoriesSource = readFileSync('src/config/budgetCategories.js', 'utf8');
  const combinedBudgetModelSource = readFileSync('src/pages/budget/combinedBudgetModel.js', 'utf8');

  assert.match(budgetSource, /Employee Catalog/);
  assert.match(budgetSource, /\.filter\(\(employee\) => employee.active\)/);
  assert.match(budgetSource, /handleAddPlannerEmployee\(employee.id\)/);
  assert.match(budgetSource, /toOptionLabel\(employee.role \?\? 'crew_member'\)/);
  assert.match(typesSource, /export \{ BUDGET_CATEGORIES \}/);
  assert.match(budgetCategoriesSource, /export const BUDGET_CATEGORIES = \[/);
  assert.match(budgetCategoriesSource, /'revenue'/);
  assert.match(budgetCategoriesSource, /'other'/);
  assert.match(budgetSource, /const createBudgetCategoryGroups = \(\): Record<BudgetCategory, BudgetItem\[]> => \(\{/);
  assert.match(budgetSource, /revenue: \[\],/);
  assert.match(budgetSource, /other: \[\],/);
  assert.match(budgetSource, /const grouped = useMemo\(\(\) => \{/);
  assert.doesNotMatch(budgetSource, /\{\} as Record<BudgetCategory, BudgetItem\[]>/);
  assert.match(budgetSource, /import \{ BUDGET_CATEGORIES \} from '\.\.\/\.\.\/config\/budgetCategories\.js';/);
  assert.match(combinedBudgetModelSource, /import \{ BUDGET_CATEGORIES \} from '\.\.\/\.\.\/config\/budgetCategories\.js';/);
  assert.match(budgetSource, /<EmployeeCreateModal/);
  assert.match(budgetSource, /<EmployeeEditModal open=\{Boolean\(editEmployeeId\)\}/);
  assert.match(sharedModalSource, /<option value="none">No OliveOps access<\/option>/);
  assert.match(sharedModalSource, /<option value="link_existing">Link existing account<\/option>/);
  assert.match(sharedModalSource, /<option value="create_login">Create login access<\/option>/);
  assert.match(sharedModalSource, /fetch\(`\/api\/data\?entity=employees&id=\$\{encodeURIComponent\(employee.id\)\}`/);
  assert.match(authRepoSource, /role: normalizeEmployeeRole\(item.role\)/);
});
