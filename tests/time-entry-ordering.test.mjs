import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sortTimeEntriesNewestFirst } from '../src/utils/timeEntryPresentation.js';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const entry = (id, clockIn, overrides = {}) => ({
  id,
  clockIn,
  status: 'clocked_out',
  createdAt: clockIn,
  ...overrides,
});

test('sorts same-day entries by clock-in time newest first', () => {
  const morning = entry('morning', '2026-08-31T09:00:00-04:00');
  const afternoon = entry('afternoon', '2026-08-31T15:00:00-04:00');

  assert.deepEqual(sortTimeEntriesNewestFirst([morning, afternoon]).map((item) => item.id), ['afternoon', 'morning']);
});

test('sorts entries across dates newest first', () => {
  const august30 = entry('aug-30', '2026-08-30T12:00:00-04:00');
  const august31 = entry('aug-31', '2026-08-31T08:00:00-04:00');

  assert.deepEqual(sortTimeEntriesNewestFirst([august30, august31]).map((item) => item.id), ['aug-31', 'aug-30']);
});

test('does not promote an older shift based on its edit timestamp', () => {
  const editedAugust29 = entry('edited-aug-29', '2026-08-29T09:00:00-04:00', { updatedAt: '2026-08-31T18:00:00-04:00' });
  const august30 = entry('aug-30', '2026-08-30T09:00:00-04:00', { updatedAt: '2026-08-30T10:00:00-04:00' });

  assert.deepEqual(sortTimeEntriesNewestFirst([editedAugust29, august30]).map((item) => item.id), ['aug-30', 'edited-aug-29']);
});

test('places an active shift above historical entries', () => {
  const active = entry('active', '2026-08-30T08:00:00-04:00', { status: 'clocked_in' });
  const newerHistorical = entry('historical', '2026-08-31T08:00:00-04:00');

  assert.deepEqual(sortTimeEntriesNewestFirst([newerHistorical, active]).map((item) => item.id), ['active', 'historical']);
});

test('sorts shifts spanning midnight by clock-in timestamp', () => {
  const overnight = entry('overnight', '2026-08-30T23:30:00-04:00', { clockOut: '2026-08-31T07:30:00-04:00' });
  const laterStart = entry('later-start', '2026-08-31T06:00:00-04:00', { clockOut: '2026-08-31T08:00:00-04:00' });

  assert.deepEqual(sortTimeEntriesNewestFirst([overnight, laterStart]).map((item) => item.id), ['later-start', 'overnight']);
});

test('uses createdAt then ID for deterministic matching clock-in timestamps', () => {
  const clockIn = '2026-08-31T09:00:00-04:00';
  const entries = [
    entry('z-entry', clockIn, { createdAt: '2026-08-31T09:01:00-04:00' }),
    entry('b-entry', clockIn, { createdAt: '2026-08-31T09:02:00-04:00' }),
    entry('a-entry', clockIn, { createdAt: '2026-08-31T09:02:00-04:00' }),
  ];

  assert.deepEqual(sortTimeEntriesNewestFirst(entries).map((item) => item.id), ['a-entry', 'b-entry', 'z-entry']);
  assert.deepEqual(entries.map((item) => item.id), ['z-entry', 'b-entry', 'a-entry']);
});

test('time-entry list surfaces use shared ordering and activity feeds use clock-in time', async () => {
  const [portal, profile, job, reports, dataCenter, dashboard, homeDashboard] = await Promise.all([
    source('../src/pages/employees/EmployeePortalPage.tsx'),
    source('../src/pages/employees/EmployeeProfilePage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/pages/department-dashboards/DataCenterDashboardPage.tsx'),
    source('../src/pages/Dashboard.tsx'),
    source('../src/pages/home/homeDashboardModel.js'),
  ]);

  for (const contents of [portal, profile, job, reports, dataCenter]) {
    assert.match(contents, /sortTimeEntriesNewestFirst/);
  }
  for (const contents of [dashboard, homeDashboard]) {
    assert.match(contents, /sortAt: (?:parseTimestamp\()?entry\.clockIn/);
    assert.match(contents, /activeTimeEntry: entry\.status === 'clocked_in'/);
    assert.match(contents, /timestamp: entry\.clockOut (?:\?\?|\|\|) entry\.clockIn/);
  }
});