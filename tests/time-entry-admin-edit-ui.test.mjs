import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('authoritative filtered Time Entries open the shared detail view', async () => {
  const [reports, detail] = await Promise.all([
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/components/time/TimeEntryDetailModal.tsx'),
  ]);
  const entries = reports.slice(reports.indexOf('<h2 className="font-semibold text-gray-800">Time Entries</h2>'), reports.indexOf('non-billable-breakdown-heading'));
  assert.match(entries, /filteredEntries\.map\(\(entry\)/);
  assert.match(entries, /setSelectedTimeEntryId\(entry\.id\)/);
  assert.match(entries, /role="button"/);
  assert.match(entries, /tabIndex=\{0\}/);
  assert.match(entries, /cursor-pointer/);
  assert.match(reports, /<TimeEntryDetailModal/);
  assert.match(detail, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(detail, /Edit Time Entry/);
  assert.match(detail, /<EditTimeEntryModal/);
});

test('shared detail shows Work Area snapshots and supports legacy entries without one', async () => {
  const detail = await source('../src/components/time/TimeEntryDetailModal.tsx');
  assert.match(detail, /getTimeEntryPresentation\(entry, jobs\)/);
  assert.match(detail, /presentation\?\.workAreaLabel \?/);
  assert.match(detail, />Work Area</);
  assert.doesNotMatch(detail, /Unknown Work Area/);
  for (const label of ['Employee', 'Date', 'Clock In', 'Clock Out', 'Duration', 'Activity', 'Job', 'Job Notes']) {
    assert.match(detail, new RegExp(`>${label}<`));
  }
});

test('unauthorized roles can inspect details but do not receive direct Edit', async () => {
  const detail = await source('../src/components/time/TimeEntryDetailModal.tsx');
  assert.match(detail, /const canEdit = currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(detail, /\{canEdit \? <Button[^]*Edit Time Entry[^]*: null\}/);
});

test('Employee and Job Time Entry views reuse the same shared detail component', async () => {
  const [employee, job] = await Promise.all([
    source('../src/pages/employees/EmployeeProfilePage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
  ]);
  for (const page of [employee, job]) {
    assert.match(page, /import TimeEntryDetailModal/);
    assert.match(page, /setSelectedTimeEntryId\(entry\.id\)/);
    assert.match(page, /<TimeEntryDetailModal/);
  }
  assert.doesNotMatch(employee, /import EditTimeEntryModal/);
  assert.doesNotMatch(job, /import EditTimeEntryModal/);
});

test('Edit Time Entry form exposes business fields but no internal or calculated fields', async () => {
  const modal = await source('../src/components/time/EditTimeEntryModal.tsx');
  assert.match(modal, /title="Edit Time Entry"/);
  assert.match(modal, /label="Clock In"/);
  assert.match(modal, /label="Clock Out"/);
  assert.match(modal, /label="Job"/);
  assert.match(modal, /label="Work Area"/);
  assert.match(modal, /label="Activity"/);
  assert.match(modal, /label="Notes"/);
  assert.match(modal, /Reason for change \(optional\)/);
  assert.match(modal, /Calculated duration/);
  assert.doesNotMatch(modal, /label="(?:Time Entry ID|Employee ID|Labour Cost|Revision)"/);
});

test('active edits cannot fabricate Clock Out and conflicts instruct reload', async () => {
  const modal = await source('../src/components/time/EditTimeEntryModal.tsx');
  assert.match(modal, /disabled=\{entry\.status === 'clocked_in'\}/);
  assert.match(modal, /clockOut: entry\.status === 'clocked_out' \? clockOutIso : undefined/);
  assert.match(modal, /time_entry_conflict/);
  assert.match(modal, /reload before trying again/);
});

test('web store applies only the authoritative edit response without optimistic mutation', async () => {
  const store = await source('../src/store/index.ts');
  const actionStart = store.lastIndexOf('editTimeEntry: async');
  const action = store.slice(actionStart, store.indexOf('addTimeEntry:', actionStart));
  assert.match(action, /method: 'PATCH'/);
  assert.match(action, /JSON\.stringify\(\{ entryId, \.\.\.payload \}\)/);
  assert.match(action, /body\.timeEntry/);
  assert.match(action, /state\.timeEntries\.map/);
  assert.doesNotMatch(action, /const previous/);
});

test('selected detail and newest-first tables derive from updated store entries by ID', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.match(reports, /selectedTimeEntry = effectiveTimeEntries\.find\(\(entry\) => entry\.id === selectedTimeEntryId\)/);
  assert.match(reports, /sortTimeEntriesNewestFirst\(effectiveTimeEntries\.filter/);
  assert.doesNotMatch(reports, /sort[^\n]*updatedAt|updatedAt[^\n]*sort/i);
});

test('reports and Job calculations consume updated Time Entry duration and labour snapshots', async () => {
  const [reports, jobDetail] = await Promise.all([
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
  ]);
  assert.match(reports, /durationHours\(entry\.clockIn, entry\.clockOut, entry\.breakMinutes\)/);
  assert.match(reports, /const employeeSummaryRows = useMemo/);
  assert.match(reports, /const totalsByType = useMemo/);
  assert.match(jobDetail, /calculateJobPerformance/);
  assert.match(jobDetail, /timeEntries,/);
  assert.match(jobDetail, /timeCorrections,/);
  assert.doesNotMatch(jobDetail, /trackedLaborCost|employee\.hourlyRate \*/);
});

test('Time Tracking uses one filtered table with responsive controls and compact empty states', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.match(reports, /title="Time Tracking"/);
  assert.match(reports, /sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7/);
  for (const label of ['Payroll Period', 'Start Date', 'End Date', 'Work Type', 'Job', 'Unbillable Category', 'Employee Search']) {
    assert.match(reports, new RegExp(`(?:label=|>)["']?${label}`));
  }
  assert.equal(reports.match(/filteredEntries\.map\(\(entry\)/g)?.length, 1);
  assert.doesNotMatch(reports, /Recent Time Entries|Time Entry Detail|No focused employee|No focused job|Showing \{/);
  assert.match(reports, /No entries match these filters/);
  assert.match(reports, /No non-billable time recorded for this period/);
  assert.match(reports, /min-w-\[900px\]/);
});

test('all report filters drive the authoritative table and Bookkeeper Export', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  const filtered = reports.slice(reports.indexOf('const filteredEntries'), reports.indexOf('const totalsByType'));
  for (const value of ['startDate', 'endDate', 'employeeSearchValue', 'jobFilter', 'unbillableCategoryFilter', 'workTypeFilter']) {
    assert.match(filtered, new RegExp(value));
  }
  const exportAction = reports.slice(reports.indexOf('const handleExportSummaryCsv'), reports.indexOf('return (', reports.indexOf('const handleExportSummaryCsv')));
  assert.match(exportAction, /employeeSummaryRows/);
  assert.match(exportAction, /filteredEntries\.length/);
  assert.match(reports, /Bookkeeper Export/);
});

test('correction requests retain review workflow under a status tab', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.match(reports, /role="tablist"/);
  assert.match(reports, />Time Entries</);
  assert.match(reports, /Correction Requests/);
  assert.match(reports, /pendingCorrectionCount/);
  assert.match(reports, /handleApproveCorrection/);
  assert.match(reports, /handleRejectCorrection/);
  assert.match(reports, /<option value="pending">Pending<\/option>/);
  assert.match(reports, /<option value="approved">Approved<\/option>/);
  assert.match(reports, /<option value="rejected">Denied<\/option>/);
  assert.match(reports, /item\.status === 'rejected' \? 'denied' : item\.status/);
});

test('normal Time Tracking UI contains no backfill or migration controls', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.doesNotMatch(reports, /backfill|migration/i);
});
