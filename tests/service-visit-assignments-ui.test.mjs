import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/jobs/ServiceJobDetailPage.tsx', 'utf8');
const api = readFileSync('src/pages/jobs/serviceVisitApi.ts', 'utf8');
const calendar = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');

test('Visits expose row details and an interactive assignment summary', () => {
  assert.match(page, /onClick=\{\(\) => setSelectedVisit\(visit\)\}/);
  assert.match(page, /event\.stopPropagation\(\); if \(canManage\) setAssignmentVisit\(visit\)/);
  assert.match(page, /assignmentSummary\(visit\)/);
  assert.match(page, /title=\{assignedNames \|\| 'No assignments'\}/);
});

test('Visit assignment drawer uses searchable active employee and equipment multi-selects', () => {
  assert.match(page, /aria-label="Visit assignments"/);
  assert.match(page, /placeholder="Search employees"/);
  assert.match(page, /placeholder="Search equipment"/);
  assert.match(page, /employee\.active \|\| employeeIds\.includes\(employee\.id\)/);
  assert.match(page, /asset\.status !== 'inactive' \|\| equipmentIds\.includes\(asset\.id\)/);
  assert.match(page, /employee\.role\.replaceAll\('_', ' '\)/);
  assert.match(page, /toggle\(employeeIds, employee\.id, setEmployeeIds\)/);
  assert.match(page, /toggle\(equipmentIds, asset\.id, setEquipmentIds\)/);
});

test('assignment save updates local Visits and future application requires confirmation', () => {
  assert.match(page, /setConfirmingFuture\(true\)/);
  assert.match(page, /Apply to \{futureVisitCount\} future scheduled Visit/);
  assert.match(page, /Confirm and apply/);
  assert.match(page, /updateServiceVisitAssignments\(visit, employeeIds, equipmentIds, applyToFuture\)/);
  assert.match(page, /onSaved\(result\.updatedVisits\)/);
  assert.match(page, /updates\.get\(visit\.id\) \?\? visit/);
  assert.match(api, /action: 'assignments'/);
});

test('Schedule uses the same canonical Service Visit assignment fields', () => {
  assert.match(calendar, /employeeIds: visit\.assignedEmployeeIds/);
  assert.match(calendar, /equipmentIds: visit\.assignedEquipmentIds/);
  assert.match(page, /searchParams\.get\('visit'\)/);
  assert.match(page, /visits\.find\(\(visit\) => visit\.id === requestedVisitId\)/);
});