import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const setup = readFileSync('src/pages/settings/SchedulingSetupPage.tsx', 'utf8');

test('scheduling setup is owner-admin routed from company setup', () => {
  assert.match(app, /path="settings\/scheduling"/);
  assert.match(app, /canManageUsers \? <SchedulingSetupPage \/>/);
  assert.match(sidebar, /Scheduling.*\/settings\/scheduling/);
  assert.match(sidebar, /visible: canManageCompanySetup/);
});

test('scheduling setup manages operational division and crew fields', () => {
  assert.match(setup, /saveDivision/);
  assert.match(setup, /saveCrew/);
  assert.match(setup, /Crew lead/);
  assert.match(setup, /Default division/);
  assert.match(setup, /Members/);
  assert.match(setup, /SCHEDULE_COLOUR_PALETTE/);
});