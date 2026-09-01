import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTimeEntryMutation, canDirectlyEditTimeEntries } from '../api/_lib/timeEntryMutations.js';

const now = '2026-09-01T18:00:00.000Z';
const session = { id: 'admin-1', name: 'Admin One', email: 'admin@example.com', role: 'admin', businessId: 'biz-1' };

function harness(overrides = {}) {
  const entry = {
    id: 'entry-1', employeeId: 'employee-1', jobId: 'job-1', jobIds: ['job-1'], workType: 'job',
    workAreaId: 'area-1', workAreaNameSnapshot: 'Excavation', clockIn: '2026-09-01T12:00:00.000Z',
    clockOut: '2026-09-01T16:00:00.000Z', breakMinutes: 0, notes: 'Original', status: 'clocked_out',
    createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T16:00:00.000Z',
  };
  const entries = [entry, ...(overrides.entries ?? [])];
  const jobs = [
    { id: 'job-1', operationalWorkAreas: [{ id: 'area-1', name: 'Excavation', status: 'completed' }] },
    { id: 'job-2', operationalWorkAreas: [{ id: 'area-2', name: 'Framing', status: 'in_progress' }] },
  ];
  const transactions = [];
  const dependencies = {
    getTimeEntryForBusiness: async (_businessId, id) => entries.find((item) => item.id === id) ?? null,
    getEmployeeForBusiness: async (_businessId, id) => id === 'employee-1'
      ? { id, compensationType: 'hourly', hourlyRate: 25, payrollBurdenPct: 20 }
      : null,
    getJobForBusiness: async (_businessId, id) => jobs.find((item) => item.id === id) ?? null,
    getUnbillableTimeCategoryForBusiness: async (_businessId, id) => id === 'category-1' ? { id, name: 'Training', active: true } : null,
    listTimeEntriesForBusiness: async () => entries,
    getPendingClockOutWorkflowForEmployee: async () => overrides.pendingClockOut ?? null,
    transactWrite: async (input) => {
      if (overrides.failTransaction) throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' });
      transactions.push(input);
    },
  };
  const apply = (changes, options = {}) => applyTimeEntryMutation({
    session,
    timeEntryId: entry.id,
    expectedUpdatedAt: options.expectedUpdatedAt ?? entry.updatedAt ?? null,
    changes: {
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      workType: entry.workType,
      jobId: entry.jobId,
      workAreaId: entry.workAreaId,
      notes: entry.notes,
      ...changes,
    },
    reason: options.reason ?? 'Supervisor correction',
    now,
    dependencies,
  });
  return { entry, entries, jobs, transactions, apply };
}

test('direct Time Entry editing is restricted to Owner and Admin', () => {
  assert.equal(canDirectlyEditTimeEntries({ role: 'owner' }), true);
  assert.equal(canDirectlyEditTimeEntries({ role: 'admin' }), true);
  assert.equal(canDirectlyEditTimeEntries({ role: 'foreman' }), false);
  assert.equal(canDirectlyEditTimeEntries({ role: 'crew_member' }), false);
});

test('admin edits times, recomputes labour cost, and writes old/new audit values atomically', async () => {
  const context = harness();
  const result = await context.apply({
    clockIn: '2026-09-01T11:00:00.000Z',
    clockOut: '2026-09-01T17:00:00.000Z',
    notes: 'Corrected shift',
  });
  assert.equal(result.ok, true);
  assert.equal(result.timeEntry.clockIn, '2026-09-01T11:00:00.000Z');
  assert.equal(result.timeEntry.clockOut, '2026-09-01T17:00:00.000Z');
  assert.equal(result.timeEntry.labourCostRateSnapshot, 30);
  assert.equal(result.timeEntry.labourCostTotalSnapshot, 180);
  const [timeEntryWrite, auditWrite] = context.transactions[0].TransactItems;
  assert.equal(timeEntryWrite.Put.Item.updatedAt, now);
  assert.equal(timeEntryWrite.Put.ConditionExpression.includes('#updatedAt = :expectedUpdatedAt'), true);
  assert.equal(auditWrite.Put.Item.action, 'time_entry_edited');
  assert.equal(auditWrite.Put.Item.metadata.oldValues.clockIn, context.entry.clockIn);
  assert.equal(auditWrite.Put.Item.metadata.newValues.clockOut, '2026-09-01T17:00:00.000Z');
  assert.equal(auditWrite.Put.Item.metadata.reason, 'Supervisor correction');
});

test('admin changes Job and derives historical Work Area snapshot from operational data', async () => {
  const context = harness();
  const result = await context.apply({ jobId: 'job-2', workAreaId: 'area-2' });
  assert.equal(result.ok, true);
  assert.equal(result.timeEntry.jobId, 'job-2');
  assert.deepEqual(result.timeEntry.jobIds, ['job-2']);
  assert.equal(result.timeEntry.workAreaId, 'area-2');
  assert.equal(result.timeEntry.workAreaNameSnapshot, 'Framing');
});

