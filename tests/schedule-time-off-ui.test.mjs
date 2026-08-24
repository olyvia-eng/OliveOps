import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const calendar = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');
const modal = readFileSync('src/components/calendar/ScheduleJobModal.tsx', 'utf8');
const week = readFileSync('src/components/calendar/CrewLaneWeekView.tsx', 'utf8');
const model = readFileSync('src/utils/employeeAvailability.js', 'utf8');
const handler = readFileSync('api/_lib/timeOffHandler.js', 'utf8');

test('Schedule range-loads canonical approved Time Off and refreshes it on focus', () => {
  assert.match(calendar, /action=schedule&startDate=\$\{startDate\}&endDate=\$\{endDate\}/);
  assert.match(calendar, /window\.addEventListener\('focus', refreshOnFocus\)/);
  assert.match(handler, /listApprovedTimeOffOverlappingForBusiness\(session\.businessId, startDate, endDate\)/);
  assert.doesNotMatch(handler.slice(handler.indexOf("action === 'schedule'"), handler.indexOf("action === 'detail'")), /employeeNote|reviewNote/);
});

test('approved Time Off renders as compact all-day events in month, week, and day architecture', () => {
  assert.match(calendar, /source: 'time_off'/);
  assert.match(calendar, /allDay: true/);
  assert.match(calendar, /exclusiveEndDateKey\(entry\.endKey\)/);
  assert.match(calendar, /editable: false/);
  assert.match(calendar, /timeGridDay/);
  assert.match(calendar, /dayGridMonth/);
  assert.match(week, /label: 'Time Off'/);
  assert.match(calendar, /Approved Time Off/);
  assert.match(calendar, /View Employee/);
});

test('employee availability remains selectable and recalculates when Schedule dates change', () => {
  assert.match(modal, /employeeAvailability/);
  assert.match(modal, /Unavailable/);
  assert.match(modal, /onClick=\{\(\) => toggleEmployee\(employee\.id\)\}/);
  assert.doesNotMatch(modal, /disabled=\{unavailable/);
  assert.match(modal, /\[form\.endDate, form\.startDate, open\]/);
});

test('one warning lists all direct and Crew-member conflicts before an explicit override', () => {
  assert.match(modal, /getEmployeeTimeOffConflicts/);
  assert.match(modal, /crewId: form\.crewId/);
  assert.match(modal, /timeOffConflicts\.map/);
  assert.match(modal, /Go Back/);
  assert.match(modal, /Schedule Anyway/);
  assert.match(modal, /if \(timeOffConflicts\.length > 0\)/);
  assert.match(modal, /setConfirmingTimeOff\(true\)/);
  assert.match(modal, /onClick=\{\(\) => void performSave\(\)\}/);
  assert.match(calendar, /pendingTimeOffOverride/);
  assert.match(calendar, /eventDrop\.revert\(\)/);
});

test('existing Job assignments are flagged but never automatically changed or deleted', () => {
  assert.match(calendar, /getJobTimeOffConflicts/);
  assert.match(calendar, /employee unavailable/);
  assert.match(calendar, /approved \{formatTimeOffType\(conflict\.requestType\)\}/);
  assert.doesNotMatch(model, /updateJob|deleteJob|assignedEmployeeIds\s*=/);
});