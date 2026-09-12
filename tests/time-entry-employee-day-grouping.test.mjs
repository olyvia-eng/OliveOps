import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { groupTimeEntriesByEmployeeDay } from '../src/utils/timeEntryPresentation.js';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const entry = (id, employeeId, clockIn, overrides = {}) => ({
  id,
  employeeId,
  clockIn,
  clockOut: undefined,
  breakMinutes: 0,
  ...overrides,
});

test('groups a single employee\'s job/drive/job/drive/clock-out day into one group', () => {
  // John clocks into a job, drives, drives again, works another job, then clocks out - six raw
  // entries for the same person on the same day should collapse into one group.
  const entries = [
    entry('6', 'john', '2026-08-31T16:00:00-04:00'),
    entry('5', 'john', '2026-08-31T14:30:00-04:00'),
    entry('4', 'john', '2026-08-31T13:00:00-04:00'),
    entry('3', 'john', '2026-08-31T11:00:00-04:00'),
    entry('2', 'john', '2026-08-31T10:00:00-04:00'),
    entry('1', 'john', '2026-08-31T08:00:00-04:00'),
  ];
  const groups = groupTimeEntriesByEmployeeDay(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].employeeId, 'john');
  assert.deepEqual(groups[0].entries.map((item) => item.id), ['6', '5', '4', '3', '2', '1']);
});

test('keeps different employees on the same day in separate groups', () => {
  const entries = [
    entry('john-1', 'john', '2026-08-31T09:00:00-04:00'),
    entry('sara-1', 'sara', '2026-08-31T09:00:00-04:00'),
  ];
  const groups = groupTimeEntriesByEmployeeDay(entries);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.employeeId), ['john', 'sara']);
});

test('keeps the same employee\'s different days in separate groups', () => {
  const entries = [
    entry('day-2', 'john', '2026-09-01T09:00:00-04:00'),
    entry('day-1', 'john', '2026-08-31T09:00:00-04:00'),
  ];
  const groups = groupTimeEntriesByEmployeeDay(entries);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.entries[0].id), ['day-2', 'day-1']);
});

test('groups by the entry\'s local calendar day, not a UTC day boundary', () => {
  // 11:58pm and 12:05am one week timezone offset apart, one minute short of local midnight in each
  // case in a UTC-4 offset - both entries stay on the same local calendar day (Aug 31).
  const lateNight = entry('late', 'john', '2026-08-31T23:58:00-04:00');
  const justAfterMidnight = entry('past-midnight', 'john', '2026-09-01T00:05:00-04:00');
  const sameDayGroups = groupTimeEntriesByEmployeeDay([justAfterMidnight, lateNight]);
  assert.equal(sameDayGroups.length, 2, 'a clock-in just after local midnight belongs to the next calendar day, not the previous one');
});

test('preserves newest-group-first order matching the input order', () => {
  const entries = [
    entry('newest', 'john', '2026-09-02T09:00:00-04:00'),
    entry('middle', 'sara', '2026-09-01T09:00:00-04:00'),
    entry('oldest', 'john', '2026-08-31T09:00:00-04:00'),
  ];
  const groups = groupTimeEntriesByEmployeeDay(entries);
  assert.deepEqual(groups.map((group) => group.entries[0].id), ['newest', 'middle', 'oldest']);
});

test('drops entries with an unparsable clockIn or a missing employeeId rather than mis-grouping them', () => {
  const entries = [
    entry('valid', 'john', '2026-08-31T09:00:00-04:00'),
    entry('bad-date', 'john', 'not-a-date'),
    { id: 'no-employee', clockIn: '2026-08-31T09:00:00-04:00' },
  ];
  const groups = groupTimeEntriesByEmployeeDay(entries);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].entries.map((item) => item.id), ['valid']);
});

test('an employee with only one entry that day is not grouped away from the plain single-entry row', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.match(reports, /if \(group\.entries\.length === 1\) return \[renderTimeEntryRow\(group\.entries\[0\], false\)\];/);
});

test('a multi-entry day renders a collapsible summary row that expands into the individual entries', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  const helperStart = reports.indexOf('const renderEmployeeDayRows');
  const helperEnd = reports.indexOf('return (\r\n    <div>');
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'expected to find renderEmployeeDayRows before the component return');
  const helper = reports.slice(helperStart, helperEnd);

  // Summary row toggles expansion (not the detail modal) and shows the entry count.
  assert.match(helper, /aria-expanded=\{isExpanded\}/);
  assert.match(helper, /onClick=\{\(\) => toggleEmployeeDayGroup\(group\.key\)\}/);
  assert.match(helper, /\(\{group\.entries\.length\}\)/);
  const summaryRowStart = helper.indexOf('const summaryRow = (');
  const summaryRowEnd = helper.indexOf('return isExpanded ?');
  assert.ok(summaryRowStart >= 0 && summaryRowEnd > summaryRowStart);
  assert.doesNotMatch(helper.slice(summaryRowStart, summaryRowEnd), /setSelectedTimeEntryId/, 'clicking the summary row must toggle the group, not open the detail modal directly');

  // Expanding renders every underlying entry as its own clickable row via renderTimeEntryRow.
  assert.match(helper, /return isExpanded \? \[summaryRow, \.\.\.group\.entries\.map\(\(entry\) => renderTimeEntryRow\(entry, true\)\)\] : \[summaryRow\];/);

  // The summary duration is the sum of every entry's duration in the group, not just one entry's.
  assert.match(helper, /group\.entries\.reduce\(\(sum, entry\) => sum \+ durationHours\(entry\.clockIn, entry\.clockOut, entry\.breakMinutes\), 0\)/);
  assert.match(helper, /formatTimeEntryDuration\(totalHours\)/);
});

test('Time Tracking groups entries by employee and day before rendering the table', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.match(reports, /import \{ formatTimeEntryDuration, getTimeEntryPresentation, groupTimeEntriesByEmployeeDay, sortTimeEntriesNewestFirst \} from '\.\.\/\.\.\/utils\/timeEntryPresentation\.js';/);
  assert.match(reports, /const groupedEntryRows = useMemo\(\(\) => groupTimeEntriesByEmployeeDay\(timeEntryPage\.items\), \[timeEntryPage\.items\]\);/);
});
