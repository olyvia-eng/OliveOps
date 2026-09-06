import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTimeEntryCursor,
  encodeTimeEntryCursor,
  normalizeTimeEntryPageQuery,
  timeEntryIndexAttributes,
} from '../api/_lib/timeEntryPagination.js';

test('applies surface defaults and rejects unsupported page sizes', () => {
  assert.equal(normalizeTimeEntryPageQuery({}, { surface: 'reports', businessId: 'business-1' }).limit, 25);
  assert.equal(normalizeTimeEntryPageQuery({ jobId: 'job-1' }, { surface: 'job', businessId: 'business-1' }).limit, 10);
  assert.throws(
    () => normalizeTimeEntryPageQuery({ limit: '10' }, { surface: 'reports', businessId: 'business-1' }),
    (error) => error.code === 'time_entry_limit_invalid'
  );
  assert.throws(
    () => normalizeTimeEntryPageQuery({ limit: '100' }, { surface: 'job', businessId: 'business-1' }),
    (error) => error.code === 'time_entry_limit_invalid'
  );
});

test('canonicalizes filters and keeps zero-duration entries by default', () => {
  const page = normalizeTimeEntryPageQuery({
    limit: '50',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    workType: 'job',
    jobId: ' job-1 ',
  }, { surface: 'reports', businessId: 'business-1', employeeIds: ['employee-b', 'employee-a', 'employee-a'] });

  assert.equal(page.limit, 50);
  assert.equal(page.filters.includeZero, true);
  assert.deepEqual(page.filters.employeeIds, ['employee-a', 'employee-b']);
  assert.equal(page.filters.startAt, '2026-01-01T00:00:00.000Z');
  assert.equal(page.filters.endAt, '2026-01-31T23:59:59.999Z');
});

test('cursor is opaque, signed, and bound to the canonical business and filter scope', () => {
  const reports = normalizeTimeEntryPageQuery({ limit: '25', jobId: 'job-1' }, { surface: 'reports', businessId: 'business-1' });
  const otherBusiness = normalizeTimeEntryPageQuery({ limit: '25', jobId: 'job-1' }, { surface: 'reports', businessId: 'business-2' });
  const otherJob = normalizeTimeEntryPageQuery({ limit: '25', jobId: 'job-2' }, { surface: 'reports', businessId: 'business-1' });
  const key = { timeEntryIndexPk: 'scope', timeEntryIndexSk: 'sort', PK: 'business', SK: 'entry' };
  const cursor = encodeTimeEntryCursor({ scopeHash: reports.scopeHash, key });

  assert.deepEqual(decodeTimeEntryCursor(cursor, reports.scopeHash), key);
  assert.throws(() => decodeTimeEntryCursor(`${cursor.slice(0, -1)}x`, reports.scopeHash));
  assert.throws(() => decodeTimeEntryCursor(cursor, otherBusiness.scopeHash));
  assert.throws(() => decodeTimeEntryCursor(cursor, otherJob.scopeHash));
  assert.equal(cursor.includes('business-1'), false);
});

test('index keys preserve active-first, newest-first, created-at, then ascending ID order', () => {
  const entries = [
    { id: 'z-entry', status: 'clocked_out', clockIn: '2026-01-02T10:00:00Z', createdAt: '2026-01-02T10:01:00Z' },
    { id: 'b-entry', status: 'clocked_out', clockIn: '2026-01-02T10:00:00Z', createdAt: '2026-01-02T10:02:00Z' },
    { id: 'a-entry', status: 'clocked_out', clockIn: '2026-01-02T10:00:00Z', createdAt: '2026-01-02T10:02:00Z' },
    { id: 'active', status: 'clocked_in', clockIn: '2026-01-01T10:00:00Z', createdAt: '2026-01-01T10:00:00Z' },
  ];

  const ordered = entries.slice().sort((left, right) => timeEntryIndexAttributes('business-1', right).timeEntryIndexSk.localeCompare(timeEntryIndexAttributes('business-1', left).timeEntryIndexSk));
  assert.deepEqual(ordered.map((entry) => entry.id), ['active', 'a-entry', 'b-entry', 'z-entry']);
});

