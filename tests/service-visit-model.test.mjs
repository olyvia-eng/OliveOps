import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedServiceVisits, generateServiceOccurrenceDates, resolveVisitBillingStatus, serviceVisitOccurrenceKey, synchronizeServiceVisits, validateVisitStatusTransition } from '../src/utils/serviceVisitModel.js';

const recurring = (overrides = {}) => ({ id: 'service-1', scheduleType: 'recurring', billingType: 'contract', startDate: '2027-03-01', endDate: '2027-03-31', frequency: { interval: 1, unit: 'week' }, operationalSchedule: { preferredWeekdays: [4], startTime: '08:00', durationMinutes: 90 }, ...overrides });

test('weekly recurrence uses preferred weekdays, date bounds, and local wall-clock time across DST', () => {
  const service = recurring();
  assert.deepEqual(generateServiceOccurrenceDates(service), ['2027-03-04', '2027-03-11', '2027-03-18', '2027-03-25']);
  const visits = buildGeneratedServiceVisits({ businessId: 'business-1', job: { id: 'job-1' }, service, now: '2027-02-01T00:00:00.000Z' });
  assert.deepEqual(visits.map((visit) => visit.scheduledStartAt), ['2027-03-04T08:00:00', '2027-03-11T08:00:00', '2027-03-18T08:00:00', '2027-03-25T08:00:00']);
  assert.equal(visits[0].scheduledEndAt, '2027-03-04T09:30:00');
  assert.equal(visits[0].recurrenceKey, serviceVisitOccurrenceKey('job-1', 'service-1', '2027-03-04'));
});

test('weekly recurrence supports multiple weekdays and every-two-week cadence', () => {
  assert.deepEqual(generateServiceOccurrenceDates(recurring({ endDate: '2027-03-21', frequency: { interval: 2, unit: 'week' }, operationalSchedule: { preferredWeekdays: [1, 3, 5] } })), ['2027-03-01', '2027-03-03', '2027-03-05', '2027-03-15', '2027-03-17', '2027-03-19']);
});

test('daily and monthly recurrence are bounded and month-end clamps deterministically', () => {
  assert.deepEqual(generateServiceOccurrenceDates(recurring({ startDate: '2027-01-30', endDate: '2027-02-03', frequency: { interval: 2, unit: 'day' }, operationalSchedule: {} })), ['2027-01-30', '2027-02-01', '2027-02-03']);
  assert.deepEqual(generateServiceOccurrenceDates(recurring({ startDate: '2027-01-31', endDate: '2027-04-30', frequency: { interval: 1, unit: 'month' }, operationalSchedule: { monthlyDay: 31 } })), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
});

test('one-time creates one Visit and as-needed creates none regardless of estimatedVisits', () => {
  assert.deepEqual(generateServiceOccurrenceDates({ ...recurring(), scheduleType: 'one_time', startDate: '2027-05-02' }), ['2027-05-02']);
  assert.deepEqual(generateServiceOccurrenceDates({ ...recurring(), scheduleType: 'as_needed', estimatedVisits: 12 }), []);
});

test('sync is idempotent and preserves moved exceptions and historical outcomes', () => {
  const generated = buildGeneratedServiceVisits({ businessId: 'business-1', job: { id: 'job-1' }, service: recurring(), now: '2027-02-01T00:00:00.000Z' });
  assert.equal(synchronizeServiceVisits(generated, generated, '2027-03-01').create.length, 0);
  const moved = { ...generated[1], scheduledDate: '2027-03-12', scheduledStartAt: '2027-03-12T08:00:00', isSeriesException: true };
  const completed = { ...generated[0], status: 'completed' };
  const skipped = { ...generated[2], status: 'skipped' };
  const cancelled = { ...generated[3], status: 'cancelled' };
  const sync = synchronizeServiceVisits([moved, completed, skipped, cancelled], generated, '2027-03-01');
  assert.equal(sync.create.length, 0);
  assert.deepEqual(sync.preserve.map((visit) => visit.status).sort(), ['cancelled', 'completed', 'scheduled', 'skipped']);
  assert.equal(sync.preserve.find((visit) => visit.isSeriesException).scheduledDate, '2027-03-12');
});

test('Visit status and billing state machines reject historical rewrites', () => {
  assert.equal(validateVisitStatusTransition('scheduled', 'in_progress'), null);
  assert.equal(validateVisitStatusTransition('in_progress', 'completed'), null);
  assert.match(validateVisitStatusTransition('completed', 'scheduled'), /cannot change/);
  assert.equal(resolveVisitBillingStatus('contract', 'completed'), 'included');
  assert.equal(resolveVisitBillingStatus('per_visit', 'completed'), 'ready');
  assert.equal(resolveVisitBillingStatus('time_and_material', 'completed'), 'pending_usage');
  assert.equal(resolveVisitBillingStatus('per_visit', 'skipped'), 'not_billable');
});