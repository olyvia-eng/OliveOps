import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRecordsForSession } from '../api/_lib/authorization.js';
import { buildClockedInNowItems, formatClockedInElapsed } from '../src/pages/home/clockedInNowModel.js';

const employees = [
  { id: 'employee-1', name: 'Mike Smith' },
  { id: 'employee-2', name: 'Sam Jones' },
  { id: 'employee-3', name: 'Taylor Green' },
];
const entries = [
  { id: 'active-job', employeeId: 'employee-1', status: 'clocked_in', workType: 'job', jobIds: ['job-1'], workAreaNameSnapshot: 'Plowing', clockIn: '2026-09-08T18:42:00.000Z' },
  { id: 'active-drive', employeeId: 'employee-2', status: 'clocked_in', workType: 'drive_time', clockIn: '2026-09-08T19:05:00.000Z' },
  { id: 'active-unbillable', employeeId: 'employee-3', status: 'clocked_in', workType: 'non_billable', unbillableCategoryName: 'Shop Cleanup', clockIn: '2026-09-08T19:15:00.000Z' },
  { id: 'inactive', employeeId: 'employee-1', status: 'clocked_out', workType: 'job', jobIds: ['job-1'], clockIn: '2026-09-08T17:00:00.000Z', clockOut: '2026-09-08T18:00:00.000Z' },
];

test('multiple active employees resolve names and canonical Job/activity labels', () => {
  const items = buildClockedInNowItems(entries, employees, [{ id: 'job-1', title: 'Walmart Snow Removal' }]);
  assert.deepEqual(items.map((item) => item.employeeName), ['Mike Smith', 'Sam Jones', 'Taylor Green']);
  assert.deepEqual(items.map((item) => item.contextLabel), ['Walmart Snow Removal · Plowing', 'Drive Time', 'Non-Billable · Shop Cleanup']);
});

test('successful canonical data with no open entries produces an empty result', () => {
  assert.deepEqual(buildClockedInNowItems(entries.filter((entry) => entry.status === 'clocked_out'), employees, []), []);
  assert.deepEqual(buildClockedInNowItems([], employees, []), []);
});

test('elapsed duration is concise, padded after one hour, and never negative', () => {
  const now = Date.parse('2026-09-08T21:00:00.000Z');
  assert.equal(formatClockedInElapsed('2026-09-08T20:42:00.000Z', now), '18m');
  assert.equal(formatClockedInElapsed('2026-09-08T19:48:00.000Z', now), '1h 12m');
  assert.equal(formatClockedInElapsed('2026-09-08T16:55:00.000Z', now), '4h 05m');
  assert.equal(formatClockedInElapsed('2026-09-08T22:00:00.000Z', now), '0m');
});

test('bootstrap authorization keeps crew members from receiving company employee and time-entry data', () => {
  const session = { id: 'user-crew', businessId: 'business-1', role: 'crew_member', employeeId: 'employee-2' };
  assert.deepEqual(filterRecordsForSession(session, 'employees', employees).map((employee) => employee.id), ['employee-2']);
  assert.deepEqual(filterRecordsForSession(session, 'time-entries', entries).map((entry) => entry.employeeId), ['employee-2']);
});