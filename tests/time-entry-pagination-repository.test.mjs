import assert from 'node:assert/strict';
import test from 'node:test';
import { ddb } from '../api/_lib/db.js';
import { listTimeEntryPageForBusiness } from '../api/_lib/authRepo.js';
import { normalizeTimeEntryPageQuery, timeEntryIndexAttributes } from '../api/_lib/timeEntryPagination.js';

function item(id, clockIn, jobIds) {
  const entry = {
    id,
    employeeId: 'employee-1',
    jobId: jobIds[0],
    jobIds,
    workType: 'job',
    clockIn,
    clockOut: new Date(Date.parse(clockIn) + 3_600_000).toISOString(),
    breakMinutes: 0,
    status: 'clocked_out',
    createdAt: clockIn,
  };
  return {
    PK: 'BUSINESS#business-1',
    SK: `TIME#${id}`,
    entityType: 'TIME_ENTRY',
    businessId: 'business-1',
    entryId: id,
    ...entry,
    ...timeEntryIndexAttributes('business-1', entry),
  };
}

test('filtered DynamoDB windows produce stable pages without duplicates or skips', async (t) => {
  const originalSend = ddb.send.bind(ddb);
  const firstWindowKey = { page: 'first-window' };
  const calls = [];
  const newestOtherJob = item('other', '2026-01-04T10:00:00.000Z', ['job-2']);
  const first = item('first', '2026-01-03T10:00:00.000Z', ['job-1']);
  const second = item('second', '2026-01-02T10:00:00.000Z', ['job-1']);
  const third = item('third', '2026-01-01T10:00:00.000Z', ['job-1']);

  ddb.send = async (command) => {
    calls.push(command.input);
    const start = command.input.ExclusiveStartKey;
    if (!start) return { Items: [newestOtherJob, first], LastEvaluatedKey: firstWindowKey };
    if (start === firstWindowKey) return { Items: [second, third] };
    if (start.SK === second.SK) return { Items: [third] };
    return { Items: [] };
  };
  t.after(() => { ddb.send = originalSend; });

  const { filters } = normalizeTimeEntryPageQuery({ jobId: 'job-1', limit: '25' }, { surface: 'reports', businessId: 'business-1' });
  const firstPage = await listTimeEntryPageForBusiness({ businessId: 'business-1', filters, limit: 2 });
  const secondPage = await listTimeEntryPageForBusiness({ businessId: 'business-1', filters, limit: 2, exclusiveStartKey: firstPage.lastEvaluatedKey });

  assert.deepEqual(firstPage.items.map((entry) => entry.id), ['first', 'second']);
  assert.deepEqual(secondPage.items.map((entry) => entry.id), ['third']);
  assert.equal(firstPage.hasMore, true);
  assert.equal(secondPage.hasMore, false);
  assert.equal(new Set([...firstPage.items, ...secondPage.items].map((entry) => entry.id)).size, 3);
  assert.equal(calls.every((input) => input.IndexName === 'TimeEntryChronologicalIndex' && input.ScanIndexForward === false), true);
});