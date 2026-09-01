import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Owner and Admin can open Recent Time Entries through the shared detail view', async () => {
  const [reports, detail] = await Promise.all([
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/components/time/TimeEntryDetailModal.tsx'),
  ]);
  const recent = reports.slice(reports.indexOf('Recent Time Entries'), reports.indexOf('Hours by Employee'));
  assert.match(recent, /setSelectedTimeEntryId\(entry\.id\)/);
  assert.match(recent, /role="button"/);
  assert.match(recent, /tabIndex=\{0\}/);
  assert.match(recent, /cursor-pointer/);
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
  assert.match(reports, /sortTimeEntriesNewestFirst\(effectiveTimeEntries\)\.slice\(0, 20\)/);
  assert.match(reports, /\[effectiveTimeEntries\]/);
});

test('reports and Job totals consume updated Time Entry duration and labour snapshots', async () => {
  const [reports, jobDetail] = await Promise.all([
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
  ]);
  assert.match(reports, /durationHours\(entry\.clockIn, entry\.clockOut, entry\.breakMinutes\)/);
  assert.match(reports, /const employeeTotals = useMemo/);
  assert.match(reports, /const jobTotals = useMemo/);
  assert.match(jobDetail, /trackedLaborCost/);
});
