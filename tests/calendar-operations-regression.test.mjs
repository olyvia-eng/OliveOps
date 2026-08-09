import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const calendarSource = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');
const jobDetailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const scheduleUtilsSource = readFileSync('src/utils/jobSchedule.ts', 'utf8');
const scheduleModalSource = readFileSync('src/components/calendar/ScheduleJobModal.tsx', 'utf8');
const estimateConversionSource = readFileSync('api/estimates.js', 'utf8');

const semverFamily = (versionRange) => {
  const match = String(versionRange).match(/(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : '';
};

test('fullcalendar dependencies stay in one compatible family', () => {
  const deps = packageJson.dependencies;
  const versions = {
    core: deps['@fullcalendar/core'],
    react: deps['@fullcalendar/react'],
    daygrid: deps['@fullcalendar/daygrid'],
    timegrid: deps['@fullcalendar/timegrid'],
    interaction: deps['@fullcalendar/interaction'],
  };

  const family = semverFamily(versions.core);
  assert.ok(family, 'fullcalendar core version must include major.minor');
  assert.equal(semverFamily(versions.react), family);
  assert.equal(semverFamily(versions.daygrid), family);
  assert.equal(semverFamily(versions.timegrid), family);
  assert.equal(semverFamily(versions.interaction), family);
});

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
  assert.match(calendarSource, /@fullcalendar\/react/);
  assert.match(calendarSource, /timeGridWeek/);
  assert.match(calendarSource, /timeGridDay/);
  assert.match(calendarSource, /eventDrop/);
  assert.match(calendarSource, /All Divisions/);
  assert.match(calendarSource, /All Jobs/);
  assert.match(calendarSource, /All Employees/);
  assert.match(calendarSource, /Schedule Job/);
  assert.match(calendarSource, /No work scheduled this month\./);
  assert.doesNotMatch(calendarSource, /View scheduled job start dates in a monthly calendar\./);
});

test('calendar events are built from canonical job scheduling fields and open details instead of direct navigation', () => {
  assert.match(calendarSource, /getJobScheduleWindow/);
  assert.match(calendarSource, /if \(!schedule\) return null;/);
  assert.match(calendarSource, /assignedEmployeeIds: selectedEvent\.job\.assignedEmployeeIds \?\? \[\],/);
  assert.match(calendarSource, /assignedEquipmentIds: selectedEvent\.job\.assignedEquipmentIds \?\? \[\],/);
  assert.match(calendarSource, /\(job\.assignedEmployeeIds \?\? \[\]\)\.includes\(employeeFilter\)/);
  assert.match(calendarSource, /\(job\.assignedEmployeeIds \?\? \[\]\)\.includes\(employee\.id\)/);
  assert.match(scheduleModalSource, /assignedEmployeeIds: \[\.\.\.\(job\.assignedEmployeeIds \?\? \[\]\)\],/);
  assert.match(scheduleUtilsSource, /scheduleConfirmed/);
  assert.match(scheduleUtilsSource, /scheduledStartAt/);
  assert.match(scheduleUtilsSource, /scheduledEndAt/);
  assert.match(scheduleUtilsSource, /getScheduleWindowFromValues/);
  assert.match(scheduleUtilsSource, /getJobAssignmentConflicts/);
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
  assert.match(scheduleModalSource, /Employee overlap warning/);
  assert.match(scheduleModalSource, /Equipment conflict warning/);
});

test('estimate conversion marks only explicit conversion schedules as confirmed', () => {
  assert.match(estimateConversionSource, /const hasExplicitSchedule = isNonEmptyString\(startDate\) \|\| isNonEmptyString\(endDate\);/);
  assert.match(estimateConversionSource, /scheduleConfirmed: hasExplicitSchedule/);
});
