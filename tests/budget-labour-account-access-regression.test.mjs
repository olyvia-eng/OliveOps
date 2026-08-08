import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('budget labour modal supports all account access modes for adding actual employees', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /type LabourAccountAccessMode = 'none' \| 'link_existing' \| 'create_login';/);
  assert.match(source, /<option value="none">No OliveOps access<\/option>/);
  assert.match(source, /<option value="link_existing">Link existing account<\/option>/);
  assert.match(source, /<option value="create_login">Create login access<\/option>/);
  assert.match(source, /accountAccess = \{\s*mode: 'none'/);
  assert.match(source, /mode: 'link_existing'/);
  assert.match(source, /mode: 'create_login'/);
  assert.match(source, /fetch\('\/api\/data\?entity=employees'/);
});
