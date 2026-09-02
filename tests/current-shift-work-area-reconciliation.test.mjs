import test from 'node:test';
import assert from 'node:assert/strict';
import clockingHandler from '../api/clocking.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  setHeader() { return this; },
  json(body) { this.body = body; return this; },
});

function installDdb(t) {
  const store = new Map();
  const state = { failNextTransaction: false, beforeTransaction: null };
  const original = ddb.send.bind(ddb);
  const read = (itemKey) => store.get(key(itemKey.PK, itemKey.SK));
  const field = (token, names = {}) => names[token] ?? token.replace(/^#/, '');

  const conditionPasses = (operation, existing) => {
    const condition = operation.ConditionExpression ?? '';
    const names = operation.ExpressionAttributeNames ?? {};
    const values = operation.ExpressionAttributeValues ?? {};
    if (condition.includes('attribute_not_exists(PK)') && existing) return false;
    if (condition.includes('attribute_exists(PK)') && !existing) return false;
    for (const match of condition.matchAll(/attribute_not_exists\((#[A-Za-z0-9_]+)\)/g)) {
      if (existing && existing[field(match[1], names)] !== undefined) return false;
    }
    for (const match of condition.matchAll(/(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)/g)) {
      if (!existing || existing[field(match[1], names)] !== values[match[2]]) return false;
    }
    return true;
  };

  const applyUpdate = (operation, existing) => {
    const names = operation.ExpressionAttributeNames ?? {};
    const values = operation.ExpressionAttributeValues ?? {};
    const next = { ...existing };
    const setExpression = operation.UpdateExpression.replace(/^SET\s+/i, '');
    for (const assignment of setExpression.split(',').map((part) => part.trim()).filter(Boolean)) {
      const [left, right] = assignment.split('=').map((part) => part.trim());
      next[field(left, names)] = values[right];
    }
    return next;
  };

  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: read(input.Key) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && (!prefix || item.SK.startsWith(prefix))) };
    }
    if (type === 'TransactWriteCommand') {
      if (state.beforeTransaction) {
        const mutate = state.beforeTransaction;
        state.beforeTransaction = null;
        mutate();
      }
      if (state.failNextTransaction) {
        state.failNextTransaction = false;
        throw Object.assign(new Error('Injected transaction failure'), { name: 'TransactionCanceledException' });
      }
      const operations = input.TransactItems ?? [];
      const failed = operations.some((item) => {
        const operation = item.Put ?? item.Update ?? item.Delete ?? item.ConditionCheck;
        const existing = item.Put ? read(item.Put.Item) : read(operation.Key);
        return !conditionPasses(operation, existing);
      });
      if (failed) throw Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' });
      for (const item of operations) {
        if (item.Put) store.set(key(item.Put.Item.PK, item.Put.Item.SK), { ...item.Put.Item });
        if (item.Delete) store.delete(key(item.Delete.Key.PK, item.Delete.Key.SK));
        if (item.Update) store.set(key(item.Update.Key.PK, item.Update.Key.SK), applyUpdate(item.Update, read(item.Update.Key)));
      }
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return { store, state };
}

async function request(token, { method = 'POST', action, body = {} }) {
  const res = response();
  await clockingHandler({ method, query: { action }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

async function setup(t, { permission = true, layout = 'job', active = true } = {}) {
  const { store, state } = installDdb(t);
  const businessId = 'biz-reconcile';
  const employeeId = 'employee-reconcile';
  const userId = 'user-reconcile';
  const token = 'token-reconcile';
  const pk = `BUSINESS#${businessId}`;
  const now = Date.now();
  const boundaries = {
    start: iso(now - 8 * 60 * 60_000),
    first: iso(now - 6 * 60 * 60_000),
    second: iso(now - 3 * 60 * 60_000),
    lockedEnd: iso(now - 2 * 60 * 60_000),
  };
  store.set(key(pk, 'PROFILE'), { PK: pk, SK: 'PROFILE', entityType: 'BUSINESS', businessId, timezone: 'America/Toronto' });
  store.set(key(pk, `USER#${userId}`), {
    PK: pk, SK: `USER#${userId}`, entityType: 'USER', businessId, userId,
    name: 'Employee', email: 'employee@example.com', role: 'crew_member', active: true, sessionVersion: 0,
  });
  store.set(key(pk, `EMPLOYEE#${employeeId}`), {
    PK: pk, SK: `EMPLOYEE#${employeeId}`, entityType: 'EMPLOYEE', businessId, employeeId, id: employeeId,
    userId, name: 'Employee', email: 'employee@example.com', role: 'crew_member', active: true,
    mobileTimePermissions: permission === undefined ? undefined : { editShiftWorkAreas: permission, adjustClockInTime: false },
  });
  const operationalWorkAreas = [
    { id: 'area-excavation', name: 'Excavation', status: 'in_progress', sortOrder: 0 },
    { id: 'area-base', name: 'Base Prep', status: 'not_started', sortOrder: 1 },
    { id: 'area-grading', name: 'Grading', status: 'not_started', sortOrder: 2 },
  ];
  store.set(key(pk, 'JOB#job-a'), {
    PK: pk, SK: 'JOB#job-a', entityType: 'JOB', businessId, jobId: 'job-a', title: 'Job A', status: 'in_progress',
    assignedEmployeeIds: [employeeId], assignedEquipmentIds: [], operationalWorkAreas,
  });
  store.set(key(pk, 'JOB#job-b'), {
    PK: pk, SK: 'JOB#job-b', entityType: 'JOB', businessId, jobId: 'job-b', title: 'Job B', status: 'in_progress',
    assignedEmployeeIds: [employeeId], assignedEquipmentIds: [],
    operationalWorkAreas: [{ id: 'area-job-b', name: 'Job B Area', status: 'in_progress', sortOrder: 0 }],
  });

  const entries = [];
  const entry = (id, workType, clockIn, clockOut, extra = {}) => ({
    PK: pk, SK: `TIME#${id}`, entityType: 'TIME_ENTRY', businessId, entryId: id, employeeId,
    employeeName: 'Employee', workType, clockIn, clockOut, status: clockOut ? 'clocked_out' : 'clocked_in',
    breakMinutes: 0, notes: '', createdAt: id === 'entry-1' ? boundaries.start : clockIn, updatedAt: clockOut ?? clockIn,
    ...extra,
  });
  if (layout === 'job') {
    entries.push(entry('entry-1', 'job', boundaries.start, undefined, {
      jobId: 'job-a', jobIds: ['job-a'], workAreaId: 'area-excavation', workAreaNameSnapshot: 'Old client text',
    }));
  } else {
    entries.push(entry('entry-1', 'job', boundaries.start, boundaries.first, {
      jobId: 'job-a', jobIds: ['job-a'], workAreaId: 'area-excavation', workAreaNameSnapshot: 'Excavation',
    }));
    entries.push(entry('entry-2', layout, boundaries.first, boundaries.second, layout === 'non_billable'
      ? { unbillableCategoryId: 'category-a', unbillableCategoryName: 'Shop' }
      : {}));
    entries.push(entry('entry-3', 'job', boundaries.second, undefined, {
      jobId: 'job-a', jobIds: ['job-a'], workAreaId: 'area-grading', workAreaNameSnapshot: 'Grading',
    }));
  }
  for (const item of entries) store.set(key(item.PK, item.SK), item);
  if (active) {
    const activeEntry = entries[entries.length - 1];
    store.set(key(`${pk}#EMPLOYEE#${employeeId}`, 'ACTIVE_SHIFT'), {
      PK: `${pk}#EMPLOYEE#${employeeId}`, SK: 'ACTIVE_SHIFT', entityType: 'ACTIVE_SHIFT', businessId, employeeId,
      activeEntryId: activeEntry.entryId, activeEntryStartedAt: activeEntry.clockIn, status: 'active',
      createdAt: boundaries.start, updatedAt: activeEntry.clockIn,
    });
  } else {
    const openEntry = entries[entries.length - 1];
    openEntry.clockOut = boundaries.lockedEnd;
    openEntry.status = 'clocked_out';
  }
  await createMobileSessionForUser({
    user: { id: userId, businessId, name: 'Employee', email: 'employee@example.com', role: 'crew_member', employeeId },
    accessToken: token,
    expiresInSeconds: 3600,
  });
  return { store, state, businessId, employeeId, token, pk, boundaries };
}

async function currentTimeline(context) {
  return request(context.token, { method: 'GET', action: 'current-shift-work-area-timeline' });
}

function splitSegments(boundaries) {
  return [
    { jobId: 'job-a', workAreaId: 'area-excavation', startAt: boundaries.start, endAt: boundaries.first },
    { jobId: 'job-a', workAreaId: 'area-base', startAt: boundaries.first, endAt: boundaries.second },
    { jobId: 'job-a', workAreaId: 'area-grading', startAt: boundaries.second, endAt: null },
  ];
}

async function reconcile(context, segments, overrides = {}) {
  const current = await currentTimeline(context);
  return request(context.token, {
    action: 'reconcile-current-shift-work-areas',
    body: {
      clientRequestId: 'reconcile-request-1',
      timelineRevision: current.body.timelineRevision,
      segments,
      ...overrides,
    },
  });
}

test('permission false and missing permission reject self-service reconciliation', async (t) => {
  const denied = await setup(t, { permission: false });
  const deniedResult = await reconcile(denied, splitSegments(denied.boundaries));
  assert.equal(deniedResult.statusCode, 403);
  assert.equal(deniedResult.body.code, 'shift_work_area_edit_not_allowed');

  const missing = await setup(t, { permission: null });
  const missingResult = await reconcile(missing, splitSegments(missing.boundaries));
  assert.equal(missingResult.statusCode, 403);
  assert.equal(missingResult.body.code, 'shift_work_area_edit_not_allowed');
});

test('employee can reconcile only their own active shift', async (t) => {
  const context = await setup(t);
  const activeShift = context.store.get(key(`${context.pk}#EMPLOYEE#${context.employeeId}`, 'ACTIVE_SHIFT'));
  activeShift.employeeId = 'another-employee';
  const result = await request(context.token, {
    action: 'reconcile-current-shift-work-areas',
    body: {
      clientRequestId: 'other-employee-shift',
      timelineRevision: 'stale-revision',
      segments: splitSegments(context.boundaries),
    },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'current_shift_not_active');
});

test('single Job Work entry splits atomically into authoritative Work Area segments', async (t) => {
  const context = await setup(t);
  const result = await reconcile(context, splitSegments(context.boundaries));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.timeline.map((entry) => ({
    area: entry.workAreaId, name: entry.workAreaNameSnapshot, start: entry.clockIn, end: entry.clockOut ?? null,
  })), [
    { area: 'area-excavation', name: 'Excavation', start: context.boundaries.start, end: context.boundaries.first },
    { area: 'area-base', name: 'Base Prep', start: context.boundaries.first, end: context.boundaries.second },
    { area: 'area-grading', name: 'Grading', start: context.boundaries.second, end: null },
  ]);
  assert.equal(context.store.has(key(context.pk, 'TIME#entry-1')), false);
  assert.equal(result.body.timeline.every((entry) => entry.adjustmentSource === 'employee_self_edit'), true);
  assert.equal(context.store.get(key(`${context.pk}#EMPLOYEE#${context.employeeId}`, 'ACTIVE_SHIFT')).activeEntryId, result.body.activeEntryId);
  const audit = [...context.store.values()].find((item) => item.entityType === 'AUDIT_EVENT');
  assert.equal(audit.action, 'employee_shift_work_areas_reconciled');
  assert.equal(audit.metadata.employeeId, context.employeeId);
  assert.equal(audit.metadata.source, 'employee_self_edit');
  assert.equal(audit.metadata.originalSegments.length, 1);
  assert.equal(audit.metadata.resultSegments.length, 3);
});

test('Work Area from another Job and cross-tenant Job IDs are rejected', async (t) => {
  const context = await setup(t);
  const wrongArea = splitSegments(context.boundaries);
  wrongArea[1] = { ...wrongArea[1], workAreaId: 'area-job-b' };
  const wrongAreaResult = await reconcile(context, wrongArea);
  assert.equal(wrongAreaResult.statusCode, 400);
  assert.equal(wrongAreaResult.body.code, 'job_work_area_invalid');

  const foreign = splitSegments(context.boundaries).map((segment) => ({ ...segment, jobId: 'job-foreign' }));
  const foreignResult = await reconcile(context, foreign, { clientRequestId: 'foreign-request' });
  assert.equal(foreignResult.statusCode, 400);
  assert.equal(foreignResult.body.code, 'job_work_area_invalid');
});

test('gaps, overlaps, and non-positive durations are rejected', async (t) => {
  const context = await setup(t);
  const gap = splitSegments(context.boundaries);
  gap[1] = { ...gap[1], startAt: iso(Date.parse(context.boundaries.first) + 60_000) };
  assert.equal((await reconcile(context, gap)).body.code, 'shift_timeline_gap');

  const overlap = splitSegments(context.boundaries);
  overlap[1] = { ...overlap[1], startAt: iso(Date.parse(context.boundaries.first) - 60_000) };
  assert.equal((await reconcile(context, overlap, { clientRequestId: 'overlap-request' })).body.code, 'shift_timeline_overlap');

  const zero = splitSegments(context.boundaries);
  zero[1] = { ...zero[1], endAt: zero[1].startAt };
  assert.equal((await reconcile(context, zero, { clientRequestId: 'zero-request' })).body.code, 'shift_timeline_duration_invalid');

  const negative = splitSegments(context.boundaries);
  negative[1] = { ...negative[1], endAt: iso(Date.parse(negative[1].startAt) - 60_000) };
  assert.equal((await reconcile(context, negative, { clientRequestId: 'negative-request' })).body.code, 'shift_timeline_duration_invalid');
});

test('overall shift boundaries cannot be changed', async (t) => {
  const context = await setup(t);
  const changedStart = splitSegments(context.boundaries);
  changedStart[0] = { ...changedStart[0], startAt: iso(Date.parse(context.boundaries.start) + 60_000) };
  assert.equal((await reconcile(context, changedStart)).body.code, 'shift_timeline_gap');

  const closedEnd = splitSegments(context.boundaries);
  closedEnd[2] = { ...closedEnd[2], endAt: iso(Date.now() - 60_000) };
  assert.equal((await reconcile(context, closedEnd, { clientRequestId: 'closed-end-request' })).body.code, 'shift_timeline_gap');
});

for (const layout of ['drive_time', 'non_billable']) {
  test(`locked ${layout} boundaries cannot be altered`, async (t) => {
    const context = await setup(t, { layout });
    const valid = [
      { jobId: 'job-a', workAreaId: 'area-excavation', startAt: context.boundaries.start, endAt: context.boundaries.first },
      { jobId: 'job-a', workAreaId: 'area-grading', startAt: context.boundaries.second, endAt: null },
    ];
    const changed = valid.map((segment) => ({ ...segment }));
    changed[0].endAt = context.boundaries.second;
    const result = await reconcile(context, changed);
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.code, 'shift_timeline_boundary_locked');
    const locked = [...context.store.values()].find((item) => item.entityType === 'TIME_ENTRY' && item.workType === layout);
    assert.equal(locked.clockIn, context.boundaries.first);
    assert.equal(locked.clockOut, context.boundaries.second);
  });
}

test('a concurrent Switch Activity produces a revision conflict', async (t) => {
  const context = await setup(t);
  const current = await currentTimeline(context);
  context.state.beforeTransaction = () => {
    const old = context.store.get(key(context.pk, 'TIME#entry-1'));
    old.clockOut = context.boundaries.first;
    old.status = 'clocked_out';
    const next = {
      ...old, SK: 'TIME#entry-concurrent', entryId: 'entry-concurrent', clockIn: context.boundaries.first,
      clockOut: undefined, status: 'clocked_in', workAreaId: 'area-base', workAreaNameSnapshot: 'Base Prep',
      createdAt: context.boundaries.first, updatedAt: context.boundaries.first,
    };
    context.store.set(key(context.pk, next.SK), next);
    const lock = context.store.get(key(`${context.pk}#EMPLOYEE#${context.employeeId}`, 'ACTIVE_SHIFT'));
    lock.activeEntryId = next.entryId;
    lock.updatedAt = context.boundaries.first;
  };

  const result = await request(context.token, {
    action: 'reconcile-current-shift-work-areas',
    body: { clientRequestId: 'stale-switch', timelineRevision: current.body.timelineRevision, segments: splitSegments(context.boundaries) },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'shift_timeline_changed');
});

test('a concurrent Clock Out closes self-service editing', async (t) => {
  const context = await setup(t);
  const current = await currentTimeline(context);
  context.state.beforeTransaction = () => {
    const entry = context.store.get(key(context.pk, 'TIME#entry-1'));
    entry.clockOut = iso(Date.now());
    entry.status = 'clocked_out';
    context.store.delete(key(`${context.pk}#EMPLOYEE#${context.employeeId}`, 'ACTIVE_SHIFT'));
  };
  const result = await request(context.token, {
    action: 'reconcile-current-shift-work-areas',
    body: { clientRequestId: 'stale-clock-out', timelineRevision: current.body.timelineRevision, segments: splitSegments(context.boundaries) },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'shift_timeline_changed');
});

test('idempotent retry returns the same timeline without duplicate entries', async (t) => {
  const context = await setup(t);
  const current = await currentTimeline(context);
  const body = {
    clientRequestId: 'stable-retry', timelineRevision: current.body.timelineRevision, segments: splitSegments(context.boundaries),
  };
  const first = await request(context.token, { action: 'reconcile-current-shift-work-areas', body });
  const second = await request(context.token, { action: 'reconcile-current-shift-work-areas', body });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal([...context.store.values()].filter((item) => item.entityType === 'TIME_ENTRY').length, 3);
  assert.equal([...context.store.values()].filter((item) => item.entityType === 'AUDIT_EVENT').length, 1);
});

test('transaction failure leaves the original timeline intact', async (t) => {
  const context = await setup(t);
  context.state.failNextTransaction = true;
  const result = await reconcile(context, splitSegments(context.boundaries));
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'shift_timeline_changed');
  assert.equal(context.store.has(key(context.pk, 'TIME#entry-1')), true);
  assert.equal([...context.store.values()].filter((item) => item.entityType === 'TIME_ENTRY').length, 1);
  assert.equal([...context.store.values()].some((item) => item.entityType === 'AUDIT_EVENT'), false);
});

test('resulting authoritative segments aggregate expected Work Area actual hours', async (t) => {
  const context = await setup(t);
  await reconcile(context, splitSegments(context.boundaries));
  const allocationEnd = Date.parse(context.boundaries.start) + 8 * 60 * 60_000;
  const storedEntries = [...context.store.values()]
    .filter((item) => item.entityType === 'TIME_ENTRY')
    .sort((left, right) => Date.parse(left.clockIn) - Date.parse(right.clockIn));
  const hoursByArea = Object.fromEntries(storedEntries.map((entry) => [
    entry.workAreaId,
    ((entry.clockOut ? Date.parse(entry.clockOut) : allocationEnd) - Date.parse(entry.clockIn)) / 3_600_000,
  ]));
  assert.deepEqual(hoursByArea, { 'area-excavation': 2, 'area-base': 3, 'area-grading': 3 });
});

test('previous completed shifts cannot be self-edited', async (t) => {
  const context = await setup(t, { active: false });
  const current = await currentTimeline(context);
  assert.equal(current.statusCode, 409);
  assert.equal(current.body.code, 'current_shift_not_active');
  const reconcileResult = await request(context.token, {
    action: 'reconcile-current-shift-work-areas',
    body: {
      clientRequestId: 'completed-shift-request',
      timelineRevision: 'completed-shift-revision',
      segments: splitSegments(context.boundaries),
    },
  });
  assert.equal(reconcileResult.statusCode, 409);
  assert.equal(reconcileResult.body.code, 'current_shift_not_active');
});
