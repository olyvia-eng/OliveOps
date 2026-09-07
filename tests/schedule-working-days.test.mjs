import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getScheduleDateKeys,
  getScheduleDateSegments,
  isScheduleDateIncluded,
  scheduleDateRangesOverlap,
  scheduleHasWorkingDays,
  scheduleIncludesWeekends,
} from '../src/utils/scheduleWorkingDays.js';

test('legacy schedules default to including weekends', () => {
  const legacy = { startDate: '2026-09-04', endDate: '2026-09-07' };
  assert.equal(scheduleIncludesWeekends(legacy), true);
  assert.deepEqual(getScheduleDateKeys(legacy), ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']);
});

test('weekday schedules exclude Saturday and Sunday and resume Monday', () => {
  const schedule = { startDate: '2026-09-01', endDate: '2026-09-14', includeWeekends: false };
  assert.equal(isScheduleDateIncluded(schedule, '2026-09-05'), false);
  assert.equal(isScheduleDateIncluded(schedule, '2026-09-06'), false);
  assert.equal(isScheduleDateIncluded(schedule, '2026-09-07'), true);
  assert.deepEqual(getScheduleDateSegments(schedule), [
    { startKey: '2026-09-01', endKey: '2026-09-04' },
    { startKey: '2026-09-07', endKey: '2026-09-11' },
    { startKey: '2026-09-14', endKey: '2026-09-14' },
  ]);
});

test('weekend-only schedules have no working days when weekends are excluded', () => {
  assert.equal(scheduleHasWorkingDays({ startDate: '2026-09-05', endDate: '2026-09-06', includeWeekends: false }), false);
  assert.equal(scheduleHasWorkingDays({ startDate: '2026-09-05', endDate: '2026-09-05', includeWeekends: true }), true);
});

test('single weekdays and weekend date boundaries preserve the selected overall window', () => {
  assert.deepEqual(getScheduleDateKeys({ startDate: '2026-09-07', endDate: '2026-09-07', includeWeekends: false }), ['2026-09-07']);
  assert.deepEqual(getScheduleDateKeys({ startDate: '2026-09-05', endDate: '2026-09-07', includeWeekends: false }), ['2026-09-07']);
  assert.deepEqual(getScheduleDateKeys({ startDate: '2026-09-04', endDate: '2026-09-06', includeWeekends: false }), ['2026-09-04']);
});

test('turning weekends back on restores Saturday and Sunday', () => {
  const schedule = { startDate: '2026-09-04', endDate: '2026-09-07', includeWeekends: false };
  assert.deepEqual(getScheduleDateKeys(schedule), ['2026-09-04', '2026-09-07']);
  assert.deepEqual(getScheduleDateKeys({ ...schedule, includeWeekends: true }), ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']);
});

test('schedule overlap ignores excluded weekends but retains weekday conflicts', () => {
  const weekdaysOnly = { startDate: '2026-09-01', endDate: '2026-09-14', includeWeekends: false };
  assert.equal(scheduleDateRangesOverlap(weekdaysOnly, { startDate: '2026-09-05', endDate: '2026-09-05' }), false);
  assert.equal(scheduleDateRangesOverlap(weekdaysOnly, { startDate: '2026-09-07', endDate: '2026-09-07' }), true);
});