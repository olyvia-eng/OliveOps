import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClockedInNowItems, createClockedInNowHandler } from '../api/clocked-in-now.js';
import { formatClockedInElapsed } from '../src/pages/home/clockedInNowModel.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

const entries = [
  { id: 'active-job', employeeId: 'employee-1', status: 'clocked_in', workType: 'job', jobIds: ['job-1'], workAreaNameSnapshot: 'Plowing', clockIn: '2026-09-08T18:42:00.000Z' },
  { id: 'active-drive', employeeId: 'employee-2', status: 'clocked_in', workType: 'drive_time', clockIn: '2026-09-08T19:05:00.000Z' },
  { id: 'inactive', employeeId: 'employee-3', status: 'clocked_out', workType: 'job', jobIds: ['job-1'], clockIn: '2026-09-08T17:00:00.000Z', clockOut: '2026-09-08T18:00:00.000Z' },
  { id: 'active-unbillable', employeeId: 'employee-4', status: 'clocked_in', workType: 'non_billable', unbillableCategoryName: 'Shop Cleanup', clockIn: '2026-09-08T19:15:00.000Z' },
];

test('active widget projection excludes inactive entries and uses canonical activity and Job labels', () => {
  const items = buildClockedInNowItems(entries, [
    { id: 'employee-1', name: 'Mike Smith' },
    { id: 'employee-2', name: 'Sam Jones' },
    { id: 'employee-3', name: 'Pat Lee' },
    { id: 'employee-4', name: 'Taylor Green' },
  ], [{ id: 'job-1', title: 'Walmart Snow Removal' }]);

  assert.deepEqual(items.map((item) => item.employeeName), ['Mike Smith', 'Sam Jones', 'Taylor Green']);
  assert.equal(items[0].contextLabel, 'Walmart Snow Removal · Plowing');
  assert.equal(items[1].contextLabel, 'Drive Time');
  assert.equal(items[2].contextLabel, 'Non-Billable · Shop Cleanup');
});

test('elapsed duration is concise, padded after one hour, and never negative', () => {
  const now = Date.parse('2026-09-08T21:00:00.000Z');
  assert.equal(formatClockedInElapsed('2026-09-08T20:42:00.000Z', now), '18m');
  assert.equal(formatClockedInElapsed('2026-09-08T19:48:00.000Z', now), '1h 12m');
  assert.equal(formatClockedInElapsed('2026-09-08T16:55:00.000Z', now), '4h 05m');
  assert.equal(formatClockedInElapsed('2026-09-08T22:00:00.000Z', now), '0m');
});

test('Clocked In Now endpoint is owner/admin-only and tenant scoped', async () => {
  let requestedBusinessId = '';
  const handler = createClockedInNowHandler({
    requireSession: async (_req, res, roles) => {
      assert.deepEqual(roles, ['owner', 'admin']);
      if (_req.role === 'crew_member') {
        res.status(403).json({ ok: false, error: 'Forbidden' });
        return null;
      }
      return { businessId: 'business-1', role: _req.role };
    },
    listActiveTimeEntriesForBusiness: async ({ businessId, employeeIds }) => {
      requestedBusinessId = businessId;
      assert.deepEqual(employeeIds, ['employee-1', 'employee-2']);
      return entries;
    },
    listEmployeesForBusiness: async () => [{ id: 'employee-1', name: 'Mike Smith' }, { id: 'employee-2', name: 'Sam Jones' }],
    listJobsForBusiness: async () => [{ id: 'job-1', title: 'Walmart Snow Removal' }],
  });

  const denied = response();
  await handler({ method: 'GET', role: 'crew_member' }, denied);
  assert.equal(denied.statusCode, 403);

  const allowed = response();
  await handler({ method: 'GET', role: 'owner' }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(requestedBusinessId, 'business-1');
  assert.equal(allowed.body.items.length, 3);
});

test('Clocked In Now data failure stays isolated to its endpoint', async () => {
  const handler = createClockedInNowHandler({
    requireSession: async () => ({ businessId: 'business-1', role: 'admin' }),
    listActiveTimeEntriesForBusiness: async () => { throw new Error('temporary failure'); },
    listEmployeesForBusiness: async () => [],
    listJobsForBusiness: async () => [],
  });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'Could not load active employees.' });
});