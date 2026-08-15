import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/home/HomePage.tsx', 'utf8');
const personalCalendarSource = readFileSync('src/components/calendar/PersonalCalendar.tsx', 'utf8');

test('Home answers what this user needs to do with a calendar-first view', () => {
  assert.match(source, /title="My Calendar"/);
  assert.match(source, /<PersonalCalendar jobs=\{jobs\} tasks=\{myTasks\}/);
  assert.match(personalCalendarSource, /initialView="timeGridWeek"/);
  assert.match(personalCalendarSource, /\['month', 'week', 'day'\]|VIEW_MAP/);
  assert.match(source, /My Tasks/);
});

test('personal calendar renders assigned jobs, due tasks, and private provider events', () => {
  assert.match(personalCalendarSource, /getJobScheduleWindow/);
  assert.match(personalCalendarSource, /task\.dueDate && task\.status === 'open'/);
  assert.match(personalCalendarSource, /externalEvents\.map/);
  assert.match(personalCalendarSource, /Calendar connections/);
});