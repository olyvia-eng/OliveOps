import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecentActivity,
  buildUpcomingItems,
  filterTasksByRange,
  getHoursLoggedToday,
  getJobsThisWeek,
  getPersonalJobs,
  getTaskSummary,
  getRootTasks,
  resolveSessionEmployee,
  taskCreationDefaults,
} from '../src/pages/home/homeDashboardModel.js';

const now = new Date(2026, 7, 12, 12, 0, 0);
const task = (id, dueDate, priority = 'normal', status = 'open') => ({ id, title: id, dueDate, priority, status, assignedUserId: 'user-1', createdByUserId: 'user-1', createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-12T10:00:00Z' });

test('dashboard task summaries and tabs use local due-date boundaries', () => {
  const tasks = [task('today-high', '2026-08-12', 'high'), task('today-low', '2026-08-12', 'low'), task('overdue', '2026-08-11'), task('week', '2026-08-16'), task('later', '2026-08-20'), task('done', '2026-08-12', 'normal', 'completed')];
  assert.deepEqual(getTaskSummary(tasks, now), { dueToday: 2, highPriorityDueToday: 1, overdue: 1 });
  assert.deepEqual(filterTasksByRange(tasks, 'today', now).map((item) => item.id), ['today-high', 'today-low']);
  assert.deepEqual(filterTasksByRange(tasks, 'overdue', now).map((item) => item.id), ['overdue']);
  assert.deepEqual(filterTasksByRange(tasks, 'week', now).map((item) => item.id), ['today-high', 'today-low', 'overdue', 'week']);
  assert.deepEqual(filterTasksByRange(tasks, 'completed', now).map((item) => item.id), ['done']);
});

test('root tasks keep subtasks out of top-level dashboard counts and schedules', () => {
  const parent = task('parent', '2026-08-12');
  const child = { ...task('child', '2026-08-11'), parentTaskId: parent.id };
  assert.deepEqual(getRootTasks([parent, child]).map((item) => item.id), ['parent']);
  assert.deepEqual(getTaskSummary(getRootTasks([parent, child]), now), { dueToday: 1, highPriorityDueToday: 0, overdue: 0 });
});

test('custom task tabs are additive categories while system views stay computed', () => {
  const followUpToday = { ...task('follow-up-today', '2026-08-12'), taskTabId: 'task-tab-follow-up' };
  const followUpLater = { ...task('follow-up-later', '2026-08-20'), taskTabId: 'task-tab-follow-up' };
  const done = { ...task('follow-up-done', '2026-08-12', 'normal', 'completed'), taskTabId: 'task-tab-follow-up' };
  const tasks = [followUpToday, followUpLater, done];
  assert.deepEqual(filterTasksByRange(tasks, 'task-tab-follow-up', now).map((item) => item.id), ['follow-up-today', 'follow-up-later', 'follow-up-done']);
  assert.deepEqual(filterTasksByRange(tasks, 'all', now).map((item) => item.id), ['follow-up-today', 'follow-up-later']);
  assert.deepEqual(filterTasksByRange(tasks, 'today', now).map((item) => item.id), ['follow-up-today']);
  assert.deepEqual(filterTasksByRange(tasks, 'completed', now).map((item) => item.id), ['follow-up-done']);
});

test('task creation defaults use custom category context but never persist system views', () => {
  const tabs = [{ id: 'task-tab-follow-up', name: 'Follow Ups' }];
  assert.deepEqual(taskCreationDefaults('task-tab-follow-up', tabs, now), { dueDate: '', taskTabId: 'task-tab-follow-up', status: 'open' });
  assert.deepEqual(taskCreationDefaults('today', tabs, now), { dueDate: '2026-08-12', taskTabId: '', status: 'open' });
  assert.deepEqual(taskCreationDefaults('completed', tabs, now), { dueDate: '', taskTabId: '', status: 'open' });
});

test('personal jobs include direct and active crew work only', () => {
  const jobs = [
    { id: 'direct', assignedEmployeeIds: ['emp-1'] },
    { id: 'member', assignedEmployeeIds: [], crewId: 'crew-member' },
    { id: 'lead', assignedEmployeeIds: [], crewId: 'crew-lead' },
    { id: 'inactive', assignedEmployeeIds: [], crewId: 'crew-inactive' },
    { id: 'other', assignedEmployeeIds: [], crewId: 'crew-other' },
  ];
  const crews = [
    { id: 'crew-member', active: true, leadEmployeeId: 'emp-2', memberIds: ['emp-1'] },
    { id: 'crew-lead', active: true, leadEmployeeId: 'emp-1', memberIds: [] },
    { id: 'crew-inactive', active: false, leadEmployeeId: 'emp-1', memberIds: ['emp-1'] },
    { id: 'crew-other', active: true, leadEmployeeId: 'emp-2', memberIds: ['emp-2'] },
  ];
  assert.deepEqual(getPersonalJobs({ jobs, crews, employeeId: 'emp-1' }).map((job) => job.id), ['direct', 'member', 'lead']);
  assert.deepEqual(getPersonalJobs({ jobs, crews }), []);
});

test('employee identity prefers user linkage and falls back to normalized email', () => {
  const employees = [
    { id: 'emp-email', active: true, userId: null, email: 'user@example.com' },
    { id: 'emp-linked', active: true, userId: 'user-1', email: 'other@example.com' },
  ];
  assert.equal(resolveSessionEmployee({ employees, userId: 'user-1', email: 'user@example.com' }).id, 'emp-linked');
  assert.equal(resolveSessionEmployee({ employees, userId: 'legacy', email: ' USER@example.com ' }).id, 'emp-email');
});

test('today hours clip intervals and include an active entry without inventing a goal', () => {
  const entries = [
    { id: 'overnight', employeeId: 'emp-1', clockIn: '2026-08-11T23:00:00', clockOut: '2026-08-12T02:00:00', breakMinutes: 0 },
    { id: 'morning', employeeId: 'emp-1', clockIn: '2026-08-12T08:00:00', clockOut: '2026-08-12T10:30:00', breakMinutes: 30 },
    { id: 'active', employeeId: 'emp-1', clockIn: '2026-08-12T11:00:00', breakMinutes: 0 },
    { id: 'other', employeeId: 'emp-2', clockIn: '2026-08-12T08:00:00', clockOut: '2026-08-12T12:00:00', breakMinutes: 0 },
  ];
  assert.equal(getHoursLoggedToday(entries, 'emp-1', now), 5);
});

test('weekly jobs intersect the current Monday-Sunday window', () => {
  const jobs = [
    { id: 'inside', status: 'scheduled', startDate: '2026-08-12', endDate: '2026-08-12' },
    { id: 'spans', status: 'in_progress', startDate: '2026-08-08', endDate: '2026-08-11' },
    { id: 'later', status: 'scheduled', startDate: '2026-08-20', endDate: '2026-08-20' },
  ];
  assert.deepEqual(getJobsThisWeek(jobs, now).map((job) => job.id), ['inside', 'spans']);
});

test('upcoming and activity streams use only supplied personal records', () => {
  const upcoming = buildUpcomingItems({
    jobs: [{ id: 'job-1', title: 'Assigned job', status: 'scheduled', customerId: 'client-1', scheduledStartAt: '2026-08-12T14:00:00', scheduledEndAt: '2026-08-12T16:00:00' }],
    tasks: [task('task-1', '2026-08-13')],
    externalEvents: [{ provider: 'google', externalEventId: 'event-1', title: 'Meeting', start: '2026-08-12T13:00:00', end: '2026-08-12T13:30:00', allDay: false }],
    now,
  });
  assert.deepEqual(upcoming.map((item) => item.title), ['Meeting', 'Assigned job', 'task-1']);

  const activity = buildRecentActivity({
    tasks: [task('mine', '2026-08-12')],
    jobs: [{ id: 'job-1', title: 'Assigned job', updatedAt: '2026-08-12T09:00:00Z' }],
    timeEntries: [{ id: 'time-1', employeeId: 'emp-1', status: 'clocked_out', clockIn: '2026-08-12T07:00:00Z', clockOut: '2026-08-12T08:00:00Z' }, { id: 'other', employeeId: 'emp-2', status: 'clocked_out', clockIn: '2026-08-12T11:00:00Z' }],
    employeeId: 'emp-1',
  });
  assert.equal(activity.some((item) => item.id === 'time:other'), false);
  assert.equal(activity.length, 3);
});

test('recent activity keeps active time first and orders historical shifts by clock-in', () => {
  const activity = buildRecentActivity({
    timeEntries: [
      { id: 'older-edited', employeeId: 'emp-1', status: 'clocked_out', clockIn: '2026-08-29T09:00:00Z', clockOut: '2026-08-31T18:00:00Z' },
      { id: 'newer', employeeId: 'emp-1', status: 'clocked_out', clockIn: '2026-08-30T09:00:00Z', clockOut: '2026-08-30T17:00:00Z' },
      { id: 'active', employeeId: 'emp-1', status: 'clocked_in', clockIn: '2026-08-28T09:00:00Z' },
    ],
    employeeId: 'emp-1',
  });

  assert.deepEqual(activity.map((item) => item.id), ['time:active', 'time:newer', 'time:older-edited']);
});
