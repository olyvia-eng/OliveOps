import test from 'node:test';
import assert from 'node:assert/strict';

import { createTimeCorrectionsHandler } from '../api/_lib/timeCorrectionsHandler.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function baseSession(role = 'crew_member') {
  return {
    id: `user-${role}`,
    name: `User ${role}`,
    email: `${role}@example.com`,
    role,
    businessId: 'biz-1',
    employeeId: role === 'crew_member' ? 'emp-1' : 'emp-admin',
  };
}

function createHarness({ sessionRole = 'crew_member', employeePaidDriveTimeEnabled = false } = {}) {
  const corrections = [];
  const timeEntries = [
    {
      id: 'entry-1',
      employeeId: 'emp-1',
      jobId: 'job-1',
      jobIds: ['job-1'],
      workType: 'job',
      clockIn: '2026-08-06T12:00:00.000Z',
      clockOut: '2026-08-06T20:30:00.000Z',
      breakMinutes: 0,
      notes: 'Raw notes',
      status: 'clocked_out',
    },
  ];
  const jobs = [
    { id: 'job-1', title: 'Job 1', assignedEmployeeIds: ['emp-1'] },
    { id: 'job-2', title: 'Job 2', assignedEmployeeIds: ['emp-1'] },
    { id: 'job-other', title: 'Other Job', assignedEmployeeIds: ['emp-2'] },
  ];
  const unbillableCategories = [
    { id: 'cat-training', name: 'Training', active: true },
    { id: 'cat-archived', name: 'Archived', active: false },
  ];
  const employees = [
    { id: 'emp-1', paidDriveTimeEnabled: employeePaidDriveTimeEnabled },
    { id: 'emp-admin', paidDriveTimeEnabled: true },
  ];

  const requireSession = async () => baseSession(sessionRole);
  const listTimeCorrectionsForBusiness = async () => [...corrections];
  const getTimeCorrectionForBusiness = async (_businessId, correctionId) => corrections.find((item) => item.id === correctionId) ?? null;
  const getTimeEntryForBusiness = async (_businessId, entryId) => timeEntries.find((item) => item.id === entryId) ?? null;
  const getEmployeeForBusiness = async (_businessId, employeeId) => employees.find((item) => item.id === employeeId) ?? null;
  const getJobForBusiness = async (_businessId, jobId) => jobs.find((item) => item.id === jobId) ?? null;
  const getUnbillableTimeCategoryForBusiness = async (_businessId, categoryId) => (
    unbillableCategories.find((item) => item.id === categoryId) ?? null
  );
  const listTimeEntriesForBusiness = async () => [...timeEntries];
  const listCrewsForBusiness = async () => [];

  const createTimeCorrectionForBusiness = async ({ correction }) => {
    corrections.push(correction);
    return { ok: true };
  };

  const approveTimeCorrectionForBusiness = async ({ correction, reviewerUserId, reviewNote, reviewedAt, createdTimeEntry }) => {
    const target = corrections.find((item) => item.id === correction.id);
    if (!target) return { ok: false, code: 'CONFLICT' };
    if (target.status !== 'pending') return { ok: false, code: 'CONFLICT' };

    target.status = 'approved';
    target.reviewedByUserId = reviewerUserId;
    target.reviewedAt = reviewedAt;
    target.reviewNote = reviewNote;
    target.updatedAt = reviewedAt;

    if (createdTimeEntry) {
      timeEntries.push(createdTimeEntry);
    }

    return { ok: true, eventId: `audit-${target.id}` };
  };

  const rejectTimeCorrectionForBusiness = async ({ correction, reviewerUserId, reviewNote, reviewedAt }) => {
    const target = corrections.find((item) => item.id === correction.id);
    if (!target) return { ok: false, code: 'CONFLICT' };
    if (target.status !== 'pending') return { ok: false, code: 'CONFLICT' };

    target.status = 'rejected';
    target.reviewedByUserId = reviewerUserId;
    target.reviewedAt = reviewedAt;
    target.reviewNote = reviewNote;
    target.updatedAt = reviewedAt;
    return { ok: true, eventId: `audit-${target.id}` };
  };

  const handler = createTimeCorrectionsHandler({
    requireSession,
    createTimeCorrectionForBusiness,
    listTimeCorrectionsForBusiness,
    getTimeCorrectionForBusiness,
    getTimeEntryForBusiness,
    getJobForBusiness,
    getUnbillableTimeCategoryForBusiness,
    getEmployeeForBusiness,
    approveTimeCorrectionForBusiness,
    rejectTimeCorrectionForBusiness,
    listTimeEntriesForBusiness,
    listCrewsForBusiness,
  });

  return { handler, corrections, timeEntries };
}

