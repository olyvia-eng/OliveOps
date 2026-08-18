import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUSINESS_TIME_ZONE,
  getBusinessPeriodKeys,
  getPeriodKeyForTrigger,
  isValidTimeZone,
  normalizeBusinessTimeZone,
} from '../api/_lib/businessTime.js';

test('business period keys use the business-local date and Monday week', () => {
  assert.deepEqual(getBusinessPeriodKeys('2026-08-18T02:30:00.000Z', 'America/Toronto'), {
    daily: '2026-08-17',
    weekly: '2026-08-17',
    monthly: '2026-08',
  });
  assert.equal(getPeriodKeyForTrigger('weekly', '2026-08-23T20:00:00.000Z', 'America/Toronto'), '2026-08-17');
  assert.equal(getPeriodKeyForTrigger('monthly', '2026-09-01T02:00:00.000Z', 'America/Toronto'), '2026-08');
});

test('business periods remain local across daylight-saving boundaries', () => {
  assert.equal(getPeriodKeyForTrigger('daily', '2026-03-08T04:30:00.000Z', 'America/Toronto'), '2026-03-07');
  assert.equal(getPeriodKeyForTrigger('daily', '2026-03-08T05:30:00.000Z', 'America/Toronto'), '2026-03-08');
});

test('invalid or missing zones use the legacy business fallback', () => {
  assert.equal(DEFAULT_BUSINESS_TIME_ZONE, 'America/Toronto');
  assert.equal(isValidTimeZone('Europe/London'), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(normalizeBusinessTimeZone('Not/AZone'), DEFAULT_BUSINESS_TIME_ZONE);
});

test('daily, weekly, and monthly keys advance only at local period boundaries', () => {
  assert.equal(getPeriodKeyForTrigger('daily', '2026-08-18T03:59:59.999Z', 'America/Toronto'), '2026-08-17');
  assert.equal(getPeriodKeyForTrigger('daily', '2026-08-18T04:00:00.000Z', 'America/Toronto'), '2026-08-18');
  assert.equal(getPeriodKeyForTrigger('weekly', '2026-08-17T03:59:59.999Z', 'America/Toronto'), '2026-08-10');
  assert.equal(getPeriodKeyForTrigger('weekly', '2026-08-17T04:00:00.000Z', 'America/Toronto'), '2026-08-17');
  assert.equal(getPeriodKeyForTrigger('monthly', '2026-09-01T03:59:59.999Z', 'America/Toronto'), '2026-08');
  assert.equal(getPeriodKeyForTrigger('monthly', '2026-09-01T04:00:00.000Z', 'America/Toronto'), '2026-09');
});