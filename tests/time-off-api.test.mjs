import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeOffHandler } from '../api/_lib/timeOffHandler.js';
import { timeOffPayloadFingerprint } from '../api/_lib/timeOff.js';

function response() {
  return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
}

function harness({ session = { id: 'user-a', businessId: 'biz-a', employeeId: 'emp-a', role: 'crew_member', name: 'Alex', email: 'a@example.com' }, employees, requests = [] } = {}) {
  const state = {
    requests: structuredClone(requests),
    idempotency: new Map(),
    employees: employees ?? [
      { id: 'emp-a', userId: 'user-a', name: 'Alex', active: true },
      { id: 'emp-b', userId: 'user-b', name: 'Blair', active: true },
    ],
    scheduleBusinessIds: [],
  };
  const handler = createTimeOffHandler({
    requireSession: async () => session,
    listEmployeesForBusiness: async () => state.employees,
    listUsersForBusiness: async () => [{ id: 'admin-a', name: 'Owner' }],
    listTimeOffRequestsForBusiness: async () => [...state.requests].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    listApprovedTimeOffOverlappingForBusiness: async (businessId, startDate, endDate) => { state.scheduleBusinessIds.push(businessId); return state.requests.filter((item) => item.status === 'approved' && item.startDate <= endDate && item.endDate >= startDate); },
    getTimeOffRequestForBusiness: async (_businessId, id) => state.requests.find((item) => item.id === id) ?? null,
    getTimeOffCreationIdempotency: async ({ employeeId, idempotencyKey }) => state.idempotency.get(`${employeeId}:${idempotencyKey}`) ?? null,
    createTimeOffRequestForBusiness: async ({ request, payloadFingerprint }) => {
      const key = `${request.employeeId}:${request.idempotencyKey}`;
      if (state.idempotency.has(key)) return { ok: false, code: 'CONFLICT' };
      state.idempotency.set(key, { requestId: request.id, payloadFingerprint });
      state.requests.push(request);
      return { ok: true };
    },
    cancelTimeOffRequestForBusiness: async ({ request, transitionedAt }) => transition(state, request, 'cancelled', transitionedAt),
    approveTimeOffRequestForBusiness: async ({ request, actor, reviewNote, transitionedAt }) => transition(state, request, 'approved', transitionedAt, actor.id, reviewNote),
    denyTimeOffRequestForBusiness: async ({ request, actor, reviewNote, transitionedAt }) => transition(state, request, 'denied', transitionedAt, actor.id, reviewNote),
    generateId: () => `request-${state.requests.length + 1}`,
    now: () => '2026-08-24T12:00:00.000Z',
  });
  return { handler, state };
}

function transition(state, request, status, at, reviewerId, reviewNote) {
  const current = state.requests.find((item) => item.id === request.id);
  if (!current || current.status !== 'pending') return { ok: false, code: 'CONFLICT' };
  Object.assign(current, { status, updatedAt: at }, status === 'cancelled' ? { cancelledAt: at } : { reviewedAt: at, reviewedByUserId: reviewerId, reviewNote });
  return { ok: true };
}

async function call(handler, method, action, { body = {}, query = {} } = {}) {
  const res = response();
  await handler({ method, query: { action, ...query }, body }, res);
  return res;
}