test('employee submits forgot clock-out correction and original punch is preserved on request', async () => {
  const { handler, corrections } = createHarness();
  const req = {
    method: 'POST',
    query: { action: 'create' },
    body: {
      timeEntryId: 'entry-1',
      requestType: 'forgot_clock_out',
      requestedClockOutAt: '2026-08-06T16:30:00.000Z',
      reason: 'Finished at 4:30 PM',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].status, 'pending');
  assert.equal(corrections[0].originalClockOutAt, '2026-08-06T20:30:00.000Z');
});

test('employee cannot approve correction requests', async () => {
  const { handler, corrections } = createHarness();
  corrections.push({
    id: 'corr-1',
    employeeId: 'emp-1',
    timeEntryId: 'entry-1',
    requestType: 'wrong_time',
    status: 'pending',
    reason: 'Wrong end time',
    submittedByUserId: 'user-crew_member',
    submittedAt: '2026-08-07T00:00:00.000Z',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  });

  const req = { method: 'POST', query: { action: 'approve' }, body: { id: 'corr-1' } };
  const res = createMockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
});

test('employee effective time history excludes another employee entries', async () => {
  const { handler, timeEntries } = createHarness();
  timeEntries.push({
    id: 'entry-other',
    employeeId: 'emp-2',
    workType: 'job',
    clockIn: '2026-08-06T12:00:00.000Z',
    clockOut: '2026-08-06T20:00:00.000Z',
    status: 'clocked_out',
  });

  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'effective-time-entries' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map((entry) => entry.id), ['entry-1']);
});

test('employee cannot submit a correction using another employee or unauthorized job', async () => {
  const { handler, timeEntries } = createHarness();
  timeEntries.push({
    id: 'entry-other', employeeId: 'emp-2', jobId: 'job-other', jobIds: ['job-other'], workType: 'job',
    clockIn: '2026-08-06T12:00:00.000Z', clockOut: '2026-08-06T20:00:00.000Z', status: 'clocked_out',
  });

  const otherEntry = createMockRes();
  await handler({ method: 'POST', query: { action: 'create' }, body: { timeEntryId: 'entry-other', requestType: 'wrong_time', reason: 'attack' } }, otherEntry);
  const otherJob = createMockRes();
  await handler({ method: 'POST', query: { action: 'create' }, body: { timeEntryId: 'entry-1', requestType: 'wrong_job', requestedActivityType: 'job', requestedJobId: 'job-other', reason: 'attack' } }, otherJob);

  assert.equal(otherEntry.statusCode, 403);
  assert.equal(otherJob.statusCode, 403);
});

test('owner can approve and duplicate approval is idempotent', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'owner', employeePaidDriveTimeEnabled: true });
  corrections.push({
    id: 'corr-2',
    employeeId: 'emp-1',
    timeEntryId: 'entry-1',
    requestType: 'wrong_job',
    status: 'pending',
    requestedJobId: 'job-2',
    requestedActivityType: 'job',
    reason: 'Worked on other site',
    submittedByUserId: 'user-crew_member',
    submittedAt: '2026-08-07T00:00:00.000Z',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  });

  const approveReq = { method: 'POST', query: { action: 'approve' }, body: { id: 'corr-2' } };
  const first = createMockRes();
  await handler(approveReq, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.correction.status, 'approved');

  const second = createMockRes();
  await handler(approveReq, second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.idempotent, true);
});

test('rejected request cannot later be approved', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'owner' });
  corrections.push({
    id: 'corr-3',
    employeeId: 'emp-1',
    timeEntryId: 'entry-1',
    requestType: 'wrong_time',
    status: 'pending',
    reason: 'Wrong break',
    submittedByUserId: 'user-crew_member',
    submittedAt: '2026-08-07T00:00:00.000Z',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  });

  const rejectReq = { method: 'POST', query: { action: 'reject' }, body: { id: 'corr-3', reviewNote: 'Not enough detail' } };
  const rejectRes = createMockRes();
  await handler(rejectReq, rejectRes);
  assert.equal(rejectRes.statusCode, 200);
  assert.equal(rejectRes.body.correction.status, 'rejected');

  const approveReq = { method: 'POST', query: { action: 'approve' }, body: { id: 'corr-3' } };
  const approveRes = createMockRes();
  await handler(approveReq, approveRes);
  assert.equal(approveRes.statusCode, 409);
});

