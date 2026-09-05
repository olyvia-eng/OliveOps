import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const library = readFileSync('src/pages/training/TrainingLibraryPage.tsx', 'utf8');
const builder = readFileSync('src/pages/training/TrainingBuilderPage.tsx', 'utf8');
const detail = readFileSync('src/pages/training/TrainingDetailPage.tsx', 'utf8');
const employeeTraining = readFileSync('src/components/employees/EmployeeTrainingSection.tsx', 'utf8');

test('Training administration uses protected full-page routes and owner/admin navigation', () => {
  for (const route of ['training', 'training/new', 'training/:trainingId', 'training/:trainingId/edit']) {
    assert.match(app, new RegExp(`path="${route.replaceAll('/', '\\/')}"`));
  }
  assert.match(sidebar, /team-training[^\n]+roles: ownerAdminRoles/);
});

test('Training Library presents decision-first counts, filters, and module actions', () => {
  for (const text of ['Active training modules', 'Assigned', 'Due soon', 'Overdue', 'Duplicate', 'Deactivate']) assert.match(library, new RegExp(text));
  assert.match(library, /const \[query, setQuery\]/);
  assert.match(library, /const \[status, setStatus\]/);
});

test('Training builder supports immutable publish choices and stable checklist editing', () => {
  assert.match(builder, /crypto\.randomUUID\(\)/);
  assert.match(builder, /start-draft/);
  assert.match(builder, /Keep current assignments valid/);
  assert.match(builder, /Require selected employees to complete this version/);
  assert.match(builder, /requireEmployeeIds/);
  assert.match(builder, /New version due date/);
});

test('Training detail and employee profile expose assignment operations and transparent compliance', () => {
  assert.match(detail, /All currently active employees/);
  assert.match(detail, /does not include future hires/);
  assert.match(detail, /Change due/);
  assert.match(detail, /Completion history/);
  assert.match(employeeTraining, /Training compliance/);
  assert.match(employeeTraining, /No training assigned/);
  assert.match(employeeTraining, /completion\.checklistItems/);
});
