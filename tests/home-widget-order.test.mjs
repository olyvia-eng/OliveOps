import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderHomeWidgetIds } from '../src/pages/home/homeWidgetOrderModel.js';

test('drag reorder moves only the handled widget to the drop target', () => {
  const initial = ['due-today', 'clocked-in-now', 'calendar', 'tasks'];
  assert.deepEqual(reorderHomeWidgetIds(initial, 'tasks', 'clocked-in-now'), ['due-today', 'tasks', 'clocked-in-now', 'calendar']);
  assert.deepEqual(initial, ['due-today', 'clocked-in-now', 'calendar', 'tasks']);
});

test('invalid and same-target drops preserve widget order', () => {
  const initial = ['due-today', 'clocked-in-now', 'calendar'];
  assert.deepEqual(reorderHomeWidgetIds(initial, 'calendar', 'calendar'), initial);
  assert.deepEqual(reorderHomeWidgetIds(initial, 'unknown', 'calendar'), initial);
});