import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Time Reports exposes Edit Time Entry only to Owner and Admin', async () => {
  const reports = await source('../src/pages/reports/TimeReportsPage.tsx');
  assert.match(reports, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(reports, /setEditingTimeEntry\(entry\)/);
  assert.match(reports, /<EditTimeEntryModal/);
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
