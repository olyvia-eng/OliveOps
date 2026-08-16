import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FINANCE_HOME_WIDGET_IDS,
  PERSONAL_HOME_WIDGET_IDS,
  allowedHomeWidgetIds,
  normalizeHomeDashboardPreferences,
} from '../api/_lib/homeDashboardPreferences.js';

const apiSource = readFileSync('api/home-dashboard-preferences.js', 'utf8');

test('Home widget preferences are session-owned and business-scoped', () => {
  assert.match(apiSource, /requireSession\(req, res\)/);
  assert.match(apiSource, /businessId: session\.businessId/);
  assert.match(apiSource, /userId: session\.id/);
  assert.doesNotMatch(apiSource, /req\.(body|query).*userId/);
});

test('field roles cannot persist Finance widgets', () => {
  const requested = [...PERSONAL_HOME_WIDGET_IDS, ...FINANCE_HOME_WIDGET_IDS];
  assert.deepEqual(normalizeHomeDashboardPreferences({ widgetIds: requested }, 'crew_member').widgetIds, PERSONAL_HOME_WIDGET_IDS);
  assert.deepEqual(normalizeHomeDashboardPreferences({ widgetIds: requested }, 'foreman').widgetIds, PERSONAL_HOME_WIDGET_IDS);
  assert.deepEqual(allowedHomeWidgetIds('owner'), requested);
});

test('widget preferences remove unknown and duplicate ids while preserving order', () => {
  assert.deepEqual(normalizeHomeDashboardPreferences({ widgetIds: ['tasks', 'unknown', 'calendar', 'tasks'] }, 'admin'), {
    widgetIds: ['tasks', 'calendar'],
    taskFilterOrder: ['all', 'today', 'overdue', 'week', 'completed'],
  });
});

test('task filter labels and dismissed Today tasks are normalized per user', () => {
  assert.deepEqual(normalizeHomeDashboardPreferences({
    widgetIds: ['tasks'],
    taskFilterLabels: { all: 'To do', today: 'Now', unknown: 'Nope', overdue: '   ' },
    taskFilterOrder: ['completed', 'today', 'all', 'completed', 'unknown'],
    dismissedTodayTaskIds: ['task-1', 'task-1', '', 42],
  }, 'admin'), {
    widgetIds: ['tasks'],
    taskFilterLabels: { all: 'To do' },
    taskFilterOrder: ['completed', 'today', 'all', 'overdue', 'week'],
    dismissedTodayTaskIds: ['task-1'],
  });
});

test('custom task tabs keep stable ids, unique names, and persisted mixed ordering', () => {
  const preferences = normalizeHomeDashboardPreferences({
    widgetIds: ['tasks'],
    customTaskTabs: [
      { id: 'task-tab-follow-up-1', name: ' Follow Ups ', createdAt: '2026-08-16T00:00:00.000Z' },
      { id: 'task-tab-purchasing-1', name: 'Purchasing', createdAt: '2026-08-16T00:00:00.000Z' },
      { id: 'task-tab-duplicate-1', name: 'follow ups', createdAt: '2026-08-16T00:00:00.000Z' },
      { id: 'invalid', name: 'Invalid', createdAt: '2026-08-16T00:00:00.000Z' },
    ],
    taskFilterOrder: ['task-tab-purchasing-1', 'today', 'task-tab-follow-up-1'],
  }, 'admin');
  assert.deepEqual(preferences.customTaskTabs, [
    { id: 'task-tab-follow-up-1', name: 'Follow Ups', sortOrder: 0, createdAt: '2026-08-16T00:00:00.000Z' },
    { id: 'task-tab-purchasing-1', name: 'Purchasing', sortOrder: 1, createdAt: '2026-08-16T00:00:00.000Z' },
  ]);
  assert.deepEqual(preferences.taskFilterOrder, ['task-tab-purchasing-1', 'today', 'task-tab-follow-up-1', 'all', 'overdue', 'week', 'completed']);
});

test('custom tab deletion cleanup is session-owned and never deletes tasks', () => {
  assert.match(apiSource, /task\.assignedUserId === session\.id && task\.taskTabId === deletedTaskTabId/);
  assert.match(apiSource, /delete next\.taskTabId/);
  assert.doesNotMatch(apiSource, /deleteTaskForBusiness/);
});
