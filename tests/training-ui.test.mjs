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
  for (const text of ['Active training modules', 'Assigned', 'Due soon', 'Overdue', 'Duplicate', 'Deactivate Training', 'Reactivate Training']) assert.match(library, new RegExp(text));
  assert.match(library, /const \[query, setQuery\]/);
  assert.match(library, /const \[status, setStatus\]/);
});

test('Training row ellipsis opens an accessible menu without changing status', () => {
  assert.match(library, /aria-label={`Actions for \$\{training\.title\}`}/);
  assert.match(library, /aria-haspopup="menu"/);
  assert.match(library, /role="menu"/);
  assert.match(library, /role="menuitem"/);
  assert.match(library, /setMenuTrainingId\(\(current\) => current === training\.id \? null : training\.id\)/);
  assert.doesNotMatch(library, /onClick=\{\(\) => void (?:deactivate|setActive)\(training\)\}/);
  assert.match(library, /onClick=\{\(\) => void setActive\(\)\}/);
});

test('Training menu actions follow status rules and preserve immutable history', () => {
  for (const text of ['Edit draft', 'Preview', 'Publish', 'View Training', 'Assign to employees', 'View assignments', 'View completion history', 'Create new version', 'View version history']) assert.match(library, new RegExp(text));
  assert.doesNotMatch(library, />Delete draft</);
  assert.match(library, /training\.active && training\.currentVersion > 0/);
  assert.match(library, /Current incomplete assignments remain active and accessible/);
  assert.match(library, /Existing completion history and immutable version records remain unchanged/);
  assert.match(library, /statusRequestInFlight\.current/);
  assert.match(library, /duplicateRequestInFlight\.current/);
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
  assert.match(detail, /useSearchParams/);
  assert.match(detail, /searchParams\.get\('tab'\)/);
  assert.match(detail, /searchParams\.get\('assign'\) === '1'/);
  assert.match(detail, /All currently active employees/);
  assert.match(detail, /does not include future hires/);
  assert.match(detail, /Change due/);
  assert.match(detail, /Completion history/);
  assert.match(employeeTraining, /Training compliance/);
  assert.match(employeeTraining, /No training assigned/);
  assert.match(employeeTraining, /completion\.checklistItems/);
});