test('cross-business style wrong job reference is rejected on approval revalidation', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'owner' });
  corrections.push({
    id: 'corr-4',
    employeeId: 'emp-1',
    timeEntryId: 'entry-1',
    requestType: 'wrong_job',
    status: 'pending',
    requestedJobId: 'job-outside',
    requestedActivityType: 'job',
    reason: 'Move to another job',
    submittedByUserId: 'user-crew_member',
    submittedAt: '2026-08-07T00:00:00.000Z',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  });

  const approveReq = { method: 'POST', query: { action: 'approve' }, body: { id: 'corr-4' } };
  const res = createMockRes();
  await handler(approveReq, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
});

test('drive time correction is approved regardless of legacy employee drive-time flag', async () => {
  {
    const { handler, corrections } = createHarness({ sessionRole: 'owner', employeePaidDriveTimeEnabled: false });
    corrections.push({
      id: 'corr-drive-1',
      employeeId: 'emp-1',
      timeEntryId: 'entry-1',
      requestType: 'wrong_activity',
      status: 'pending',
      requestedActivityType: 'drive_time',
      requestedClockInAt: '2026-08-06T17:00:00.000Z',
      requestedClockOutAt: '2026-08-06T17:20:00.000Z',
      reason: 'Was driving between jobs',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T00:00:00.000Z',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    });
    const res = createMockRes();
    await handler({ method: 'POST', query: { action: 'approve' }, body: { id: 'corr-drive-1' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.correction.status, 'approved');
  }

  {
    const { handler, corrections } = createHarness({ sessionRole: 'owner', employeePaidDriveTimeEnabled: true });
    corrections.push({
      id: 'corr-drive-2',
      employeeId: 'emp-1',
      timeEntryId: 'entry-1',
      requestType: 'wrong_activity',
      status: 'pending',
      requestedActivityType: 'drive_time',
      requestedClockInAt: '2026-08-06T17:00:00.000Z',
      requestedClockOutAt: '2026-08-06T17:20:00.000Z',
      reason: 'Was driving between jobs',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T00:00:00.000Z',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    });
    const res = createMockRes();
    await handler({ method: 'POST', query: { action: 'approve' }, body: { id: 'corr-drive-2' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.correction.status, 'approved');
  }
});

test('non-billable correction request requires active unbillable category', async () => {
  {
    const { handler } = createHarness({ sessionRole: 'crew_member' });
    const req = {
      method: 'POST',
      query: { action: 'create' },
      body: {
        timeEntryId: 'entry-1',
        requestType: 'wrong_activity',
        requestedActivityType: 'non_billable',
        reason: 'Field training',
      },
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Non-billable corrections require an unbillable category.');
  }

  {
    const { handler } = createHarness({ sessionRole: 'crew_member' });
    const req = {
      method: 'POST',
      query: { action: 'create' },
      body: {
        timeEntryId: 'entry-1',
        requestType: 'wrong_activity',
        requestedActivityType: 'non_billable',
        requestedUnbillableCategoryId: 'cat-archived',
        reason: 'Field training',
      },
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Unbillable category is invalid or inactive.');
  }
});

test('owner approval preserves non-billable category fields on correction', async () => {
  const { handler } = createHarness({ sessionRole: 'owner' });

  const createReq = {
    method: 'POST',
    query: { action: 'create' },
    body: {
      timeEntryId: 'entry-1',
      requestType: 'wrong_activity',
      requestedActivityType: 'non_billable',
      requestedUnbillableCategoryId: 'cat-training',
      reason: 'Training time',
    },
  };
  const createRes = createMockRes();
  await handler(createReq, createRes);
  assert.equal(createRes.statusCode, 200);

  const approveReq = {
    method: 'POST',
    query: { action: 'approve' },
    body: { id: createRes.body.correction.id },
  };
  const res = createMockRes();
  await handler(approveReq, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.correction.status, 'approved');
  assert.equal(res.body.correction.requestedUnbillableCategoryId, 'cat-training');
  assert.equal(res.body.correction.requestedUnbillableCategoryName, 'Training');
});

test('forgot clock-in request without existing entry creates historical segment on approval', async () => {
  const { handler, corrections, timeEntries } = createHarness({ sessionRole: 'owner' });

  const createReq = {
    method: 'POST',
    query: { action: 'create' },
    body: {
      employeeId: 'emp-1',
      requestType: 'forgot_clock_in',
      requestedClockInAt: '2026-08-06T07:58:00.000Z',
      requestedClockOutAt: '2026-08-06T16:15:00.000Z',
      requestedJobId: 'job-1',
      requestedActivityType: 'job',
      reason: 'Forgot to clock in at shift start',
    },
  };
  const createRes = createMockRes();
  await handler(createReq, createRes);

  assert.equal(createRes.statusCode, 200);
  const correctionId = createRes.body.correction.id;

  const approveRes = createMockRes();
  await handler({ method: 'POST', query: { action: 'approve' }, body: { id: correctionId } }, approveRes);
  assert.equal(approveRes.statusCode, 200);
  assert.ok(approveRes.body.createdTimeEntry);

  const created = timeEntries.find((entry) => entry.id === approveRes.body.createdTimeEntry.id);
  assert.ok(created);
  assert.equal(created.status, 'clocked_out');
  assert.equal(created.clockIn, '2026-08-06T07:58:00.000Z');
  assert.equal(created.clockOut, '2026-08-06T16:15:00.000Z');

  const approvedCorrection = corrections.find((item) => item.id === correctionId);
  assert.equal(approvedCorrection.status, 'approved');
});

test('employee list view only returns own corrections when mine=true', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'crew_member' });
  corrections.push(
    {
      id: 'corr-self',
      employeeId: 'emp-1',
      requestType: 'wrong_time',
      status: 'pending',
      reason: 'self',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T00:00:00.000Z',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    },
    {
      id: 'corr-other',
      employeeId: 'emp-2',
      requestType: 'wrong_time',
      status: 'pending',
      reason: 'other',
      submittedByUserId: 'user-other',
      submittedAt: '2026-08-07T00:00:00.000Z',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    }
  );

  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'list', mine: 'true' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].id, 'corr-self');
});

test('split activity requests can be submitted but approval is blocked in v1', async () => {
  const { handler } = createHarness({ sessionRole: 'owner' });

  const createRes = createMockRes();
  await handler({
    method: 'POST',
    query: { action: 'create' },
    body: {
      timeEntryId: 'entry-1',
      requestType: 'split_activity',
      requestedSegments: [
        {
          id: 'seg-1',
          startAt: '2026-08-06T12:00:00.000Z',
          endAt: '2026-08-06T16:00:00.000Z',
          requestedActivityType: 'job',
          requestedJobId: 'job-1',
        },
        {
          id: 'seg-2',
          startAt: '2026-08-06T16:00:00.000Z',
          endAt: '2026-08-06T16:25:00.000Z',
          requestedActivityType: 'drive_time',
        },
      ],
      reason: 'Need to split drive time',
    },
  }, createRes);
  assert.equal(createRes.statusCode, 200);

  const approveRes = createMockRes();
  await handler({ method: 'POST', query: { action: 'approve' }, body: { id: createRes.body.correction.id } }, approveRes);
  assert.equal(approveRes.statusCode, 409);
});

test('notifications action returns pending correction count and newest-first items', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'owner' });
  corrections.push(
    {
      id: 'corr-notify-1',
      employeeId: 'emp-1',
      timeEntryId: 'entry-1',
      requestType: 'wrong_time',
      status: 'pending',
      requestedClockOutAt: '2026-08-06T16:30:00.000Z',
      originalClockOutAt: '2026-08-06T22:30:00.000Z',
      reason: 'Left site earlier',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T09:00:00.000Z',
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T09:00:00.000Z',
    },
    {
      id: 'corr-notify-2',
      employeeId: 'emp-1',
      timeEntryId: 'entry-1',
      requestType: 'forgot_clock_in',
      status: 'pending',
      requestedClockInAt: '2026-08-06T07:30:00.000Z',
      requestedClockOutAt: '2026-08-06T16:30:00.000Z',
      reason: 'Missed clock-in',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T11:00:00.000Z',
      createdAt: '2026-08-07T11:00:00.000Z',
      updatedAt: '2026-08-07T11:00:00.000Z',
    }
  );

  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].id, 'corr-notify-2');
  assert.equal(res.body.items[1].id, 'corr-notify-1');
  assert.equal(res.body.items[0].title, 'Time correction requested');
  assert.equal(res.body.items[0].actionable, true);
});

test('notifications exclude approved and rejected corrections', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'owner' });
  corrections.push(
    {
      id: 'corr-pending',
      employeeId: 'emp-1',
      requestType: 'wrong_time',
      status: 'pending',
      reason: 'Pending',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T10:00:00.000Z',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    },
    {
      id: 'corr-approved',
      employeeId: 'emp-1',
      requestType: 'wrong_time',
      status: 'approved',
      reason: 'Approved',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T09:00:00.000Z',
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T09:00:00.000Z',
    },
    {
      id: 'corr-rejected',
      employeeId: 'emp-1',
      requestType: 'wrong_time',
      status: 'rejected',
      reason: 'Rejected',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T08:00:00.000Z',
      createdAt: '2026-08-07T08:00:00.000Z',
      updatedAt: '2026-08-07T08:00:00.000Z',
    }
  );

  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].id, 'corr-pending');
});

