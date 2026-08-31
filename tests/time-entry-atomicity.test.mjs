import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClockInTransaction,
  buildClockOutTransaction,
  buildSwitchActivityTransaction,
  getClockingErrorResponse,
  getClockingFailureResponse,
  OFFLINE_EVENT_MAX_AGE_MS,
  OFFLINE_EVENT_MAX_FUTURE_SKEW_MS,
  resolveClockingEventTime,
  resolveClockOutActiveShift,
} from '../api/_lib/clocking.js';
import { getBusinessPeriodKeys } from '../api/_lib/businessTime.js';

test('clocking event time defaults to the authoritative server receipt instant', () => {
  const result = resolveClockingEventTime({ serverReceivedAt: '2026-08-20T18:00:00.000Z' });
  assert.deepEqual(result, {
    ok: true,
    eventOccurredAt: '2026-08-20T18:00:00.000Z',
    serverReceivedAt: '2026-08-20T18:00:00.000Z',
    timestampSource: 'server',
    timestampDeltaMs: 0,
  });
});

test('clocking event time accepts absolute client instants within the offline window', () => {
  const result = resolveClockingEventTime({
    clientOccurredAt: '2026-08-20T12:32:00-04:00',
    serverReceivedAt: '2026-08-20T18:00:00.000Z',
  });
  assert.equal(result.ok, true);
  assert.equal(result.eventOccurredAt, '2026-08-20T16:32:00.000Z');
  assert.equal(result.timestampSource, 'client');
});

test('clocking event time rejects ambiguous, malformed, stale, and excessively future values', () => {
  assert.equal(resolveClockingEventTime({ clientOccurredAt: '2026-08-20T16:32:00', serverReceivedAt: '2026-08-20T18:00:00.000Z' }).code, 'offline_event_invalid_timestamp');
  assert.equal(resolveClockingEventTime({ clientOccurredAt: 'not-a-date', serverReceivedAt: '2026-08-20T18:00:00.000Z' }).code, 'offline_event_invalid_timestamp');
  assert.equal(resolveClockingEventTime({ clientOccurredAt: new Date(Date.parse('2026-08-20T18:00:00.000Z') - OFFLINE_EVENT_MAX_AGE_MS - 1).toISOString(), serverReceivedAt: '2026-08-20T18:00:00.000Z' }).code, 'offline_event_too_old');
  assert.equal(resolveClockingEventTime({ clientOccurredAt: new Date(Date.parse('2026-08-20T18:00:00.000Z') + OFFLINE_EVENT_MAX_FUTURE_SKEW_MS + 1).toISOString(), serverReceivedAt: '2026-08-20T18:00:00.000Z' }).code, 'offline_event_in_future');
});

test('clocking event time permits exact bounds and four minutes of future skew', () => {
  const receipt = Date.parse('2026-08-20T18:00:00.000Z');
  assert.equal(resolveClockingEventTime({ clientOccurredAt: new Date(receipt - OFFLINE_EVENT_MAX_AGE_MS).toISOString(), serverReceivedAt: new Date(receipt).toISOString() }).ok, true);
  assert.equal(resolveClockingEventTime({ clientOccurredAt: new Date(receipt + 4 * 60 * 1000).toISOString(), serverReceivedAt: new Date(receipt).toISOString() }).ok, true);
  assert.equal(resolveClockingEventTime({ clientOccurredAt: new Date(receipt + OFFLINE_EVENT_MAX_FUTURE_SKEW_MS).toISOString(), serverReceivedAt: new Date(receipt).toISOString() }).ok, true);
});

test('business date grouping uses event instant rather than post-midnight receipt instant', () => {
  const eventOccurredAt = '2026-08-20T03:55:00.000Z';
  const serverReceivedAt = '2026-08-20T04:20:00.000Z';
  assert.equal(getBusinessPeriodKeys(eventOccurredAt, 'America/Toronto').daily, '2026-08-19');
  assert.equal(getBusinessPeriodKeys(serverReceivedAt, 'America/Toronto').daily, '2026-08-20');
});

