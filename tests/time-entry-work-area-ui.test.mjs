import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('web TimeEntry and correction models retain Work Area IDs and snapshots', async () => {
  const [types, corrections] = await Promise.all([
    source('../src/types/index.ts'),
    source('../src/utils/timeCorrections.ts'),
  ]);
  assert.match(types, /interface TimeEntry[^]*workAreaId\?: ID;[^]*workAreaNameSnapshot\?: string;/);
  assert.match(types, /interface TimeCorrectionRequest[^]*requestedWorkAreaId\?: ID;[^]*requestedWorkAreaNameSnapshot\?: string;/);
  assert.match(types, /interface TimeCorrectionRequest[^]*originalWorkAreaId\?: ID;[^]*originalWorkAreaNameSnapshot\?: string;/);
  assert.match(corrections, /workAreaId: nextWorkAreaId/);
  assert.match(corrections, /workAreaNameSnapshot: nextWorkAreaNameSnapshot/);
});

test('active, employee history, report, dashboard, and Job surfaces use snapshot-aware presentation', async () => {
  const files = await Promise.all([
    source('../src/pages/employees/EmployeesPage.tsx'),
    source('../src/pages/employees/EmployeeProfilePage.tsx'),
    source('../src/pages/employees/EmployeePortalPage.tsx'),
    source('../src/pages/Dashboard.tsx'),
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
    source('../src/pages/employees/ClockInModal.tsx'),
    source('../src/pages/department-dashboards/DataCenterDashboardPage.tsx'),
  ]);
  for (const contents of files) assert.match(contents, /timeEntryPresentation\.js/);
  assert.match(files[1], /formatTimeEntryDuration\(durationHours/);
  assert.match(files[3], /workLabel = getTimeEntryWorkLabel/);
  assert.match(files[4], /getTimeEntryPresentation[^]*presentation\.workLabel/);
  assert.match(files[5], /getTimeEntryPresentation[^]*presentation\.workLabel/);
  for (const contents of files) assert.doesNotMatch(contents, /Unknown Work Area|null ·|· null/);
});

test('employee and Job histories use the same snapshot-backed work label', async () => {
  const [employeeProfile, jobDetail, presentation] = await Promise.all([
    source('../src/pages/employees/EmployeeProfilePage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
    source('../src/utils/timeEntryPresentation.js'),
  ]);
  assert.match(employeeProfile, /getTimeEntryWorkLabel/);
  assert.match(jobDetail, /getTimeEntryPresentation[^]*presentation\.workLabel/);
  assert.match(presentation, /workAreaNameSnapshot/);
  assert.doesNotMatch(presentation, /operationalWorkAreas|workAreas\.find/);
});

test('correction review displays persisted original and requested Work Area snapshots', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.match(reports, /item\.originalWorkAreaNameSnapshot/);
  assert.match(reports, /item\.requestedWorkAreaNameSnapshot/);
  assert.doesNotMatch(reports, /sourceEstimateWorkAreaId/);
});