import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const setup = readFileSync('src/pages/settings/SchedulingSetupPage.tsx', 'utf8');

test('legacy scheduling setup is no longer exposed through routes or navigation', () => {
  assert.doesNotMatch(app, /path="settings\/scheduling"/);
  assert.doesNotMatch(app, /SchedulingSetupPage/);
  assert.doesNotMatch(sidebar, /\/settings\/scheduling/);
});

test('legacy scheduling setup remains available as non-destructive compatibility infrastructure', () => {
  assert.match(setup, /saveDivision/);
  assert.match(setup, /saveCrew/);
  assert.match(setup, /Crew lead/);
  assert.match(setup, /Default division/);
  assert.match(setup, /Members/);
  assert.match(setup, /SCHEDULE_COLOUR_PALETTE/);
});

test('crew and division edits open catalog-style modal forms', () => {
  assert.match(setup, /open=\{divisionId !== null\}/);
  assert.match(setup, /title=\{`Edit Division/);
  assert.match(setup, /form="edit-division-form"/);
  assert.match(setup, /open=\{crewId !== null\}/);
  assert.match(setup, /title=\{`Edit Crew/);
  assert.match(setup, /form="edit-crew-form"/);
  assert.match(setup, /Save Changes/);
  assert.match(setup, /if \(!saving\) resetDivision\(\)/);
  assert.match(setup, /if \(!saving\) resetCrew\(\)/);
});