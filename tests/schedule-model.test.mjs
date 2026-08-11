import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CALENDAR_PREFERENCES,
  filterScheduleEntries,
  getEffectiveDivision,
  getScheduleLegend,
  groupScheduleEntriesByDay,
  normalizeCalendarPreferences,
  resolveScheduleColour,
} from '../src/utils/scheduleModel.js';

const crew = { id: 'crew-a', name: 'Crew A', colour: '#0f766e' };
const division = { id: 'division-a', name: 'Landscaping', normalizedName: 'landscaping', colour: '#15803d' };
const jobEntry = {
  source: 'oliveops', jobId: 'job-a', status: 'scheduled', startKey: '2026-08-10', endKey: '2026-08-12',
  crew, division, employeeIds: ['employee-a'], equipmentIds: ['equipment-a'],
};
const googleEntry = {
  source: 'google', status: 'confirmed', startKey: '2026-08-11', endKey: '2026-08-11',
  crew: null, division: null, employeeIds: [], equipmentIds: [],
};

test('calendar preferences default to week, crew colours, and Google events', () => {
  assert.deepEqual(normalizeCalendarPreferences(null), DEFAULT_CALENDAR_PREFERENCES);
  assert.deepEqual(normalizeCalendarPreferences({ view: 'day', colourBy: 'division', showGoogleEvents: false }), {
    view: 'day', colourBy: 'division', showGoogleEvents: false,
  });
});

test('division resolution prefers stable job id and falls back to budget free text', () => {
  const budgets = [{ id: 'budget-a', division: 'Landscaping' }];
  assert.equal(getEffectiveDivision({ divisionId: 'division-a' }, [division], budgets)?.id, 'division-a');
  assert.equal(getEffectiveDivision({ pricingBudgetId: 'budget-a' }, [], budgets)?.id, 'legacy:landscaping');
});

test('colour resolution has one meaning and Google remains neutral', () => {
  assert.equal(resolveScheduleColour({ colourBy: 'crew', job: { status: 'on_hold' }, crew, division }).value, crew.colour);
  assert.equal(resolveScheduleColour({ colourBy: 'division', job: { status: 'on_hold' }, crew, division }).value, division.colour);
  assert.notEqual(resolveScheduleColour({ source: 'google', colourBy: 'crew', crew }).value, crew.colour);
});

test('OliveOps filters combine while Google only follows its visibility toggle', () => {
  assert.deepEqual(filterScheduleEntries([jobEntry, googleEntry], {
    divisionId: 'division-a', resourceId: 'crew:crew-a', jobId: 'job-a', equipmentId: 'equipment-a', showGoogleEvents: true,
  }), [jobEntry, googleEntry]);
  assert.deepEqual(filterScheduleEntries([jobEntry, googleEntry], {
    divisionId: 'other', resourceId: 'crew:crew-a', showGoogleEvents: false,
  }), []);
});

test('legend includes relevant values and neutral unassigned crew', () => {
  const legend = getScheduleLegend([jobEntry, { ...jobEntry, jobId: 'job-b', crew: null }], 'crew');
  assert.deepEqual(legend.map((item) => item.label), ['Crew A', 'Unassigned']);
});

test('multi-day entries appear on every applicable weekly day', () => {
  const grouped = groupScheduleEntriesByDay([jobEntry], ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']);
  assert.deepEqual(grouped.map((day) => day.entries.length), [1, 1, 1, 0]);
});