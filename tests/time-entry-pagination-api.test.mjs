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
    createManualTimeEntryMutation: async ({ session, input }) => ({ ok: true, timeEntry: { ...entry('created-entry', input.employeeId), ...input, source: 'manual_admin', createdByUserId: session.id } }),
    listTimeEntryPageForBusiness: async (input) => {
      calls.push(input);
      return overrides.page?.(input, calls.length) ?? { items: [entry('entry-1')], hasMore: false, lastEvaluatedKey: null };
    },
    ...overrides.dependencies,
  };
  return { handler: createTimeEntriesHandler(dependencies), calls };
}

test('reports page filters by a tenant-scoped stable employee ID', async () => {
  const context = harness();
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', employeeId: 'employee-1', limit: '25' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.items.map((item) => item.id), ['entry-1']);
  assert.equal(res.body.hasMore, false);
  assert.equal(res.body.nextCursor, null);
  assert.equal(context.calls[0].businessId, 'business-1');
  assert.deepEqual(context.calls[0].filters.employeeIds, ['employee-1']);
  assert.equal(context.calls[0].filters.employeeFilterApplied, true);
});

test('reports page rejects employee IDs outside the authenticated business', async () => {
  const context = harness();
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', employeeId: 'other-business-employee', limit: '25' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'time_entry_employee_invalid');
  assert.equal(context.calls.length, 0);
});

test('legacy employeeSearch query values are ignored without failing', async () => {
  const context = harness();
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', employeeSearch: 'Ada', limit: '25' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(context.calls[0].filters.employeeIds, []);
  assert.equal(context.calls[0].filters.employeeFilterApplied, false);
});

test('employee ID combines with date, Job, work type, and unbillable category filters', async () => {
  const context = harness();
  const res = response();
  await context.handler({ method: 'GET', query: {
    surface: 'reports',
    employeeId: 'employee-2',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    jobId: 'job-1',
    workType: 'non_billable',
    unbillableCategoryId: 'category-1',
    limit: '25',
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(context.calls[0].filters.employeeIds, ['employee-2']);
  assert.equal(context.calls[0].filters.startAt, '2026-01-01T00:00:00.000Z');
  assert.equal(context.calls[0].filters.endAt, '2026-01-31T23:59:59.999Z');
  assert.equal(context.calls[0].filters.jobId, 'job-1');
  assert.equal(context.calls[0].filters.workType, 'non_billable');
  assert.equal(context.calls[0].filters.unbillableCategoryId, 'category-1');
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

test('Bookkeeper export uses the selected employee ID and reports the employee name', async () => {
  const context = harness({ page: () => ({ items: [entry('entry-1', 'employee-2')], hasMore: false, lastEvaluatedKey: null }) });
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', action: 'export', employeeId: 'employee-2', limit: '100' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(context.calls[0].filters.employeeIds, ['employee-2']);
  assert.match(res.body, /Employee,Grace Hopper/);
  assert.match(res.body, /Grace Hopper,1\.00/);
  assert.doesNotMatch(res.body, /Ada Lovelace/);
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

test('DELETE routes authenticated owner and admin requests through the scoped mutation', async () => {
  for (const role of ['owner', 'admin']) {
    const calls = [];
    const context = harness({
      session: { id: `${role}-1`, businessId: 'business-1', role },
      dependencies: {
        deleteTimeEntryMutation: async (input) => {
          calls.push(input);
          return { ok: true, deletedTimeEntryId: input.timeEntryId, auditEventId: 'audit-1' };
        },
      },
    });
    const res = response();
    await context.handler({ method: 'DELETE', query: { entryId: 'entry-1' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deletedTimeEntryId, 'entry-1');
    assert.equal(calls[0].session.businessId, 'business-1');
    assert.equal(calls[0].session.role, role);
  }
});

test('DELETE returns mutation authorization and not-found responses cleanly', async () => {
  for (const expected of [
    { role: 'foreman', status: 403, code: 'time_entry_delete_forbidden' },
    { role: 'crew_member', status: 403, code: 'time_entry_delete_forbidden' },
    { role: 'owner', status: 404, code: 'time_entry_not_found' },
  ]) {
    const context = harness({
      session: { id: 'user-1', businessId: 'business-1', role: expected.role },
      dependencies: {
        deleteTimeEntryMutation: async () => ({ ok: false, status: expected.status, code: expected.code, error: 'Rejected.' }),
      },
    });
    const res = response();
    await context.handler({ method: 'DELETE', query: { entryId: 'entry-1' } }, res);
    assert.equal(res.statusCode, expected.status);
    assert.equal(res.body.code, expected.code);
  }
});

test('a deleted Time Entry is absent from subsequent lists, totals, and Bookkeeper Export', async () => {
  let entries = [entry('entry-1', 'employee-1'), entry('entry-2', 'employee-2')];
  const context = harness({
    dependencies: {
      deleteTimeEntryMutation: async ({ timeEntryId }) => {
        entries = entries.filter((item) => item.id !== timeEntryId);
        return { ok: true, deletedTimeEntryId: timeEntryId, auditEventId: 'audit-1' };
      },
      listTimeEntryPageForBusiness: async () => ({ items: entries, hasMore: false, lastEvaluatedKey: null }),
    },
  });

  const deleted = response();
  await context.handler({ method: 'DELETE', query: { entryId: 'entry-1' } }, deleted);
  assert.equal(deleted.statusCode, 200);

  const listed = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', limit: '25' } }, listed);
  assert.deepEqual(listed.body.items.map((item) => item.id), ['entry-2']);

  const exported = response();
  await context.handler({ method: 'GET', query: { surface: 'reports', action: 'export', limit: '100' } }, exported);
  assert.match(exported.body, /Matching Entries,1/);
  assert.match(exported.body, /Grace Hopper,1\.00/);
  assert.doesNotMatch(exported.body, /Ada Lovelace/);
});

test('POST routes manual creation through the canonical tenant-scoped mutation', async () => {
  const calls = [];
  const context = harness({
    dependencies: {
      createManualTimeEntryMutation: async (input) => {
        calls.push(input);
        return { ok: true, timeEntry: { ...entry('created-entry'), source: 'manual_admin' } };
      },
    },
  });
  const res = response();
  const body = { employeeId: 'employee-1', workType: 'drive_time', clockIn: '2026-01-02T10:00:00.000Z', clockOut: '2026-01-02T11:00:00.000Z' };
  await context.handler({ method: 'POST', query: {}, body }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.timeEntry.id, 'created-entry');
  assert.equal(calls[0].session.businessId, 'business-1');
  assert.deepEqual(calls[0].input, body);
});

test('Job page includes contextual Drive Time in its canonical Job filter', async () => {
  let entries = [entry('job-work')];
  entries.push({ ...entry('drive-time'), workType: 'drive_time', jobId: 'job-1', jobIds: ['job-1'] });
  const context = harness({
    dependencies: {
      listTimeEntryPageForBusiness: async ({ filters }) => ({
        items: entries.filter((item) => item.jobIds.includes(filters.jobId)), hasMore: false, lastEvaluatedKey: null,
      }),
    },
  });
  const res = response();
  await context.handler({ method: 'GET', query: { surface: 'job', jobId: 'job-1' } }, res);
  assert.deepEqual(res.body.items.map((item) => item.id), ['job-work', 'drive-time']);
});