test('notifications action is empty for unauthorized employee reviewers', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'crew_member' });
  corrections.push({
    id: 'corr-crew-hidden',
    employeeId: 'emp-1',
    requestType: 'wrong_time',
    status: 'pending',
    reason: 'Hidden from crew notifications',
    submittedByUserId: 'user-crew_member',
    submittedAt: '2026-08-07T09:00:00.000Z',
    createdAt: '2026-08-07T09:00:00.000Z',
    updatedAt: '2026-08-07T09:00:00.000Z',
  });

  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.items, []);
});

test('notifications action returns empty payload when there are no pending corrections', async () => {
  const { handler } = createHarness({ sessionRole: 'owner' });
  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.items, []);
});

test('notifications include correction review deep link href', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'owner' });
  corrections.push({
    id: 'corr-link',
    employeeId: 'emp-1',
    requestType: 'wrong_time',
    status: 'pending',
    reason: 'Deep link check',
    submittedByUserId: 'user-crew_member',
    submittedAt: '2026-08-07T10:15:00.000Z',
    createdAt: '2026-08-07T10:15:00.000Z',
    updatedAt: '2026-08-07T10:15:00.000Z',
  });

  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].href, '/reports/time?correctionStatus=pending&correctionId=corr-link');
});

test('cross-business corrections never appear in notification list', async () => {
  const scopedCorrections = [
    {
      id: 'corr-biz-visible',
      employeeId: 'emp-1',
      requestType: 'wrong_time',
      status: 'pending',
      reason: 'Visible business correction',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T10:00:00.000Z',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    },
  ];

  const handler = createTimeCorrectionsHandler({
    requireSession: async () => baseSession('owner'),
    listTimeCorrectionsForBusiness: async (businessId) => (
      businessId === 'biz-1' ? scopedCorrections : []
    ),
    getEmployeeForBusiness: async () => ({ id: 'emp-1', name: 'Harvey Field', paidDriveTimeEnabled: true }),
  });

  const res = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.items[0].id, 'corr-biz-visible');
});