test('DST ordering and duration use absolute instants across repeated Toronto wall time', () => {
  const firstOneThirty = '2026-11-01T05:30:00.000Z';
  const secondOneThirty = '2026-11-01T06:30:00.000Z';
  assert.equal(Date.parse(secondOneThirty) - Date.parse(firstOneThirty), 60 * 60 * 1000);
  assert.equal(getBusinessPeriodKeys(firstOneThirty, 'America/Toronto').daily, '2026-11-01');
  assert.equal(getBusinessPeriodKeys(secondOneThirty, 'America/Toronto').daily, '2026-11-01');
});

test('clock-in transaction creates one lock, one time entry, one audit event and an idempotency record', () => {
  const tx = buildClockInTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockInAt: '2026-08-05T10:00:00.000Z',
    requestId: 'req-1',
    idempotencyKey: 'key-1',
    payloadHash: 'hash-1',
    source: 'web',
    auditEventId: 'audit-1',
  });

  assert.equal(tx.TransactItems.length, 4);
  assert.equal(tx.TransactItems[0].Put.Item.entityType, 'IDEMPOTENCY');
  assert.equal(tx.TransactItems[1].Put.Item.entityType, 'ACTIVE_SHIFT');
  assert.equal(tx.TransactItems[2].Put.Item.entityType, 'TIME_ENTRY');
  assert.equal(tx.TransactItems[3].Put.Item.entityType, 'AUDIT_EVENT');
});

test('clock-in transaction persists canonical Work Area identity and snapshot', () => {
  const tx = buildClockInTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockInAt: '2026-08-05T10:00:00.000Z',
    jobIds: ['job-1'],
    workType: 'job',
    workAreaId: 'area-1',
    workAreaNameSnapshot: 'Foundation',
    requestId: 'req-1',
    idempotencyKey: 'key-1',
    payloadHash: 'hash-1',
    source: 'mobile',
    auditEventId: 'audit-1',
  });

  const idempotency = tx.TransactItems.find((item) => item.Put?.Item?.entityType === 'IDEMPOTENCY').Put.Item;
  const entry = tx.TransactItems.find((item) => item.Put?.Item?.entityType === 'TIME_ENTRY').Put.Item;
  const audit = tx.TransactItems.find((item) => item.Put?.Item?.entityType === 'AUDIT_EVENT').Put.Item;
  assert.deepEqual(
    { id: entry.workAreaId, name: entry.workAreaNameSnapshot },
    { id: 'area-1', name: 'Foundation' },
  );
  assert.equal(idempotency.response.workAreaId, 'area-1');
  assert.equal(idempotency.response.workAreaNameSnapshot, 'Foundation');
  assert.equal(audit.metadata.workAreaId, 'area-1');
});

test('clock-in uses a conditional put for the active-shift lock and no condition checks', () => {
  const tx = buildClockInTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockInAt: '2026-08-05T10:00:00.000Z',
    requestId: 'req-1',
    idempotencyKey: 'key-1',
    payloadHash: 'hash-1',
    source: 'web',
    auditEventId: 'audit-1',
  });

  assert.equal(tx.TransactItems.filter((item) => item.ConditionCheck).length, 0);
  assert.equal(tx.TransactItems.filter((item) => item.Put?.Item?.entityType === 'ACTIVE_SHIFT').length, 1);
});

test('clock-in lock requires active-shift key to not exist (single active shift guarantee)', () => {
  const tx = buildClockInTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockInAt: '2026-08-05T10:00:00.000Z',
    requestId: 'req-1',
    idempotencyKey: 'key-1',
    payloadHash: 'hash-1',
    source: 'web',
    auditEventId: 'audit-1',
  });

  const lockPut = tx.TransactItems.find((item) => item.Put?.Item?.entityType === 'ACTIVE_SHIFT');
  assert.ok(lockPut);
  assert.equal(lockPut.Put.ConditionExpression, 'attribute_not_exists(PK) AND attribute_not_exists(SK)');
});