test('server filters include multi-Job and zero-duration entries before page selection', async () => {
  const { matchesTimeEntryFilters } = await import('../api/_lib/timeEntryPagination.js');
  const page = normalizeTimeEntryPageQuery({ jobId: 'job-2', includeZero: 'true' }, { surface: 'reports', businessId: 'business-1' });
  const zeroDuration = {
    id: 'entry-1', employeeId: 'employee-1', jobId: 'job-1', jobIds: ['job-1', 'job-2'], workType: 'job',
    clockIn: '2026-01-01T10:00:00.000Z', clockOut: '2026-01-01T10:00:00.000Z', breakMinutes: 0, status: 'clocked_out',
  };
  assert.equal(matchesTimeEntryFilters(zeroDuration, page.filters), true);
  assert.equal(matchesTimeEntryFilters(zeroDuration, { ...page.filters, includeZero: false }), false);
  assert.equal(matchesTimeEntryFilters({ ...zeroDuration, jobIds: ['job-1'] }, page.filters), false);
});

test('employee ID filtering switches employees and All Employees restores matching records', async () => {
  const { matchesTimeEntryFilters } = await import('../api/_lib/timeEntryPagination.js');
  const janeEntry = {
    id: 'entry-jane', employeeId: 'employee-jane', workType: 'non_billable', unbillableCategoryId: 'weather',
    clockIn: '2026-01-15T10:00:00.000Z', clockOut: '2026-01-15T11:00:00.000Z', breakMinutes: 0, status: 'clocked_out',
  };
  const johnEntry = { ...janeEntry, id: 'entry-john', employeeId: 'employee-john' };
  const janePage = normalizeTimeEntryPageQuery({
    employeeId: 'employee-jane', startDate: '2026-01-01', endDate: '2026-01-31', workType: 'non_billable', unbillableCategoryId: 'weather',
  }, { surface: 'reports', businessId: 'business-1', employeeIds: ['employee-jane'] });
  const johnPage = normalizeTimeEntryPageQuery({ employeeId: 'employee-john' }, { surface: 'reports', businessId: 'business-1', employeeIds: ['employee-john'] });
  const allEmployeesPage = normalizeTimeEntryPageQuery({}, { surface: 'reports', businessId: 'business-1' });

  assert.equal(matchesTimeEntryFilters(janeEntry, janePage.filters), true);
  assert.equal(matchesTimeEntryFilters(johnEntry, janePage.filters), false);
  assert.equal(matchesTimeEntryFilters(janeEntry, johnPage.filters), false);
  assert.equal(matchesTimeEntryFilters(johnEntry, johnPage.filters), true);
  assert.equal(matchesTimeEntryFilters(janeEntry, allEmployeesPage.filters), true);
  assert.equal(matchesTimeEntryFilters(johnEntry, allEmployeesPage.filters), true);
});

test('server filters retain open activities and legacy single-Job records', async () => {
  const { matchesTimeEntryFilters } = await import('../api/_lib/timeEntryPagination.js');
  const page = normalizeTimeEntryPageQuery({ jobId: 'job-1', status: 'clocked_in' }, { surface: 'job', businessId: 'business-1' });
  const legacyOpenEntry = {
    id: 'entry-open', employeeId: 'employee-1', jobId: 'job-1', workType: 'job',
    clockIn: '2026-01-01T10:00:00.000Z', status: 'clocked_in', createdAt: '2026-01-01T10:00:00.000Z',
  };
  assert.equal(matchesTimeEntryFilters(legacyOpenEntry, page.filters), true);
  assert.equal(matchesTimeEntryFilters({ ...legacyOpenEntry, status: 'clocked_out' }, page.filters), false);
});