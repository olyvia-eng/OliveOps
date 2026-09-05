import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Job schedule route fixes the Job identity and has no editable Job selector', async () => {
  const [app, page, form] = await Promise.all([
    source('../src/App.tsx'),
    source('../src/pages/jobs/JobSchedulePage.tsx'),
    source('../src/components/calendar/ScheduleJobModal.tsx'),
  ]);
  assert.match(app, /path="jobs\/:id\/schedule"/);
  assert.match(page, /const \{ id \} = useParams/);
  assert.match(page, /jobs=\{\[job\]\}/);
  assert.match(page, /initialJobId=\{job\.id\}/);
  assert.match(page, /fixedJob/);
  assert.match(form, /!fixedJob \? <div className="sm:col-span-2">/);
  assert.match(page, /Back to Job/);
});

test('fixed Job schedule loads current values and displays immutable Job context', async () => {
  const form = await source('../src/components/calendar/ScheduleJobModal.tsx');
  assert.match(form, /formFromJob\(selected, equipmentAssets\)/);
  assert.match(form, /selectedJob\.jobNumber \?\? 'Not assigned'/);
  assert.match(form, /selectedCustomer\?\.name \?\? 'Not assigned'/);
  assert.match(form, /Current schedule/);
  assert.match(form, /assignedEmployeeIds: \[\.\.\.\(job\.assignedEmployeeIds \?\? \[\]\)\]/);
  assert.match(form, /getAssignedEquipmentForJob\(job, equipmentAssets\)/);
});

test('all schedule conflicts are grouped and require explicit confirmation', async () => {
  const form = await source('../src/components/calendar/ScheduleJobModal.tsx');
  assert.match(form, />Conflict Review</);
  for (const heading of ['Crew overlap warning', 'Employee overlap warning', 'Equipment conflict warning', 'Time Off']) assert.match(form, new RegExp(heading));
  assert.match(form, /timeOffConflicts\.length > 0 \|\| assignmentConflicts\.length > 0/);
  assert.match(form, /Schedule Anyway/);
  assert.match(form, /Go Back/);
});

test('schedule save is duplicate-safe and cannot mutate lifecycle status', async () => {
  const [form, page, api] = await Promise.all([
    source('../src/components/calendar/ScheduleJobModal.tsx'),
    source('../src/pages/jobs/JobSchedulePage.tsx'),
    source('../api/job-schedule.js'),
  ]);
  assert.match(form, /if \(!selectedJob \|\| !form\.startDate \|\| savingRef\.current\) return/);
  assert.match(form, /savingRef\.current = true/);
  assert.match(form, /finally \{[\s\S]*savingRef\.current = false/);
  assert.match(page, /updateJobSchedule\(jobId, schedule\)/);
  assert.doesNotMatch(page, /updateJob\(|status:/);
  const fields = api.slice(api.indexOf('const SCHEDULE_FIELDS'), api.indexOf(']);', api.indexOf('const SCHEDULE_FIELDS')));
  assert.doesNotMatch(fields, /status/);
});