test('clock-out transaction updates the time entry, deletes the lock and records an audit event', () => {
  const tx = buildClockOutTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockOutAt: '2026-08-05T11:00:00.000Z',
    requestId: 'req-2',
    idempotencyKey: 'key-2',
    payloadHash: 'hash-2',
    source: 'web',
    auditEventId: 'audit-2',
    breakMinutes: 15,
    notes: 'Wrapped up',
    photoAttachmentUrl: 'https://example.com/photo.jpg',
  });

  assert.equal(tx.TransactItems.length, 4);
  assert.equal(tx.TransactItems.filter((item) => item.Put?.Item?.entityType === 'IDEMPOTENCY').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Delete?.Key?.SK === 'ACTIVE_SHIFT').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Update?.Key?.SK === 'TIME#entry-1').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Put?.Item?.entityType === 'AUDIT_EVENT').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Put?.Item?.entityType === 'CLOCK_OUT_STATE').length, 0);

  const targets = tx.TransactItems.map((item) => {
    if (item.Put) return `PUT:${item.Put.Item.PK}:${item.Put.Item.SK}`;
    if (item.Delete) return `DELETE:${item.Delete.Key.PK}:${item.Delete.Key.SK}`;
    if (item.Update) return `UPDATE:${item.Update.Key.PK}:${item.Update.Key.SK}`;
    return null;
  }).filter(Boolean);

  assert.equal(new Set(targets).size, targets.length);
});

test('clock-out transaction never introduces duplicate target keys', () => {
  const tx = buildClockOutTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockOutAt: '2026-08-05T11:00:00.000Z',
    requestId: 'req-2',
    idempotencyKey: 'key-2',
    payloadHash: 'hash-2',
    source: 'web',
    auditEventId: 'audit-2',
  });

  const keys = tx.TransactItems.map((item) => {
    if (item.Put) return `${item.Put.Item.PK}|${item.Put.Item.SK}`;
    if (item.Delete) return `${item.Delete.Key.PK}|${item.Delete.Key.SK}`;
    if (item.Update) return `${item.Update.Key.PK}|${item.Update.Key.SK}`;
    return null;
  }).filter(Boolean);

  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});

test('clock-out uses a conditional delete for the active-shift lock and a conditional update for the time entry', () => {
  const tx = buildClockOutTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockOutAt: '2026-08-05T11:00:00.000Z',
    requestId: 'req-2',
    idempotencyKey: 'key-2',
    payloadHash: 'hash-2',
    source: 'web',
    auditEventId: 'audit-2',
    breakMinutes: 15,
    notes: 'Wrapped up',
    photoAttachmentUrl: 'https://example.com/photo.jpg',
  });

  assert.equal(tx.TransactItems.filter((item) => item.ConditionCheck).length, 0);
  assert.equal(tx.TransactItems.filter((item) => item.Delete?.Key?.SK === 'ACTIVE_SHIFT').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Update?.Key?.SK === 'TIME#entry-1').length, 1);
});

test('clock-out includes photo attachment updates when a photo URL is provided', () => {
  const tx = buildClockOutTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockOutAt: '2026-08-05T11:00:00.000Z',
    requestId: 'req-2',
    idempotencyKey: 'key-2',
    payloadHash: 'hash-2',
    source: 'web',
    auditEventId: 'audit-2',
    photoAttachmentUrl: 'https://example.com/photo.jpg',
  });

  const update = tx.TransactItems.find((item) => item.Update);
  assert.match(update.Update.UpdateExpression, /#photoAttachmentUrl/);
  assert.ok(Object.prototype.hasOwnProperty.call(update.Update.ExpressionAttributeValues, ':photoAttachmentUrl'));
});

test('clock-out includes multi-photo attachment file ID updates', () => {
  const tx = buildClockOutTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockOutAt: '2026-08-05T11:00:00.000Z',
    requestId: 'req-2',
    idempotencyKey: 'key-2',
    payloadHash: 'hash-2',
    source: 'web',
    auditEventId: 'audit-2',
    photoAttachmentFileIds: ['file-1', 'file-2'],
  });

  const update = tx.TransactItems.find((item) => item.Update);
  assert.match(update.Update.UpdateExpression, /#photoAttachmentFileIds/);
  assert.match(update.Update.UpdateExpression, /#clockOutPhotoFileIds/);
  assert.equal(update.Update.ExpressionAttributeValues[':photoAttachmentFileId'], 'file-1');
  assert.deepEqual(update.Update.ExpressionAttributeValues[':photoAttachmentFileIds'], ['file-1', 'file-2']);
  assert.deepEqual(update.Update.ExpressionAttributeValues[':clockOutPhotoFileIds'], ['file-1', 'file-2']);
});

