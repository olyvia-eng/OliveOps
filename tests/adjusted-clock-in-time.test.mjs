import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestedClockInTime } from '../api/_lib/clocking.js';

test('adjusted clock-in validation defaults to server now', () => {
  const result = resolveRequestedClockInTime({
    serverReceivedAt: '2026-09-02T12:00:00.000Z',
    businessTimeZone: 'America/Toronto',
    permitted: false,
  });
  assert.deepEqual(result, {
    ok: true,
    effectiveClockInAt: '2026-09-02T12:00:00.000Z',
    requestedClockInAt: undefined,
    clockInTimeSource: 'server_now',
  });
});

test('adjusted clock-in validation requires permission and enforces time bounds', () => {
  const input = { serverReceivedAt: '2026-09-02T12:00:00.000Z', businessTimeZone: 'America/Toronto' };
  assert.equal(resolveRequestedClockInTime({ ...input, requestedClockInAt: '2026-09-02T11:00:00.000Z', permitted: false }).code, 'clock_in_time_not_allowed');
  assert.equal(resolveRequestedClockInTime({ ...input, requestedClockInAt: '2026-09-02T07:59:59.999Z', permitted: true }).code, 'clock_in_time_too_old');
  assert.equal(resolveRequestedClockInTime({ ...input, requestedClockInAt: '2026-09-02T12:05:00.001Z', permitted: true }).code, 'clock_in_time_in_future');
});

test('adjusted clock-in validation uses the business date rather than UTC date', () => {
  const result = resolveRequestedClockInTime({
    serverReceivedAt: '2026-09-02T04:30:00.000Z',
    requestedClockInAt: '2026-09-02T03:30:00.000Z',
    businessTimeZone: 'America/Toronto',
    permitted: true,
  });
  assert.equal(result.code, 'clock_in_time_too_old');

  const valid = resolveRequestedClockInTime({
    serverReceivedAt: '2026-09-02T04:30:00.000Z',
    requestedClockInAt: '2026-09-02T04:00:00.000Z',
    businessTimeZone: 'America/Toronto',
    permitted: true,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.effectiveClockInAt, '2026-09-02T04:00:00.000Z');
});