import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('labour planner uses shared employee modals and employee catalog add flow', () => {
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const sharedModalSource = readFileSync('src/components/employees/EmployeeEditModal.tsx', 'utf8');

  assert.match(budgetSource, /Employee Catalog/);
  assert.match(budgetSource, /\.filter\(\(employee\) => employee.active\)/);
  assert.match(budgetSource, /handleAddPlannerEmployee\(employee.id\)/);
  assert.match(budgetSource, /<EmployeeCreateModal/);
  assert.match(budgetSource, /<EmployeeEditModal open=\{Boolean\(editEmployeeId\)\}/);
  assert.match(sharedModalSource, /<option value="none">No OliveOps access<\/option>/);
  assert.match(sharedModalSource, /<option value="link_existing">Link existing account<\/option>/);
  assert.match(sharedModalSource, /<option value="create_login">Create login access<\/option>/);
  assert.match(sharedModalSource, /fetch\(`\/api\/data\?entity=employees&id=\$\{encodeURIComponent\(employee.id\)\}`/);
});