const creation = { requestType: 'vacation', startDate: '2026-08-28', endDate: '2026-08-30', employeeNote: 'Family trip', idempotencyKey: 'mobile-1', employeeId: 'emp-b', businessId: 'biz-b', status: 'approved' };
const pending = (id, employeeId = 'emp-a') => ({ id, businessId: 'biz-a', employeeId, requestType: 'personal', startDate: '2026-09-01', endDate: '2026-09-01', employeeNote: '', idempotencyKey: id, status: 'pending', submittedAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z', updatedAt: '2026-08-24T10:00:00.000Z' });

test('employee creation derives business and employee identity and ignores spoofed protected fields', async () => {
  const { handler, state } = harness();
  const res = await call(handler, 'POST', 'create', { body: creation });
  assert.equal(res.statusCode, 201);
  assert.equal(state.requests[0].businessId, 'biz-a');
  assert.equal(state.requests[0].employeeId, 'emp-a');
  assert.equal(state.requests[0].status, 'pending');
});

test('creation validates type, dates, reversed ranges, and active linked employee', async () => {
  const { handler } = harness();
  for (const body of [{ ...creation, requestType: 'holiday' }, { ...creation, startDate: 'bad' }, { ...creation, startDate: '2026-09-02', endDate: '2026-09-01' }]) {
    assert.equal((await call(handler, 'POST', 'create', { body })).statusCode, 400);
  }
  const missing = harness({ employees: [] });
  assert.equal((await call(missing.handler, 'POST', 'create', { body: creation })).statusCode, 404);
});

test('idempotent retry returns one request while conflicting key reuse returns conflict', async () => {
  const { handler, state } = harness();
  assert.equal((await call(handler, 'POST', 'create', { body: creation })).statusCode, 201);
  const replay = await call(handler, 'POST', 'create', { body: creation });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.requests.length, 1);
  assert.equal((await call(handler, 'POST', 'create', { body: { ...creation, endDate: '2026-08-31' } })).statusCode, 409);
});

test('employee list and detail return only the authenticated employee records', async () => {
  const { handler } = harness({ requests: [pending('mine'), pending('other', 'emp-b')] });
  const mine = await call(handler, 'GET', 'mine');
  assert.deepEqual(mine.body.items.map((item) => item.id), ['mine']);
  assert.equal((await call(handler, 'GET', 'detail', { query: { id: 'other' } })).statusCode, 404);
  assert.equal((await call(handler, 'GET', 'detail', { query: { id: 'mine' } })).statusCode, 200);
});

test('Schedule range derives tenant from session and returns approved overlap only with minimal fields', async () => {
  const approved = { ...pending('approved'), status: 'approved', requestType: 'vacation', startDate: '2026-08-28', endDate: '2026-08-30' };
  const { handler, state } = harness({ requests: [approved, pending('pending')] });
  const result = await call(handler, 'GET', 'schedule', { query: { startDate: '2026-08-29', endDate: '2026-08-29' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items, [{ id: 'approved', employeeId: 'emp-a', employeeName: 'Alex', requestType: 'vacation', startDate: '2026-08-28', endDate: '2026-08-30', status: 'approved' }]);
  assert.equal('employeeNote' in result.body.items[0], false);
  assert.deepEqual(state.scheduleBusinessIds, ['biz-a']);
  assert.equal((await call(handler, 'GET', 'schedule', { query: { startDate: 'bad', endDate: '2026-08-29' } })).statusCode, 400);
});

test('employee cancellation is own pending only and stale cancellation returns authoritative state', async () => {
  const own = pending('mine');
  const { handler, state } = harness({ requests: [own, pending('other', 'emp-b')] });
  assert.equal((await call(handler, 'PATCH', 'cancel', { query: { id: 'other' } })).statusCode, 404);
  assert.equal((await call(handler, 'PATCH', 'cancel', { query: { id: 'mine' } })).body.request.status, 'cancelled');
  const stale = await call(handler, 'PATCH', 'cancel', { query: { id: 'mine' } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.request.status, 'cancelled');
  state.requests[0].status = 'approved';
  assert.equal((await call(handler, 'PATCH', 'cancel', { query: { id: 'mine' } })).statusCode, 409);
});

test('owner/admin list and review populate metadata while non-admin review is forbidden', async () => {
  const request = pending('review');
  const admin = harness({ session: { id: 'admin-a', businessId: 'biz-a', role: 'owner', name: 'Owner', email: 'owner@example.com' }, requests: [request] });
  assert.equal((await call(admin.handler, 'GET', 'list')).body.items[0].employeeName, 'Alex');
  const approved = await call(admin.handler, 'PATCH', 'approve', { query: { id: 'review' }, body: { reviewNote: 'Approved' } });
  assert.equal(approved.body.request.status, 'approved');
  assert.equal(approved.body.request.reviewedByUserId, 'admin-a');
  const employee = harness({ requests: [pending('review')] });
  assert.equal((await call(employee.handler, 'PATCH', 'deny', { query: { id: 'review' } })).statusCode, 403);
});

test('concurrent approve and deny permits one winner and returns authoritative state to the loser', async () => {
  const { handler } = harness({ session: { id: 'admin-a', businessId: 'biz-a', role: 'admin', name: 'Admin' }, requests: [pending('race')] });
  assert.equal((await call(handler, 'PATCH', 'approve', { query: { id: 'race' } })).statusCode, 200);
  const loser = await call(handler, 'PATCH', 'deny', { query: { id: 'race' } });
  assert.equal(loser.statusCode, 409);
  assert.equal(loser.body.request.status, 'approved');
});

test('pre-existing durable idempotency records replay the original result', async () => {
  const request = pending('persisted');
  request.idempotencyKey = creation.idempotencyKey;
  request.requestType = creation.requestType; request.startDate = creation.startDate; request.endDate = creation.endDate; request.employeeNote = creation.employeeNote;
  const { handler, state } = harness({ requests: [request] });
  state.idempotency.set(`emp-a:${creation.idempotencyKey}`, { requestId: request.id, payloadFingerprint: timeOffPayloadFingerprint(creation) });
  assert.equal((await call(handler, 'POST', 'create', { body: creation })).body.request.id, 'persisted');
});
