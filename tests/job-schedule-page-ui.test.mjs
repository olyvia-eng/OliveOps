import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Job schedule route fixes the Job identity and has no editable Job selector', async () => {
  const [app, page, editor] = await Promise.all([
    source('../src/App.tsx'),
    source('../src/pages/jobs/JobSchedulePage.tsx'),
    source('../src/components/calendar/JobScheduleEditor.tsx'),
  ]);
  assert.match(app, /path="jobs\/:id\/schedule"/);
  assert.match(page, /const \{ id \} = useParams/);
  assert.match(page, /<JobScheduleEditor/);
  assert.match(page, /job=\{job\}/);
  assert.match(page, /jobs=\{jobs\}/);
  assert.doesNotMatch(editor, /<Modal|presentation|fixedJob|initialJobId/);
  assert.match(page, /Back to Job/);
});

test('fixed Job schedule loads current values and displays immutable Job context', async () => {
  const editor = await source('../src/components/calendar/JobScheduleEditor.tsx');
  assert.match(editor, /formFromJob\(job, equipmentAssets\)/);
  assert.match(editor, /selectedJob\.jobNumber \?\? 'Not assigned'/);
  assert.match(editor, /selectedCustomer\?\.name \?\? 'Not assigned'/);
  assert.match(editor, /Current schedule/);
  assert.match(editor, /assignedEmployeeIds: \[\.\.\.\(job\.assignedEmployeeIds \?\? \[\]\)\]/);
  assert.match(editor, /getAssignedEquipmentForJob\(job, equipmentAssets\)/);
  assert.match(editor, /includeWeekends: job\.includeWeekends !== false/);
  assert.match(editor, /checked=\{form\.includeWeekends\}/);
  assert.match(editor, />\s*Include weekends\s*</);
});

test('weekend-only schedules are blocked without changing the selected date window', async () => {
  const editor = await source('../src/components/calendar/JobScheduleEditor.tsx');
  assert.match(editor, /getScheduleSegments\(draftScheduleWindow\)\.length === 0/);
  assert.match(editor, /This schedule does not contain any working days\./);
  assert.match(editor, /includeWeekends: form\.includeWeekends/);
  assert.match(editor, /Boolean\(scheduleValidationError\)/);
  assert.doesNotMatch(editor, /setForm[\s\S]{0,120}(nextMonday|addDays)/);
});

test('all schedule conflicts are grouped and require explicit confirmation', async () => {
  const editor = await source('../src/components/calendar/JobScheduleEditor.tsx');
  assert.match(editor, />Conflict Review</);
  for (const heading of ['Crew overlap warning', 'Employee overlap warning', 'Equipment conflict warning', 'Time Off']) assert.match(editor, new RegExp(heading));
  assert.match(editor, /timeOffConflicts\.length > 0 \|\| assignmentConflicts\.length > 0/);
  assert.match(editor, /Schedule Anyway/);
  assert.match(editor, /Go Back/);
});

test('schedule save is duplicate-safe and cannot mutate lifecycle status', async () => {
  const [editor, page, api] = await Promise.all([
    source('../src/components/calendar/JobScheduleEditor.tsx'),
    source('../src/pages/jobs/JobSchedulePage.tsx'),
    source('../api/job-schedule.js'),
  ]);
  assert.match(editor, /if \(!form\.startDate \|\| scheduleValidationError \|\| savingRef\.current\) return/);
  assert.match(editor, /savingRef\.current = true/);
  assert.match(editor, /finally \{[\s\S]*savingRef\.current = false/);
  assert.match(page, /updateJobSchedule\(jobId, schedule\)/);
  assert.doesNotMatch(page, /updateJob\(|status:/);
  const fields = api.slice(api.indexOf('const SCHEDULE_FIELDS'), api.indexOf(']);', api.indexOf('const SCHEDULE_FIELDS')));
  assert.doesNotMatch(fields, /status/);
  assert.match(fields, /includeWeekends/);
});

test('Job and Schedule entry points use one editor with context-aware return navigation', async () => {
  const [page, calendar] = await Promise.all([
    source('../src/pages/jobs/JobSchedulePage.tsx'),
    source('../src/pages/calendar/CalendarPage.tsx'),
  ]);
  assert.match(page, /title="Edit Job Schedule"/);
  assert.match(page, /fromSchedule \? 'Back to Schedule' : 'Back to Job'/);
  assert.match(page, /`\/jobs\/\$\{job\.id\}\?tab=project-management`/);
  assert.match(page, /`\/schedule\$\{returnParams\.size \? `\?\$\{returnParams\.toString\(\)\}` : ''\}`/);
  assert.match(calendar, /navigate\(`\/jobs\/\$\{jobId\}\/schedule\?from=schedule&calendarDate=\$\{calendarDate\}&calendarView=\$\{preferences\.view\}`\)/);
  assert.match(calendar, /onClick=\{\(\) => openScheduleEditor\(selectedEvent\.job\.id\)\}/);
  assert.doesNotMatch(calendar, /ScheduleJobModal|handleScheduleSave|scheduleOpen|scheduleJobId/);
});

test('schedule route keeps role authorization and uses tenant-safe API persistence', async () => {
  const [page, api] = await Promise.all([
    source('../src/pages/jobs/JobSchedulePage.tsx'),
    source('../api/job-schedule.js'),
  ]);
  assert.match(page, /currentUserRole === 'owner' \|\| currentUserRole === 'admin' \|\| currentUserRole === 'foreman'/);
  assert.match(page, /if \(!canManageSchedule\) return <Navigate/);
  assert.match(api, /getJobForBusiness\(session\.businessId, jobId\)/);
  assert.match(api, /updateJobForBusiness\(\{ businessId: session\.businessId/);
});
