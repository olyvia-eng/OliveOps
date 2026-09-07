import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateSuggestedServiceVisits,
  normalizeEstimateServices,
  resolveWorkType,
  validateEstimateService,
} from '../src/utils/workTypeModel.js';

test('legacy work records resolve to project without mutation', () => {
  const estimate = { id: 'estimate-1' };
  const job = { id: 'job-1' };
  assert.equal(resolveWorkType(estimate), 'project');
  assert.equal(resolveWorkType(job), 'project');
  assert.deepEqual(estimate, { id: 'estimate-1' });
  assert.equal(resolveWorkType({ workType: 'service' }), 'service');
});

test('service normalization preserves stable ids, explicit ordering, and unknown future fields', () => {
  const services = normalizeEstimateServices([
    { id: 'two', name: 'Cleanup', scheduleType: 'one_time', billingType: 'per_visit', startDate: '2027-05-01', estimatedVisits: 1, sortOrder: 2, futurePricingMode: 'phase-2' },
    { id: 'one', name: 'Mowing', scheduleType: 'recurring', billingType: 'contract', startDate: '2027-04-15', endDate: '2027-10-31', frequency: { interval: 1, unit: 'week' }, sortOrder: 0 },
  ]);
  assert.deepEqual(services.map((service) => service.id), ['one', 'two']);
  assert.equal(services[1].futurePricingMode, 'phase-2');
  assert.equal(services[0].estimatedVisits, 29);
});

test('suggested visits support day, week, month, and one-time schedules', () => {
  assert.equal(calculateSuggestedServiceVisits({ scheduleType: 'recurring', startDate: '2027-04-15', endDate: '2027-10-31', frequency: { interval: 1, unit: 'week' } }), 29);
  assert.equal(calculateSuggestedServiceVisits({ scheduleType: 'recurring', startDate: '2027-01-01', endDate: '2027-01-05', frequency: { interval: 2, unit: 'day' } }), 3);
  assert.equal(calculateSuggestedServiceVisits({ scheduleType: 'recurring', startDate: '2027-01-15', endDate: '2027-04-15', frequency: { interval: 1, unit: 'month' } }), 4);
  assert.equal(calculateSuggestedServiceVisits({ scheduleType: 'one_time' }), 1);
});

test('service validation covers schedule, billing, recurrence, dates, and estimated visits', () => {
  const recurring = { id: 'service-1', name: 'Mowing', sortOrder: 0, scheduleType: 'recurring', billingType: 'contract', startDate: '2027-04-15', endDate: '2027-10-31', frequency: { interval: 1, unit: 'week' }, estimatedVisits: 28 };
  assert.equal(validateEstimateService(recurring), null);
  assert.match(validateEstimateService({ ...recurring, scheduleType: 'sometimes' }), /schedule type/);
  assert.match(validateEstimateService({ ...recurring, billingType: 'hourly' }), /billing type/);
  assert.match(validateEstimateService({ ...recurring, frequency: { interval: 0, unit: 'week' } }), /greater than zero/);
  assert.match(validateEstimateService({ ...recurring, endDate: '2027-04-14' }), /cannot precede/);
  assert.match(validateEstimateService({ ...recurring, estimatedVisits: -1 }), /zero or greater/);
});