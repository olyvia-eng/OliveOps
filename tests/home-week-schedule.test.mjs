import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/home/PersonalHomeDashboard.tsx', 'utf8');
const personalCalendarSource = readFileSync('src/components/calendar/PersonalCalendar.tsx', 'utf8');
const tasksSource = readFileSync('src/pages/home/OutstandingTasks.tsx', 'utf8');
const sidebarSource = readFileSync('src/pages/home/PersonalDashboardSidebar.tsx', 'utf8');

test('Home answers what this user needs to do with a personal command center', () => {
  assert.match(source, /Good \{greeting\}/);
  assert.match(source, /Due Today/);
  assert.match(source, /Jobs This Week/);
  assert.match(source, /Hours Today/);
  assert.match(source, /<PersonalCalendar jobs=\{personalJobs\} tasks=\{personalTasks\}/);
  assert.match(personalCalendarSource, /initialView="timeGridWeek"/);
  assert.match(personalCalendarSource, /\['month', 'week', 'day'\]|VIEW_MAP/);
  assert.match(tasksSource, />Tasks</);
  assert.match(tasksSource, /Click again to rename/);
  assert.match(tasksSource, /value !== 'today'/);
  assert.match(tasksSource, /draggable/);
  assert.match(tasksSource, /onFilterOrderChange/);
  assert.match(tasksSource, /Hide \$\{task\.title\} from Today/);
  assert.match(sidebarSource, /Upcoming Schedule/);
});

test('personal calendar renders assigned jobs, due tasks, and private provider events', () => {
  assert.match(personalCalendarSource, /getJobScheduleWindow/);
  assert.match(personalCalendarSource, /task\.dueDate && task\.status === 'open'/);
  assert.match(personalCalendarSource, /externalEvents\.map/);
  assert.match(personalCalendarSource, /My Calendar legend/);
  assert.match(sidebarSource, /settings\/personal-calendar/);
});