test('duration edits preserve the captured historical labour rate', async () => {
  const context = harness();
  context.entry.labourCostRateSnapshot = 40;
  const result = await context.apply({ clockIn: '2026-09-01T11:00:00.000Z', clockOut: '2026-09-01T17:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.timeEntry.labourCostRateSnapshot, 40);
  assert.equal(result.timeEntry.labourCostTotalSnapshot, 240);
});

test('legacy null Work Area remains editable and completed operational areas are valid historically', async () => {
  const context = harness();
  context.entry.workAreaId = undefined;
  context.entry.workAreaNameSnapshot = undefined;
  const withoutArea = await context.apply({ workAreaId: null });
  assert.equal(withoutArea.ok, true);
  assert.equal(withoutArea.timeEntry.workAreaId, null);
  const completedArea = await context.apply({ workAreaId: 'area-1' });
  assert.equal(completedArea.ok, true);
  assert.equal(completedArea.timeEntry.workAreaNameSnapshot, 'Excavation');
});

test('invalid, cross-Job, and cross-tenant Work Area references are rejected', async () => {
  const context = harness();
  const fabricated = await context.apply({ workAreaId: 'estimate-area-1' });
  assert.equal(fabricated.code, 'time_entry_work_area_invalid');
  const otherJob = await context.apply({ jobId: 'job-2', workAreaId: 'area-1' });
  assert.equal(otherJob.code, 'time_entry_work_area_invalid');
  const missingTenantJob = await context.apply({ jobId: 'other-business-job', workAreaId: null });
  assert.equal(missingTenantJob.code, 'time_entry_job_invalid');
  assert.equal(context.transactions.length, 0);
});

test('invalid duration, future bounds, and employee overlap are rejected', async () => {
  const overlapping = {
    id: 'entry-2', employeeId: 'employee-1', workType: 'drive_time', clockIn: '2026-09-01T16:30:00.000Z',
    clockOut: '2026-09-01T17:30:00.000Z', breakMinutes: 0, notes: '', status: 'clocked_out',
  };
  const context = harness({ entries: [overlapping] });
  assert.equal((await context.apply({ clockOut: '2026-09-01T11:00:00.000Z' })).code, 'time_entry_duration_invalid');
  assert.equal((await context.apply({ clockIn: '2026-09-02T12:00:00.000Z', clockOut: '2026-09-02T13:00:00.000Z' })).code, 'time_entry_date_out_of_bounds');
  assert.equal((await context.apply({ clockOut: '2026-09-01T17:00:00.000Z' })).code, 'time_entry_overlap');
  assert.equal(context.transactions.length, 0);
});

test('invalid activity and missing tenant employee are rejected', async () => {
  const context = harness();
  assert.equal((await context.apply({ workType: 'invalid', jobId: undefined, workAreaId: undefined })).code, 'time_entry_activity_invalid');
  const missingEmployee = await applyTimeEntryMutation({
    session,
    timeEntryId: context.entry.id,
    expectedUpdatedAt: context.entry.updatedAt,
    changes: context.entry,
    now,
    dependencies: {
      getTimeEntryForBusiness: async () => context.entry,
      getEmployeeForBusiness: async () => null,
    },
  });
  assert.equal(missingEmployee.code, 'time_entry_employee_invalid');
});

test('active entry start and identity can change without fabricating clock-out or breaking status', async () => {
  const context = harness();
  context.entry.status = 'clocked_in';
  context.entry.clockOut = undefined;
  const result = await context.apply({
    clockIn: '2026-09-01T11:30:00.000Z', clockOut: undefined, workType: 'drive_time', jobId: undefined, workAreaId: undefined,
  });
  assert.equal(result.ok, true);
  assert.equal(result.timeEntry.status, 'clocked_in');
  assert.equal(result.timeEntry.clockOut, undefined);
  assert.equal(result.timeEntry.workType, 'drive_time');
  assert.deepEqual(result.timeEntry.jobIds, []);
});

test('active entry cannot be closed by editing or changed during pending clock-out', async () => {
  const context = harness({ pendingClockOut: { timeEntryId: 'entry-1' } });
  context.entry.status = 'clocked_in';
  context.entry.clockOut = undefined;
  assert.equal((await context.apply({ clockOut: '2026-09-01T17:00:00.000Z' })).code, 'active_time_entry_clock_out_forbidden');
  assert.equal((await context.apply({ clockOut: undefined })).code, 'pending_clock_out_conflict');
});

test('stale updatedAt and failed transaction do not produce a mutation or partial audit', async () => {
  const stale = harness();
  const staleResult = await stale.apply({}, { expectedUpdatedAt: '2026-09-01T15:00:00.000Z' });
  assert.equal(staleResult.code, 'time_entry_conflict');
  assert.equal(stale.transactions.length, 0);

  const failed = harness({ failTransaction: true });
  const failedResult = await failed.apply({ notes: 'Must not persist' });
  assert.equal(failedResult.code, 'time_entry_conflict');
  assert.equal(failed.transactions.length, 0);
  assert.equal(failed.entry.notes, 'Original');
});

test('approved employee correction uses the same Time Entry mutation transaction', async () => {
  const context = harness();
  const correction = { id: 'correction-1', status: 'pending', reason: 'Wrong end time' };
  const result = await applyTimeEntryMutation({
    session,
    timeEntryId: context.entry.id,
    expectedUpdatedAt: context.entry.updatedAt,
    changes: { ...context.entry, clockOut: '2026-09-01T17:00:00.000Z' },
    reason: correction.reason,
    correction,
    now,
    dependencies: {
      getTimeEntryForBusiness: async () => context.entry,
      getEmployeeForBusiness: async () => ({ id: 'employee-1', compensationType: 'hourly', hourlyRate: 25, payrollBurdenPct: 20 }),
      getJobForBusiness: async () => context.jobs[0],
      getUnbillableTimeCategoryForBusiness: async () => null,
      listTimeEntriesForBusiness: async () => [context.entry],
      getPendingClockOutWorkflowForEmployee: async () => null,
      transactWrite: async (input) => context.transactions.push(input),
    },
  });
  assert.equal(result.ok, true);
  const transaction = context.transactions[0].TransactItems;
  assert.equal(transaction.length, 3);
  assert.equal(transaction[1].Put.Item.action, 'time_correction_approved');
  assert.equal(transaction[2].Update.ExpressionAttributeValues[':approved'], 'approved');
  assert.equal(transaction[2].Update.ExpressionAttributeValues[':mutationAppliedAt'], now);
});
