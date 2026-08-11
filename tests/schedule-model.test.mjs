import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeeklyScheduleSpans,
  DEFAULT_CALENDAR_PREFERENCES,
  filterScheduleEntries,
  getEffectiveDivision,
  getScheduleLegend,
  groupScheduleEntriesByDay,
  normalizeGoogleScheduleEntry,
  normalizeCalendarPreferences,
  packWeeklyScheduleSpans,
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

test('weekly projection clips one continuous span instead of duplicating a multi-day job', () => {
  const spans = buildWeeklyScheduleSpans(
    [{ ...jobEntry, startKey: '2026-08-08', endKey: '2026-08-12' }],
    ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
  );
  assert.equal(spans.length, 1);
  assert.deepEqual({ startColumn: spans[0].startColumn, endColumn: spans[0].endColumn, columnSpan: spans[0].columnSpan }, {
    startColumn: 1,
    endColumn: 3,
    columnSpan: 3,
  });
});

test('Google all-day exclusive end dates normalize to the last occupied day', () => {
  const entry = normalizeGoogleScheduleEntry({
    googleEventId: 'google-a',
    googleCalendarId: 'calendar-a',
    title: 'Supplier delivery',
    start: '2026-08-12',
    end: '2026-08-14',
    allDay: true,
    location: '',
    status: 'confirmed',
    source: 'google',
  });
  assert.equal(entry.startKey, '2026-08-12');
  assert.equal(entry.endKey, '2026-08-13');
  assert.equal(entry.crew, null);
});

test('weekly spans pack overlaps into stable subrows', () => {
  const spans = buildWeeklyScheduleSpans([
    { ...jobEntry, jobId: 'job-a', startKey: '2026-08-10', endKey: '2026-08-12' },
    { ...jobEntry, jobId: 'job-b', startKey: '2026-08-11', endKey: '2026-08-13' },
    { ...jobEntry, jobId: 'job-c', startKey: '2026-08-13', endKey: '2026-08-14' },
  ], ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']);
  const packed = packWeeklyScheduleSpans(spans);
  assert.deepEqual(packed.map((span) => [span.entry.jobId, span.row]), [['job-a', 0], ['job-b', 1], ['job-c', 0]]);
});