test('clock-out omits photo attachment updates when no photo URL is provided', () => {
  const tx = buildClockOutTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    timeEntryId: 'entry-1',
    clockOutAt: '2026-08-05T11:00:00.000Z',
    requestId: 'req-2',
    idempotencyKey: 'key-2',
    payloadHash: 'hash-2',
    source: 'web',
    auditEventId: 'audit-2',
  });

  const update = tx.TransactItems.find((item) => item.Update);
  assert.ok(!update.Update.UpdateExpression.includes('#photoAttachmentUrl'));
  assert.ok(!Object.prototype.hasOwnProperty.call(update.Update.ExpressionAttributeValues, ':photoAttachmentUrl'));
});

test('switch-activity transaction atomically closes current entry, creates next entry, updates lock, and records idempotency/audit', () => {
  const tx = buildSwitchActivityTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    previousTimeEntry: {
      id: 'entry-old',
      workType: 'job',
      jobIds: ['job-a'],
    },
    nextTimeEntry: {
      id: 'entry-new',
      workType: 'drive_time',
      jobIds: ['job-b'],
    },
    switchedAt: '2026-08-05T11:30:00.000Z',
    requestId: 'req-switch',
    idempotencyKey: 'switch-key',
    payloadHash: 'switch-hash',
    source: 'mobile',
    auditEventId: 'audit-switch',
    employeeName: 'Crew One',
  });

  assert.equal(tx.TransactItems.length, 5);
  assert.equal(tx.TransactItems.filter((item) => item.Put?.Item?.entityType === 'IDEMPOTENCY').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Update?.Key?.SK === 'TIME#entry-old').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Put?.Item?.entityType === 'TIME_ENTRY').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Update?.Key?.SK === 'ACTIVE_SHIFT').length, 1);
  assert.equal(tx.TransactItems.filter((item) => item.Put?.Item?.entityType === 'AUDIT_EVENT').length, 1);
});

test('switch-activity lock update condition requires current lock to match previous active entry', () => {
  const tx = buildSwitchActivityTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    previousTimeEntry: {
      id: 'entry-old',
      workType: 'job',
      jobIds: ['job-a'],
    },
    nextTimeEntry: {
      id: 'entry-new',
      workType: 'non_billable',
      jobIds: [],
    },
    switchedAt: '2026-08-05T11:30:00.000Z',
    requestId: 'req-switch',
    idempotencyKey: 'switch-key',
    payloadHash: 'switch-hash',
    source: 'mobile',
    auditEventId: 'audit-switch',
  });

  const lockUpdate = tx.TransactItems.find((item) => item.Update?.Key?.SK === 'ACTIVE_SHIFT');
  assert.ok(lockUpdate);
  assert.equal(lockUpdate.Update.ConditionExpression, 'attribute_exists(PK) AND attribute_exists(SK) AND #activeEntryId = :previousEntryId');
  assert.equal(lockUpdate.Update.ExpressionAttributeValues[':previousEntryId'], 'entry-old');
  assert.equal(lockUpdate.Update.ExpressionAttributeValues[':newEntryId'], 'entry-new');
});

test('switch-activity transaction does not target duplicate item keys', () => {
  const tx = buildSwitchActivityTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    previousTimeEntry: {
      id: 'entry-old',
      workType: 'job',
      jobIds: ['job-a'],
    },
    nextTimeEntry: {
      id: 'entry-new',
      workType: 'job',
      jobIds: ['job-b'],
    },
    switchedAt: '2026-08-05T11:30:00.000Z',
    requestId: 'req-switch',
    idempotencyKey: 'switch-key',
    payloadHash: 'switch-hash',
    source: 'mobile',
    auditEventId: 'audit-switch',
  });

  const keys = tx.TransactItems.map((item) => {
    if (item.Put) return `${item.Put.Item.PK}|${item.Put.Item.SK}`;
    if (item.Delete) return `${item.Delete.Key.PK}|${item.Delete.Key.SK}`;
    if (item.Update) return `${item.Update.Key.PK}|${item.Update.Key.SK}`;
    return null;
  }).filter(Boolean);

  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});