test('notifications count updates after approval and rejection', async () => {
  const { handler, corrections } = createHarness({ sessionRole: 'owner' });
  corrections.push(
    {
      id: 'corr-action-1',
      employeeId: 'emp-1',
      timeEntryId: 'entry-1',
      requestType: 'wrong_time',
      status: 'pending',
      reason: 'Approve me',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T10:00:00.000Z',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    },
    {
      id: 'corr-action-2',
      employeeId: 'emp-1',
      timeEntryId: 'entry-1',
      requestType: 'wrong_time',
      status: 'pending',
      reason: 'Reject me',
      submittedByUserId: 'user-crew_member',
      submittedAt: '2026-08-07T11:00:00.000Z',
      createdAt: '2026-08-07T11:00:00.000Z',
      updatedAt: '2026-08-07T11:00:00.000Z',
    }
  );

  const before = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, before);
  assert.equal(before.body.count, 2);

  await handler({ method: 'POST', query: { action: 'approve' }, body: { id: 'corr-action-1' } }, createMockRes());
  const afterApprove = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, afterApprove);
  assert.equal(afterApprove.body.count, 1);
  assert.equal(afterApprove.body.items[0].id, 'corr-action-2');

  await handler({ method: 'POST', query: { action: 'reject' }, body: { id: 'corr-action-2' } }, createMockRes());
  const afterReject = createMockRes();
  await handler({ method: 'GET', query: { action: 'notifications' } }, afterReject);
  assert.equal(afterReject.body.count, 0);
  assert.deepEqual(afterReject.body.items, []);
});
