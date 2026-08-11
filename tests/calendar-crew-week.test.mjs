import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');
const week = readFileSync('src/components/calendar/CrewLaneWeekView.tsx', 'utf8');

test('Week uses fixed Crew lanes while Month and Day retain FullCalendar', () => {
  assert.match(page, /preferences\.view === 'week' \? \(/);
  assert.match(page, /<CrewLaneWeekView/);
  assert.match(page, /<FullCalendar/);
  assert.match(page, /month: 'dayGridMonth'/);
  assert.match(page, /day: 'timeGridDay'/);
  assert.match(week, /External \/ Google/);
  assert.match(week, /Unassigned/);
});

test('Crew Week renders continuous spans, today, quieter weekends, conflicts, and date-only drag', () => {
  assert.match(week, /buildWeeklyScheduleSpans/);
  assert.match(week, /gridColumn: `\$\{span\.startColumn\} \/ \$\{span\.endColumn \+ 1\}`/);
  assert.match(week, /isToday/);
  assert.match(week, /index > 4/);
  assert.match(week, /conflictJobIds/);
  assert.match(week, /application\/x-oliveops-job/);
  assert.match(page, /handleWeekShift/);
  assert.match(page, /addDays\(entry\.schedule\.start, dayDelta\)/);
  assert.doesNotMatch(week, />All day</);
});

test('Colour By affects event colour without changing Crew lane identity', () => {
  assert.match(week, /id: `crew:\$\{crew\.id\}`/);
  assert.match(week, /resolveScheduleColour\(\{ source: entry\.source, colourBy/);
});