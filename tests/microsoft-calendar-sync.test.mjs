import test from 'node:test';
import assert from 'node:assert/strict';
import { syncJobToMicrosoftCalendars } from '../api/_lib/microsoftCalendarSync.js';

const scheduledJob = {
  id: 'job-1',
  title: 'Install fence',
  customerId: 'customer-1',
  startDate: '2026-08-11',
  endDate: '2026-08-11',
  scheduleConfirmed: true,
  scheduleAllDay: true,
  status: 'scheduled',
  assignedEmployeeIds: [],
};

function createDependencies(overrides = {}) {
  const calls = { upserts: [], deletes: [], mappings: [], operations: [] };
  return {
    calls,
    dependencies: {
      listMicrosoftConnectionsForBusiness: async () => [{
        userId: 'admin-1',
        selectedCalendarId: 'calendar-1',
        preferences: { syncOliveOpsJobs: true },
      }],
      listMicrosoftJobMappings: async () => [],
      getCustomerForBusiness: async () => ({ id: 'customer-1', name: 'Customer' }),
      getEmployeeForBusiness: async () => null,
      getValidMicrosoftAccessToken: async () => 'token',
      getApplicationOrigin: () => 'https://app.example.com',
      randomUUID: () => 'operation-1',
      putMicrosoftSyncOperation: async ({ operation }) => calls.operations.push(operation),
      updateMicrosoftSyncOperation: async (operation) => calls.operations.push(operation),
      upsertMicrosoftEvent: async (input) => {
        calls.upserts.push(input);
        return { id: input.microsoftEventId ?? 'immutable-event-1' };
      },
      deleteMicrosoftEvent: async (input) => calls.deletes.push(input),
      putMicrosoftJobMapping: async (mapping) => calls.mappings.push(mapping),
      deleteMicrosoftJobMapping: async (mapping) => calls.mappings.push({ ...mapping, deleted: true }),
      ...overrides,
    },
  };
}

test('confirmed jobs create one event and persist the immutable Graph ID', async () => {
  const { calls, dependencies } = createDependencies();
  const result = await syncJobToMicrosoftCalendars({ businessId: 'business-1', job: scheduledJob, dependencies });
  assert.equal(result[0].ok, true);
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].microsoftEventId, undefined);
  assert.equal(calls.mappings[0].microsoftEventId, 'immutable-event-1');
  assert.match(calls.mappings[0].transactionId, /^[0-9a-f-]{36}$/);
});

test('existing immutable mapping is PATCHed and reused', async () => {
  const mapping = {
    userId: 'admin-1',
    jobId: 'job-1',
    microsoftCalendarId: 'calendar-1',
    microsoftEventId: 'ExistingCaseSensitiveId',
    transactionId: 'existing-transaction',
  };
  const { calls, dependencies } = createDependencies({ listMicrosoftJobMappings: async () => [mapping] });
  await syncJobToMicrosoftCalendars({ businessId: 'business-1', job: scheduledJob, dependencies });
  assert.equal(calls.upserts[0].microsoftEventId, 'ExistingCaseSensitiveId');
  assert.equal(calls.mappings[0].transactionId, 'existing-transaction');
});

test('cancellation deletes existing mappings even when outbound sync is disabled', async () => {
  const mapping = { userId: 'admin-1', jobId: 'job-1', microsoftCalendarId: 'calendar-1', microsoftEventId: 'event-1', transactionId: 'transaction-1' };
  const { calls, dependencies } = createDependencies({
    listMicrosoftConnectionsForBusiness: async () => [{ userId: 'admin-1', selectedCalendarId: 'calendar-1', preferences: { syncOliveOpsJobs: false } }],
    listMicrosoftJobMappings: async () => [mapping],
  });
  await syncJobToMicrosoftCalendars({ businessId: 'business-1', job: { ...scheduledJob, status: 'cancelled' }, dependencies });
  assert.equal(calls.deletes[0].microsoftEventId, 'event-1');
  assert.equal(calls.mappings[0].deleted, true);
});

test('Graph failures are audited and do not reject the OliveOps sync hook', async () => {
  const error = Object.assign(new Error('unavailable'), { status: 503 });
  const { calls, dependencies } = createDependencies({ upsertMicrosoftEvent: async () => { throw error; } });
  const result = await syncJobToMicrosoftCalendars({ businessId: 'business-1', job: scheduledJob, dependencies });
  assert.equal(result[0].ok, false);
  assert.equal(calls.operations.at(-1).status, 'failed');
  assert.equal(calls.operations.at(-1).errorCode, 'HTTP_503');
});