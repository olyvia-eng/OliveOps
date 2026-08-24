import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dateRangesOverlapInclusive,
  exclusiveEndDateKey,
  getEmployeeTimeOffConflicts,
  getJobTimeOffConflicts,
  normalizeTimeOffScheduleEntry,
} from '../src/utils/employeeAvailability.js';

const requests = [
  { id: 'approved-a', employeeId: 'emp-a', employeeName: 'Jane Smith', requestType: 'vacation', startDate: '2026-08-28', endDate: '2026-08-30', status: 'approved' },
  { id: 'pending-a', employeeId: 'emp-a', employeeName: 'Jane Smith', requestType: 'personal', startDate: '2026-08-29', endDate: '2026-08-29', status: 'pending' },
  { id: 'denied-a', employeeId: 'emp-a', employeeName: 'Jane Smith', requestType: 'sick', startDate: '2026-08-29', endDate: '2026-08-29', status: 'denied' },
  { id: 'cancelled-a', employeeId: 'emp-a', employeeName: 'Jane Smith', requestType: 'unpaid', startDate: '2026-08-29', endDate: '2026-08-29', status: 'cancelled' },
];

test('approved-only conflicts use inclusive calendar dates and preserve single and multi-day values', () => {
  assert.equal(dateRangesOverlapInclusive('2026-08-28', '2026-08-30', '2026-08-30', '2026-08-30'), true);
  const conflicts = getEmployeeTimeOffConflicts({ employeeIds: ['emp-a'], startDate: '2026-08-29', endDate: '2026-08-29', approvedTimeOff: requests });
  assert.deepEqual(conflicts.map((item) => item.requestId), ['approved-a']);
  const entry = normalizeTimeOffScheduleEntry(requests[0], { id: 'emp-a', name: 'Jane Smith' });
  assert.equal(entry.startKey, '2026-08-28');
  assert.equal(entry.endKey, '2026-08-30');
  assert.equal(entry.allDay, true);
});

test('calendar date overlap remains stable across month, year, and DST boundaries', () => {
  assert.equal(dateRangesOverlapInclusive('2026-08-31', '2026-09-02', '2026-09-01', '2026-09-01'), true);
  assert.equal(dateRangesOverlapInclusive('2026-12-31', '2027-01-02', '2027-01-01', '2027-01-01'), true);
  assert.equal(dateRangesOverlapInclusive('2026-03-07', '2026-03-09', '2026-03-08', '2026-03-08'), true);
  assert.equal(dateRangesOverlapInclusive('2026-11-01', '2026-11-01', '2026-11-01', '2026-11-01'), true);
  assert.equal(exclusiveEndDateKey('2026-08-31'), '2026-09-01');
  assert.equal(exclusiveEndDateKey('2026-12-31'), '2027-01-01');
  assert.equal(exclusiveEndDateKey('2026-03-08'), '2026-03-09');
  assert.equal(exclusiveEndDateKey('2026-11-01'), '2026-11-02');
});

test('crew assignment expands lead and member employees without marking the whole crew unavailable', () => {
  const crews = [{ id: 'crew-a', leadEmployeeId: 'emp-a', memberIds: ['emp-b', 'emp-c'] }];
  const approvedTimeOff = [...requests, { id: 'approved-b', employeeId: 'emp-b', employeeName: 'Mike White', requestType: 'personal', startDate: '2026-08-29', endDate: '2026-08-29', status: 'approved' }];
  const conflicts = getEmployeeTimeOffConflicts({ employeeIds: [], crewId: 'crew-a', crews, startDate: '2026-08-29', endDate: '2026-08-29', approvedTimeOff });
  assert.deepEqual(conflicts.map((item) => item.employeeId), ['emp-a', 'emp-b']);
  assert.equal(conflicts.every((item) => item.fromCrew), true);
});

test('existing scheduled work reports conflicts without mutating the Job assignment', () => {
  const job = { id: 'job-a', startDate: '2026-08-29', endDate: '2026-08-29', assignedEmployeeIds: ['emp-a'] };
  const snapshot = structuredClone(job);
  assert.equal(getJobTimeOffConflicts(job, requests).length, 1);
  assert.deepEqual(job, snapshot);
});