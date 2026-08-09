import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const calendarSource = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');
const jobDetailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const scheduleUtilsSource = readFileSync('src/utils/jobSchedule.ts', 'utf8');
const scheduleModalSource = readFileSync('src/components/calendar/ScheduleJobModal.tsx', 'utf8');
const estimateConversionSource = readFileSync('api/estimates.js', 'utf8');

test('calendar route passes current user role into the operations calendar', () => {
  assert.match(appSource, /path="calendar"/);
  assert.match(appSource, /<CalendarPage currentUserRole=\{sessionUser\.role\} \/>/);
});

test('calendar uses operations scheduling language and month-first controls', () => {
  assert.match(calendarSource, /Schedule jobs, crews, equipment, and company events\./);
  assert.match(calendarSource, /Today/);
  assert.match(calendarSource, /Month/);
  assert.match(calendarSource, /Week/);
  assert.match(calendarSource, /Day/);
  assert.match(calendarSource, /All Divisions/);
  assert.match(calendarSource, /All Jobs/);
  assert.match(calendarSource, /All Employees/);
  assert.match(calendarSource, /Schedule Job/);
  assert.match(calendarSource, /No work scheduled this month\./);
  assert.doesNotMatch(calendarSource, /View scheduled job start dates in a monthly calendar\./);
});

test('calendar events are built from canonical job scheduling fields and open details instead of direct navigation', () => {
  assert.match(calendarSource, /getJobScheduleWindow/);
  assert.match(calendarSource, /getScheduledDayKeys/);
  assert.match(scheduleUtilsSource, /scheduleConfirmed/);
  assert.match(scheduleUtilsSource, /scheduledStartAt/);
  assert.match(scheduleUtilsSource, /scheduledEndAt/);
  assert.match(calendarSource, /Open Job/);
  assert.match(calendarSource, /Edit Schedule/);
  assert.doesNotMatch(calendarSource, /Link to=\{`\/jobs\/\$\{job\.id\}`\}/);
});

test('job detail page exposes the same schedule workflow and equipment context', () => {
  assert.match(jobDetailSource, /Schedule Job|Edit Schedule/);
  assert.match(jobDetailSource, /Schedule Status:/);
  assert.match(jobDetailSource, /Schedule Notes/);
  assert.match(jobDetailSource, /Assigned Equipment/);
  assert.match(jobDetailSource, /formatScheduleTimeLabel/);
  assert.match(scheduleModalSource, /Assigned Employees/);
  assert.match(scheduleModalSource, /Assigned Equipment/);
});

test('estimate conversion marks only explicit conversion schedules as confirmed', () => {
  assert.match(estimateConversionSource, /const hasExplicitSchedule = isNonEmptyString\(startDate\) \|\| isNonEmptyString\(endDate\);/);
  assert.match(estimateConversionSource, /scheduleConfirmed: hasExplicitSchedule/);
});
