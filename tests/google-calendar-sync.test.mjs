import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isGoogleSyncEligibleJob,
  reconcileGoogleJobsForUser,
  syncJobToGoogleCalendars,
} from '../api/_lib/googleCalendarSync.js';

const scheduledJob = {
  id: 'job-1',
  customerId: 'customer-1',
  title: 'Roof repair',
  status: 'scheduled',
  startDate: '2026-08-11',
  endDate: '2026-08-11',
  scheduleConfirmed: true,
  scheduleAllDay: true,
  assignedEmployeeIds: [],
};

function createDependencies(overrides = {}) {
  const calls = { upserts: [], deletes: [], mappings: [], operations: [], updates: [] };
  const dependencies = {
    listGoogleConnectionsForBusiness: async () => [
      { userId: 'user-1', selectedCalendarId: 'primary', preferences: { syncOliveOpsJobs: true } },
    ],
    listGoogleJobMappings: async () => [],
    getCustomerForBusiness: async () => ({ name: 'Taylor Residence' }),
    getEmployeeForBusiness: async () => null,
    getValidGoogleAccessToken: async () => 'access-token',
    putGoogleSyncOperation: async (input) => calls.operations.push(input),
    updateGoogleSyncOperation: async (input) => calls.updates.push(input),
    putGoogleJobMapping: async (input) => calls.mappings.push(input),
    upsertGoogleEvent: async (input) => calls.upserts.push(input),
    deleteGoogleEvent: async (input) => calls.deletes.push(input),
    applicationOrigin: () => 'https://app.oliveops.com',
    randomUUID: () => `operation-${calls.operations.length + 1}`,
    ...overrides,
  };
  return { calls, dependencies };
}

test('confirmed jobs create one deterministic event per enabled connection', async () => {
  const { calls, dependencies } = createDependencies({
    listGoogleConnectionsForBusiness: async () => [
      { userId: 'user-1', selectedCalendarId: 'primary', preferences: { syncOliveOpsJobs: true } },
      { userId: 'user-2', selectedCalendarId: 'team', preferences: { syncOliveOpsJobs: true } },
      { userId: 'user-3', selectedCalendarId: 'other', preferences: { syncOliveOpsJobs: false } },
    ],
  });
  await syncJobToGoogleCalendars({ businessId: 'business-1', job: scheduledJob, dependencies });

  assert.equal(calls.upserts.length, 2);
  assert.equal(calls.mappings.length, 2);
  assert.notEqual(calls.upserts[0].googleEventId, calls.upserts[1].googleEventId);
  assert.equal(calls.updates.every((update) => update.status === 'completed'), true);
});

test('existing mapping is reused on job update to prevent duplicates', async () => {
  const { calls, dependencies } = createDependencies({
    listGoogleJobMappings: async () => [{
      userId: 'user-1',
      googleCalendarId: 'primary',
      googleEventId: 'existing-google-event',
    }],
  });
  await syncJobToGoogleCalendars({ businessId: 'business-1', job: scheduledJob, dependencies });
  assert.equal(calls.upserts[0].googleEventId, 'existing-google-event');
});

test('job deletion removes mapped events for enabled connections', async () => {
  const { calls, dependencies } = createDependencies({
    listGoogleJobMappings: async () => [{
      userId: 'user-1',
      googleCalendarId: 'primary',
      googleEventId: 'mapped-event',
    }],
  });
  await syncJobToGoogleCalendars({ businessId: 'business-1', job: scheduledJob, action: 'delete', dependencies });
  assert.equal(calls.deletes.length, 1);
  assert.equal(calls.deletes[0].googleEventId, 'mapped-event');
  assert.equal(calls.upserts.length, 0);
});

test('Google failure is recorded without rejecting the OliveOps synchronization hook', async () => {
  const { calls, dependencies } = createDependencies({
    upsertGoogleEvent: async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); },
  });
  const result = await syncJobToGoogleCalendars({ businessId: 'business-1', job: scheduledJob, dependencies });
  assert.deepEqual(result, [{ ok: false }]);
  assert.equal(calls.updates.at(-1).status, 'failed');
  assert.equal(calls.updates.at(-1).errorCode, 'HTTP_503');
});

test('cancelled and unconfirmed jobs are not eligible for outbound creation', () => {
  assert.equal(isGoogleSyncEligibleJob(scheduledJob), true);
  assert.equal(isGoogleSyncEligibleJob({ ...scheduledJob, status: 'cancelled' }), false);
  assert.equal(isGoogleSyncEligibleJob({ ...scheduledJob, scheduleConfirmed: false }), false);
});

test('reconciliation targets only the selected connected user', async () => {
  const { calls, dependencies } = createDependencies({
    listJobsForBusiness: async () => [scheduledJob],
    listGoogleConnectionsForBusiness: async () => [
      { userId: 'user-1', selectedCalendarId: 'primary', preferences: { syncOliveOpsJobs: true } },
      { userId: 'user-2', selectedCalendarId: 'team', preferences: { syncOliveOpsJobs: true } },
    ],
  });
  await reconcileGoogleJobsForUser({ businessId: 'business-1', userId: 'user-2', dependencies });
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.operations[0].operation.userId, 'user-2');
});