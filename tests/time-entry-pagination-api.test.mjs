import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimeEntriesHandler } from '../api/time-entries.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

function entry(id, employeeId = 'employee-1') {
  return {
    id,
    employeeId,
    workType: 'job',
    jobId: 'job-1',
    jobIds: ['job-1', 'job-shared'],
    clockIn: '2026-01-02T10:00:00.000Z',
    clockOut: '2026-01-02T11:00:00.000Z',
    breakMinutes: 0,
    status: 'clocked_out',
    createdAt: '2026-01-02T10:00:00.000Z',
  };
}

function harness(overrides = {}) {
  const calls = [];
  const dependencies = {
    requireSession: async () => overrides.session ?? { id: 'user-1', businessId: 'business-1', role: 'owner' },
    getJobForBusiness: async (_businessId, id) => id === 'job-1' ? { id, assignedEmployeeIds: [] } : null,
    listCrewsForBusiness: async () => [],
    listEmployeesForBusiness: async () => [
      { id: 'employee-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: 'employee-2', name: 'Grace Hopper', email: 'grace@example.com' },
    ],
    listTimeCorrectionsForBusiness: async () => [],
    listTimeEntryPageForBusiness: async (input) => {
      calls.push(input);
      return overrides.page?.(input, calls.length) ?? { items: [entry('entry-1')], hasMore: false, lastEvaluatedKey: null };
    },
    ...overrides.dependencies,
  };
  return { handler: createTimeEntriesHandler(dependencies), calls };
}

test('reports page is tenant scoped and resolves employee search before repository filtering', async () => {
  const context = harness();
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', employeeSearch: 'ADA', limit: '25' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map((item) => item.id), ['entry-1']);
  assert.equal(context.calls[0].businessId, 'business-1');
  assert.deepEqual(context.calls[0].filters.employeeIds, ['employee-1']);
  assert.equal(context.calls[0].filters.employeeFilterApplied, true);
});

test('reports page rejects non-admin sessions', async () => {
  const context = harness({ session: { id: 'user-1', businessId: 'business-1', role: 'foreman' } });
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'reports' } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(context.calls.length, 0);
});

test('Job page rejects inaccessible Jobs before querying Time Entries', async () => {
  const context = harness({ session: { id: 'user-1', employeeId: 'employee-2', businessId: 'business-1', role: 'crew_member' } });
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'job', jobId: 'job-1' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(context.calls.length, 0);
});

test('Job page includes multi-Job rows through the server Job filter', async () => {
  const context = harness();
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'job', jobId: 'job-shared', limit: '10' } }, res);
  assert.equal(res.statusCode, 404);

  const authorized = harness({ dependencies: { getJobForBusiness: async () => ({ id: 'job-shared', assignedEmployeeIds: [] }) } });
  const authorizedRes = response();
  await authorized.handler({ method: 'GET', query: { surface: 'job', jobId: 'job-shared', limit: '10' } }, authorizedRes);
  assert.equal(authorizedRes.statusCode, 200);
  assert.equal(authorized.calls[0].filters.jobId, 'job-shared');
});

test('Bookkeeper export traverses every matching page and ignores a supplied UI cursor', async () => {
  const context = harness({
    page: (_input, callNumber) => callNumber === 1
      ? { items: [entry('entry-1')], hasMore: true, lastEvaluatedKey: { PK: 'next' } }
      : { items: [entry('entry-2', 'employee-2')], hasMore: false, lastEvaluatedKey: null },
  });
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', action: 'export', limit: '100', cursor: 'ignored' } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.body, /Matching Entries,2/);
  assert.match(res.body, /Ada Lovelace/);
  assert.match(res.body, /Grace Hopper/);
  assert.equal(context.calls.length, 2);
  assert.equal(context.calls[0].exclusiveStartKey, undefined);
  assert.deepEqual(context.calls[1].exclusiveStartKey, { PK: 'next' });
});

test('authorized crew members remain restricted to their own Time Entries', async () => {
  const context = harness({
    session: { id: 'user-1', employeeId: 'employee-1', businessId: 'business-1', role: 'crew_member' },
    dependencies: { getJobForBusiness: async () => ({ id: 'job-1', assignedEmployeeIds: ['employee-1'] }) },
  });
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'job', jobId: 'job-1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(context.calls[0].filters.employeeFilterApplied, true);
  assert.deepEqual(context.calls[0].filters.employeeIds, ['employee-1']);
});