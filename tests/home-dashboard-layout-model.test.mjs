import test from 'node:test';
import assert from 'node:assert/strict';
import { addHomeDashboardWidget, defaultHomeDashboardLayout, HOME_WIDGET_LAYOUT_SPECS, homeWidgetIdsFromLayout, normalizeHomeDashboardLayout } from '../src/pages/home/homeDashboardLayoutModel.js';

const overlaps = (left, right) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;

test('legacy widget order migrates to non-overlapping default geometry', () => {
  const ids = ['tasks', 'calendar', 'upcoming'];
  const layout = normalizeHomeDashboardLayout(undefined, ids);
  assert.deepEqual(homeWidgetIdsFromLayout(layout), ids);
  assert.equal(layout.some((item, index) => layout.slice(index + 1).some((other) => overlaps(item, other))), false);
});

test('saved geometry is clamped to widget minimums and grid bounds', () => {
  const [item] = normalizeHomeDashboardLayout([{ widgetId: 'calendar', x: 11, y: -2, width: 1, height: 1 }], ['calendar']);
  assert.equal(item.width, HOME_WIDGET_LAYOUT_SPECS.calendar.minWidth);
  assert.equal(item.height, HOME_WIDGET_LAYOUT_SPECS.calendar.minHeight);
  assert.equal(item.x + item.width <= 12, true);
  assert.equal(item.y, 0);
});

test('adding a widget uses default dimensions and the first non-overlapping space', () => {
  const initial = defaultHomeDashboardLayout(['tasks', 'calendar']);
  const next = addHomeDashboardWidget(initial, 'clocked-in-now');
  const added = next.find((item) => item.widgetId === 'clocked-in-now');
  assert.deepEqual({ width: added.width, height: added.height }, { width: HOME_WIDGET_LAYOUT_SPECS['clocked-in-now'].width, height: HOME_WIDGET_LAYOUT_SPECS['clocked-in-now'].height });
  assert.equal(next.filter((item) => item.widgetId !== added.widgetId).some((item) => overlaps(item, added)), false);
});