test('switch-activity transaction persists the next Work Area snapshot and audits both identities', () => {
  const tx = buildSwitchActivityTransaction({
    businessId: 'biz-1',
    employeeId: 'emp-1',
    userId: 'user-1',
    previousTimeEntry: {
      id: 'entry-old',
      workType: 'job',
      jobIds: ['job-a'],
      workAreaId: 'area-old',
      clockIn: '2026-08-05T10:00:00.000Z',
    },
    nextTimeEntry: {
      id: 'entry-new',
      workType: 'job',
      jobIds: ['job-b'],
      workAreaId: 'area-new',
      workAreaNameSnapshot: 'Second Floor',
    },
    switchedAt: '2026-08-05T11:30:00.000Z',
    requestId: 'req-switch',
    idempotencyKey: 'switch-key',
    payloadHash: 'switch-hash',
    source: 'mobile',
    auditEventId: 'audit-switch',
  });

  const idempotency = tx.TransactItems.find((item) => item.Put?.Item?.entityType === 'IDEMPOTENCY').Put.Item;
  const entry = tx.TransactItems.find((item) => item.Put?.Item?.entityType === 'TIME_ENTRY').Put.Item;
  const audit = tx.TransactItems.find((item) => item.Put?.Item?.entityType === 'AUDIT_EVENT').Put.Item;
  assert.equal(entry.workAreaId, 'area-new');
  assert.equal(entry.workAreaNameSnapshot, 'Second Floor');
  assert.equal(idempotency.response.workAreaId, 'area-new');
  assert.equal(audit.metadata.previousWorkAreaId, 'area-old');
  assert.equal(audit.metadata.newWorkAreaId, 'area-new');
});

test('clocking errors are normalized into client-safe responses', () => {
  const response = getClockingErrorResponse({ statusCode: 409, code: 'ALREADY_CLOCKED_IN' });
  assert.equal(response.status, 409);
  assert.equal(response.error, 'Already Clocked In');
});

test('active shift exists and matches the requested entry id', () => {
  const result = resolveClockOutActiveShift({
    activeShift: { activeEntryId: 'entry-1' },
    requestedEntryId: 'entry-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'match');
});

test('active shift is missing', () => {
  const result = resolveClockOutActiveShift({
    activeShift: null,
    requestedEntryId: 'entry-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-active-shift');
  assert.equal(result.status, 409);
});

test('active shift with no activeEntryId is rejected', () => {
  const result = resolveClockOutActiveShift({
    activeShift: { activeEntryId: '' },
    requestedEntryId: 'entry-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-active-entry-id');
  assert.equal(result.status, 409);
});

test('active shift pointing to another entry is rejected', () => {
  const result = resolveClockOutActiveShift({
    activeShift: { activeEntryId: 'entry-2' },
    requestedEntryId: 'entry-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'entry-mismatch');
  assert.equal(result.status, 409);
});

test('None cancellation reasons are ignored', () => {
  const response = getClockingFailureResponse('clock-out', {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'None' }],
  });

  assert.equal(response.status, 500);
  assert.equal(response.error, 'Clocking request failed');
});

test('ConditionalCheckFailed is recognized', () => {
  const response = getClockingFailureResponse('clock-out', {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
  });

  assert.equal(response.status, 409);
  assert.equal(response.error, 'No active shift found');
});

test('clock-in conditional lock failure is normalized to Already Clocked In', () => {
  const response = getClockingFailureResponse('clock-in', {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
  });

  assert.equal(response.status, 409);
  assert.equal(response.error, 'Already Clocked In');
});

test('switch-activity conditional conflict is normalized to No active shift found', () => {
  const response = getClockingFailureResponse('switch-activity', {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
  });

  assert.equal(response.status, 409);
  assert.equal(response.error, 'No active shift found');
});

test('unexpected ValidationException returns 500', () => {
  const response = getClockingFailureResponse('clock-out', {
    name: 'ValidationException',
    message: 'bad request',
  });

  assert.equal(response.status, 500);
  assert.equal(response.error, 'Clocking request failed');
});
