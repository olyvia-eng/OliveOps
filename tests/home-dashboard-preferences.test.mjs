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
  assert.deepEqual(normalizeHomeDashboardPreferences({ widgetIds: ['tasks', 'unknown', 'calendar', 'tasks'] }, 'admin'), { widgetIds: ['tasks', 'calendar'] });
});

test('task filter labels and dismissed Today tasks are normalized per user', () => {
  assert.deepEqual(normalizeHomeDashboardPreferences({
    widgetIds: ['tasks'],
    taskFilterLabels: { all: 'To do', today: 'Now', unknown: 'Nope', overdue: '   ' },
    dismissedTodayTaskIds: ['task-1', 'task-1', '', 42],
  }, 'admin'), {
    widgetIds: ['tasks'],
    taskFilterLabels: { all: 'To do', today: 'Now' },
    dismissedTodayTaskIds: ['task-1'],
  });
});
