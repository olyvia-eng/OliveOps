import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedTimeOffOverlapping, dateRangesOverlap, isCalendarDate, normalizeTimeOffCreationInput, validateTimeOffCreationInput } from '../api/_lib/timeOff.js';

const valid = { requestType: 'vacation', startDate: '2026-08-28', endDate: '2026-08-30', employeeNote: '', idempotencyKey: 'request-1' };

test('full-day dates remain strict calendar strings across leap and DST boundaries', () => {
  for (const date of ['2026-03-08', '2026-11-01', '2028-02-29', '2026-08-28']) assert.equal(isCalendarDate(date), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-8-28', '2026-08-28T00:00:00.000Z']) assert.equal(isCalendarDate(date), false);
  assert.equal(normalizeTimeOffCreationInput(valid).startDate, '2026-08-28');
});

test('creation validation supports single-day inclusive requests and rejects reversed or invalid ranges', () => {
  assert.equal(validateTimeOffCreationInput({ ...valid, endDate: valid.startDate }), null);
  assert.match(validateTimeOffCreationInput({ ...valid, endDate: '2026-08-27' }), /on or after/);
  assert.match(validateTimeOffCreationInput({ ...valid, requestType: 'holiday' }), /type is invalid/);
  assert.match(validateTimeOffCreationInput({ ...valid, startDate: '2026-02-30' }), /valid calendar date/);
});

test('inclusive overlap includes both boundary dates and approved query excludes denied and cancelled', () => {
  assert.equal(dateRangesOverlap('2026-08-28', '2026-08-30', '2026-08-30', '2026-09-01'), true);
  assert.equal(dateRangesOverlap('2026-08-28', '2026-08-29', '2026-08-30', '2026-09-01'), false);
  const requests = ['approved', 'pending', 'denied', 'cancelled'].map((status) => ({ id: status, status, startDate: '2026-08-28', endDate: '2026-08-30' }));
  assert.deepEqual(approvedTimeOffOverlapping(requests, '2026-08-30', '2026-08-30').map((item) => item.id), ['approved']);
});
