import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { getBusinessPeriodKeys } from './businessTime.js';

function nowIso() {
  return new Date().toISOString();
}

export const DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS = 12;
export const MAX_CLOCK_OUT_PHOTO_ATTACHMENTS = 5;
export const OFFLINE_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_EVENT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const ADJUSTED_CLOCK_IN_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const ABSOLUTE_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function resolveRequestedClockInTime({ requestedClockInAt, serverReceivedAt = nowIso(), businessTimeZone, permitted }) {
  const serverReceivedMs = Date.parse(serverReceivedAt);
  if (Number.isNaN(serverReceivedMs)) throw new TypeError('serverReceivedAt must be a valid timestamp.');
  if (requestedClockInAt === undefined) {
    return {
      ok: true,
      effectiveClockInAt: new Date(serverReceivedMs).toISOString(),
      requestedClockInAt: undefined,
      clockInTimeSource: 'server_now',
    };
  }
  if (!permitted) {
    return { ok: false, status: 403, code: 'clock_in_time_not_allowed', error: 'You do not have permission to adjust clock-in time.' };
  }
  if (typeof requestedClockInAt !== 'string' || !ABSOLUTE_ISO_TIMESTAMP.test(requestedClockInAt.trim())) {
    return { ok: false, status: 400, code: 'clock_in_time_invalid', error: 'Requested clock-in time is invalid.' };
  }
  const requestedMs = Date.parse(requestedClockInAt.trim());
  if (Number.isNaN(requestedMs)) {
    return { ok: false, status: 400, code: 'clock_in_time_invalid', error: 'Requested clock-in time is invalid.' };
  }
  if (requestedMs > serverReceivedMs + OFFLINE_EVENT_MAX_FUTURE_SKEW_MS) {
    return { ok: false, status: 409, code: 'clock_in_time_in_future', error: 'Requested clock-in time cannot be in the future.' };
  }
  if (requestedMs < serverReceivedMs - ADJUSTED_CLOCK_IN_MAX_AGE_MS) {
    return { ok: false, status: 409, code: 'clock_in_time_too_old', error: 'Requested clock-in time must be within the last 4 hours.' };
  }
  if (getBusinessPeriodKeys(new Date(requestedMs), businessTimeZone).daily
    !== getBusinessPeriodKeys(new Date(serverReceivedMs), businessTimeZone).daily) {
    return { ok: false, status: 409, code: 'clock_in_time_too_old', error: 'Requested clock-in time must be on the current business date and within the last 4 hours.' };
  }
  return {
    ok: true,
    effectiveClockInAt: new Date(requestedMs).toISOString(),
    requestedClockInAt: new Date(requestedMs).toISOString(),
    clockInTimeSource: 'employee_adjusted',
  };
}

export function normalizeClientOccurredAt(clientOccurredAt) {
  if (clientOccurredAt === undefined) return { ok: true, clientOccurredAt: undefined };
  if (typeof clientOccurredAt !== 'string' || !ABSOLUTE_ISO_TIMESTAMP.test(clientOccurredAt.trim())) {
    return { ok: false, status: 400, code: 'offline_event_invalid_timestamp', error: 'clientOccurredAt must be a valid absolute ISO-8601 timestamp.' };
  }
  const eventOccurredMs = Date.parse(clientOccurredAt.trim());
  if (Number.isNaN(eventOccurredMs)) {
    return { ok: false, status: 400, code: 'offline_event_invalid_timestamp', error: 'clientOccurredAt must be a valid absolute ISO-8601 timestamp.' };
  }
  return { ok: true, clientOccurredAt: new Date(eventOccurredMs).toISOString() };
}

export function resolveClockingEventTime({ clientOccurredAt, serverReceivedAt = nowIso() }) {
  const serverReceivedMs = Date.parse(serverReceivedAt);
  if (Number.isNaN(serverReceivedMs)) throw new TypeError('serverReceivedAt must be a valid timestamp.');

  if (clientOccurredAt === undefined) {
    return {
      ok: true,
      eventOccurredAt: new Date(serverReceivedMs).toISOString(),
      serverReceivedAt: new Date(serverReceivedMs).toISOString(),
      timestampSource: 'server',
      timestampDeltaMs: 0,
    };
  }

  const normalized = normalizeClientOccurredAt(clientOccurredAt);
  if (!normalized.ok) return normalized;
  const eventOccurredMs = Date.parse(normalized.clientOccurredAt);

  const timestampDeltaMs = eventOccurredMs - serverReceivedMs;
  if (timestampDeltaMs > OFFLINE_EVENT_MAX_FUTURE_SKEW_MS) {
    return { ok: false, status: 409, code: 'offline_event_in_future', error: 'Clocking event time is too far in the future.' };
  }
  if (timestampDeltaMs < -OFFLINE_EVENT_MAX_AGE_MS) {
    return { ok: false, status: 409, code: 'offline_event_too_old', error: 'Clocking event time is outside the offline clocking window.' };
  }

  return {
    ok: true,
    eventOccurredAt: new Date(eventOccurredMs).toISOString(),
    serverReceivedAt: new Date(serverReceivedMs).toISOString(),
    timestampSource: 'client',
    timestampDeltaMs,
  };
}

export function isPossiblyForgottenClockOut({
  clockInAt,
  now = nowIso(),
  thresholdHours = DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS,
}) {
  if (typeof clockInAt !== 'string' || !clockInAt.trim()) return false;

  const clockInMs = Date.parse(clockInAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(clockInMs) || Number.isNaN(nowMs)) return false;
  if (nowMs <= clockInMs) return false;

  const elapsedHours = (nowMs - clockInMs) / (1000 * 60 * 60);
  return elapsedHours >= thresholdHours;
}

function businessPk(businessId) {
  return `BUSINESS#${businessId}`;
}

function activeShiftPk(businessId, employeeId) {
  return `${businessPk(businessId)}#EMPLOYEE#${employeeId}`;
}

function activeShiftSk() {
  return 'ACTIVE_SHIFT';
}

function timeEntrySk(entryId) {
  return `TIME#${entryId}`;
}

function idempotencySk(idempotencyKey) {
  return `IDEMPOTENCY#${idempotencyKey}`;
}

function auditEventSk(eventId) {
  return `AUDIT#${eventId}`;
}

export function buildClockInTransaction({
  businessId,
  employeeId,
  userId,
  timeEntryId,
  clockInAt,
  serverReceivedAt,
  timestampSource = 'server',
  clockInTimeSource = 'server_now',
  requestedClockInAt,
  requestId,
  idempotencyKey,
  payloadHash,
  source,
  auditEventId,
  jobIds = [],
  workType = 'job',
  workAreaId,
  workAreaNameSnapshot,
  unbillableCategoryId,
  unbillableCategoryName,
  employeeName = '',
  workflowFinalizationItems = [],
}) {
  const eventOccurredAt = clockInAt ?? nowIso();
  const receivedAt = serverReceivedAt ?? nowIso();
  const timeEntryItem = {
    PK: businessPk(businessId),
    SK: timeEntrySk(timeEntryId),
    entityType: 'TIME_ENTRY',
    businessId,
    entryId: timeEntryId,
    employeeId,
    employeeName,
    jobId: Array.isArray(jobIds) && jobIds.length > 0 ? jobIds[0] : undefined,
    jobIds: Array.isArray(jobIds) ? jobIds : [],
    workType,
    workAreaId: workType === 'job' ? workAreaId ?? null : undefined,
    workAreaNameSnapshot: workType === 'job' ? workAreaNameSnapshot ?? null : undefined,
    unbillableCategoryId: workType === 'non_billable' ? unbillableCategoryId : undefined,
    unbillableCategoryName: workType === 'non_billable' ? unbillableCategoryName : undefined,
    clockIn: eventOccurredAt,
    clockInServerReceivedAt: receivedAt,
    clockInTimestampSource: timestampSource,
    clockInTimeSource,
    requestedClockInAt,
    status: 'clocked_in',
    breakMinutes: 0,
    notes: '',
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };

  const lockItem = {
    PK: activeShiftPk(businessId, employeeId),
    SK: activeShiftSk(),
    entityType: 'ACTIVE_SHIFT',
    businessId,
    employeeId,
    activeEntryId: timeEntryId,
    status: 'active',
    activeEntryStartedAt: eventOccurredAt,
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };

  const auditItem = {
    PK: businessPk(businessId),
    SK: auditEventSk(auditEventId),
    entityType: 'AUDIT_EVENT',
    businessId,
    eventId: auditEventId,
    action: 'clock_in',
    actorUserId: userId,
    actorName: employeeName || userId,
    actorEmail: '',
    affectedEntryCount: 1,
    createdAt: receivedAt,
    metadata: {
      employeeId,
      timeEntryId,
      source,
      workAreaId: workType === 'job' ? workAreaId ?? null : undefined,
      eventOccurredAt,
      serverReceivedAt: receivedAt,
      timestampSource,
      clockInTimeSource,
      requestedClockInAt,
      effectiveClockInAt: eventOccurredAt,
    },
  };

  const idempotencyItem = {
    PK: businessPk(businessId),
    SK: idempotencySk(idempotencyKey),
    entityType: 'IDEMPOTENCY',
    businessId,
    requestId,
    idempotencyKey,
    action: 'clock_in',
    payloadHash,
    status: 'completed',
    response: {
      id: timeEntryId,
      employeeId,
      jobIds: Array.isArray(jobIds) ? jobIds : [],
      workType,
      workAreaId: workType === 'job' ? workAreaId ?? null : undefined,
      workAreaNameSnapshot: workType === 'job' ? workAreaNameSnapshot ?? null : undefined,
      unbillableCategoryId: workType === 'non_billable' ? unbillableCategoryId : undefined,
      unbillableCategoryName: workType === 'non_billable' ? unbillableCategoryName : undefined,
      clockIn: eventOccurredAt,
      breakMinutes: 0,
      notes: '',
      status: 'clocked_in',
    },
    eventOccurredAt,
    serverReceivedAt: receivedAt,
    timestampSource,
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };

  return {
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: idempotencyItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: lockItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: timeEntryItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: auditItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      ...workflowFinalizationItems,
    ],
  };
}

export async function validateClockOutPhotoAttachment({
  session,
  timeEntryId,
  photoAttachmentFileId,
  photoAttachmentFileIds,
  getFileForBusiness,
}) {
  const candidateIds = [];
  if (Array.isArray(photoAttachmentFileIds)) {
    for (const value of photoAttachmentFileIds) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) candidateIds.push(trimmed);
    }
  }

  if (typeof photoAttachmentFileId === 'string' && photoAttachmentFileId.trim()) {
    candidateIds.push(photoAttachmentFileId.trim());
  }

  const fileIds = [...new Set(candidateIds)];
  if (fileIds.length === 0) {
    return { ok: true, fileId: undefined, fileIds: [] };
  }

  if (fileIds.length > MAX_CLOCK_OUT_PHOTO_ATTACHMENTS) {
    return {
      ok: false,
      status: 400,
      error: `A maximum of ${MAX_CLOCK_OUT_PHOTO_ATTACHMENTS} photos can be attached to clock-out.`,
    };
  }

  const validatedIds = [];
  for (const fileId of fileIds) {
    const file = await getFileForBusiness(session.businessId, fileId);
    if (!file) {
      return { ok: false, status: 400, error: 'Attachment does not exist.' };
    }

    if (file.businessId && file.businessId !== session.businessId) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (file.entityType !== 'time-entry' || file.entityId !== timeEntryId) {
      return { ok: false, status: 400, error: 'Attachment does not match the current time entry.' };
    }

    if (file.uploadStatus !== 'uploaded') {
      return { ok: false, status: 400, error: 'Attachment upload is not complete.' };
    }

    validatedIds.push(file.id);
  }

  return { ok: true, fileId: validatedIds[0], fileIds: validatedIds };
}

export function buildClockOutTransaction({
  businessId,
  employeeId,
  userId,
  timeEntryId,
  clockOutAt,
  serverReceivedAt,
  timestampSource = 'server',
  requestId,
  idempotencyKey,
  payloadHash,
  source,
  auditEventId,
  breakMinutes = 0,
  notes = '',
  photoAttachmentFileId,
  photoAttachmentFileIds,
  photoAttachmentUrl,
  unbillableCategoryId,
  unbillableCategoryName,
  jobId,
  jobIds,
  workType,
  workAreaId,
  workAreaNameSnapshot,
  clockIn,
  employeeName = '',
  labourCostRateSnapshot,
  labourCostTotalSnapshot,
  workflowFinalizationItems = [],
}) {
  const eventOccurredAt = clockOutAt ?? nowIso();
  const receivedAt = serverReceivedAt ?? nowIso();
  const attachmentFileIds = Array.isArray(photoAttachmentFileIds)
    ? photoAttachmentFileIds.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : [];
  const fallbackFileId = typeof photoAttachmentFileId === 'string' && photoAttachmentFileId.trim()
    ? photoAttachmentFileId.trim()
    : undefined;
  if (fallbackFileId && attachmentFileIds.length === 0) {
    attachmentFileIds.push(fallbackFileId);
  }
  const normalizedAttachmentFileIds = [...new Set(attachmentFileIds)];
  const primaryAttachmentFileId = normalizedAttachmentFileIds[0];
  const hasPhotoAttachmentFileId = typeof primaryAttachmentFileId === 'string' && primaryAttachmentFileId.length > 0;
  const hasPhotoAttachmentFileIds = normalizedAttachmentFileIds.length > 0;
  const hasPhotoAttachment = typeof photoAttachmentUrl === 'string' && photoAttachmentUrl.trim().length > 0;
  const idempotencyItem = {
    PK: businessPk(businessId),
    SK: idempotencySk(idempotencyKey),
    entityType: 'IDEMPOTENCY',
    businessId,
    requestId,
    idempotencyKey,
    action: 'clock_out',
    payloadHash,
    status: 'completed',
    response: {
      id: timeEntryId,
      employeeId,
      jobId,
      jobIds,
      workType,
      workAreaId: workType === 'job' ? workAreaId ?? null : undefined,
      workAreaNameSnapshot: workType === 'job' ? workAreaNameSnapshot ?? null : undefined,
      clockIn,
      clockOut: eventOccurredAt,
      breakMinutes,
      notes,
      photoAttachmentFileIds: hasPhotoAttachmentFileIds ? normalizedAttachmentFileIds : undefined,
      clockOutPhotoFileIds: hasPhotoAttachmentFileIds ? normalizedAttachmentFileIds : undefined,
      photoAttachmentFileId: hasPhotoAttachmentFileId ? primaryAttachmentFileId : undefined,
      clockOutPhotoFileId: hasPhotoAttachmentFileId ? primaryAttachmentFileId : undefined,
      photoAttachmentUrl: hasPhotoAttachment ? photoAttachmentUrl : undefined,
      unbillableCategoryId,
      unbillableCategoryName,
      status: 'clocked_out',
      labourCostRateSnapshot,
      labourCostTotalSnapshot,
    },
    eventOccurredAt,
    serverReceivedAt: receivedAt,
    timestampSource,
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };

  const auditItem = {
    PK: businessPk(businessId),
    SK: auditEventSk(auditEventId),
    entityType: 'AUDIT_EVENT',
    businessId,
    eventId: auditEventId,
    action: 'clock_out',
    actorUserId: userId,
    actorName: employeeName || userId,
    actorEmail: '',
    affectedEntryCount: 1,
    createdAt: receivedAt,
    metadata: {
      employeeId,
      timeEntryId,
      source,
      workAreaId: workType === 'job' ? workAreaId ?? null : undefined,
      eventOccurredAt,
      serverReceivedAt: receivedAt,
      timestampSource,
    },
  };

  const updateExpressionParts = [
    '#status = :status',
    '#clockOut = :clockOut',
    '#breakMinutes = :breakMinutes',
    '#notes = :notes',
    '#updatedAt = :updatedAt',
    '#clockOutServerReceivedAt = :clockOutServerReceivedAt',
    '#clockOutTimestampSource = :clockOutTimestampSource',
  ];
  const expressionAttributeNames = {
    '#status': 'status',
    '#clockOut': 'clockOut',
    '#breakMinutes': 'breakMinutes',
    '#notes': 'notes',
    '#updatedAt': 'updatedAt',
    '#clockOutServerReceivedAt': 'clockOutServerReceivedAt',
    '#clockOutTimestampSource': 'clockOutTimestampSource',
    '#clockIn': 'clockIn',
  };
  const expressionAttributeValues = {
    ':status': 'clocked_out',
    ':clockOut': eventOccurredAt,
    ':breakMinutes': breakMinutes,
    ':notes': notes,
    ':updatedAt': receivedAt,
    ':clockOutServerReceivedAt': receivedAt,
    ':clockOutTimestampSource': timestampSource,
    ':clockedIn': 'clocked_in',
  };

  if (hasPhotoAttachment) {
    updateExpressionParts.push('#photoAttachmentUrl = :photoAttachmentUrl');
    expressionAttributeNames['#photoAttachmentUrl'] = 'photoAttachmentUrl';
    expressionAttributeValues[':photoAttachmentUrl'] = photoAttachmentUrl;
  }

  if (typeof labourCostRateSnapshot === 'number' && Number.isFinite(labourCostRateSnapshot)) {
    updateExpressionParts.push('#labourCostRateSnapshot = :labourCostRateSnapshot');
    expressionAttributeNames['#labourCostRateSnapshot'] = 'labourCostRateSnapshot';
    expressionAttributeValues[':labourCostRateSnapshot'] = labourCostRateSnapshot;
  }

  if (typeof labourCostTotalSnapshot === 'number' && Number.isFinite(labourCostTotalSnapshot)) {
    updateExpressionParts.push('#labourCostTotalSnapshot = :labourCostTotalSnapshot');
    expressionAttributeNames['#labourCostTotalSnapshot'] = 'labourCostTotalSnapshot';
    expressionAttributeValues[':labourCostTotalSnapshot'] = labourCostTotalSnapshot;
  }

  if (hasPhotoAttachmentFileId) {
    updateExpressionParts.push('#photoAttachmentFileId = :photoAttachmentFileId');
    updateExpressionParts.push('#clockOutPhotoFileId = :clockOutPhotoFileId');
    expressionAttributeNames['#photoAttachmentFileId'] = 'photoAttachmentFileId';
    expressionAttributeNames['#clockOutPhotoFileId'] = 'clockOutPhotoFileId';
    expressionAttributeValues[':photoAttachmentFileId'] = primaryAttachmentFileId;
    expressionAttributeValues[':clockOutPhotoFileId'] = primaryAttachmentFileId;
  }

  if (hasPhotoAttachmentFileIds) {
    updateExpressionParts.push('#photoAttachmentFileIds = :photoAttachmentFileIds');
    updateExpressionParts.push('#clockOutPhotoFileIds = :clockOutPhotoFileIds');
    expressionAttributeNames['#photoAttachmentFileIds'] = 'photoAttachmentFileIds';
    expressionAttributeNames['#clockOutPhotoFileIds'] = 'clockOutPhotoFileIds';
    expressionAttributeValues[':photoAttachmentFileIds'] = normalizedAttachmentFileIds;
    expressionAttributeValues[':clockOutPhotoFileIds'] = normalizedAttachmentFileIds;
  }

  return {
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: idempotencyItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Delete: {
          TableName: tableName,
          Key: {
            PK: activeShiftPk(businessId, employeeId),
            SK: activeShiftSk(),
          },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #activeEntryId = :timeEntryId',
          ExpressionAttributeNames: {
            '#activeEntryId': 'activeEntryId',
          },
          ExpressionAttributeValues: {
            ':timeEntryId': timeEntryId,
          },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: {
            PK: businessPk(businessId),
            SK: timeEntrySk(timeEntryId),
          },
          UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :clockedIn AND #clockIn = :expectedClockIn',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: {
            ...expressionAttributeValues,
            ':expectedClockIn': clockIn,
          },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: auditItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      ...workflowFinalizationItems,
    ],
  };
}

export function buildSwitchActivityTransaction({
  businessId,
  employeeId,
  userId,
  previousTimeEntry,
  nextTimeEntry,
  switchedAt,
  serverReceivedAt,
  timestampSource = 'server',
  requestId,
  idempotencyKey,
  payloadHash,
  source,
  auditEventId,
  employeeName = '',
}) {
  const eventOccurredAt = switchedAt ?? nowIso();
  const receivedAt = serverReceivedAt ?? nowIso();
  const idempotencyItem = {
    PK: businessPk(businessId),
    SK: idempotencySk(idempotencyKey),
    entityType: 'IDEMPOTENCY',
    businessId,
    requestId,
    idempotencyKey,
    action: 'switch_activity',
    payloadHash,
    status: 'completed',
    response: {
      id: nextTimeEntry.id,
      employeeId,
      jobId: Array.isArray(nextTimeEntry.jobIds) && nextTimeEntry.jobIds.length > 0 ? nextTimeEntry.jobIds[0] : undefined,
      jobIds: Array.isArray(nextTimeEntry.jobIds) ? nextTimeEntry.jobIds : [],
      workType: nextTimeEntry.workType,
      workAreaId: nextTimeEntry.workType === 'job' ? nextTimeEntry.workAreaId ?? null : undefined,
      workAreaNameSnapshot: nextTimeEntry.workType === 'job' ? nextTimeEntry.workAreaNameSnapshot ?? null : undefined,
      unbillableCategoryId: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryId : undefined,
      unbillableCategoryName: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryName : undefined,
      clockIn: eventOccurredAt,
      breakMinutes: 0,
      notes: '',
      status: 'clocked_in',
    },
    eventOccurredAt,
    serverReceivedAt: receivedAt,
    timestampSource,
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };

  const nextEntryItem = {
    PK: businessPk(businessId),
    SK: timeEntrySk(nextTimeEntry.id),
    entityType: 'TIME_ENTRY',
    businessId,
    entryId: nextTimeEntry.id,
    employeeId,
    employeeName,
    jobId: Array.isArray(nextTimeEntry.jobIds) && nextTimeEntry.jobIds.length > 0 ? nextTimeEntry.jobIds[0] : undefined,
    jobIds: Array.isArray(nextTimeEntry.jobIds) ? nextTimeEntry.jobIds : [],
    workType: nextTimeEntry.workType,
    workAreaId: nextTimeEntry.workType === 'job' ? nextTimeEntry.workAreaId ?? null : undefined,
    workAreaNameSnapshot: nextTimeEntry.workType === 'job' ? nextTimeEntry.workAreaNameSnapshot ?? null : undefined,
    unbillableCategoryId: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryId : undefined,
    unbillableCategoryName: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryName : undefined,
    clockIn: eventOccurredAt,
    clockInServerReceivedAt: receivedAt,
    clockInTimestampSource: timestampSource,
    status: 'clocked_in',
    breakMinutes: 0,
    notes: '',
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };

  const auditItem = {
    PK: businessPk(businessId),
    SK: auditEventSk(auditEventId),
    entityType: 'AUDIT_EVENT',
    businessId,
    eventId: auditEventId,
    action: 'switch_activity',
    actorUserId: userId,
    actorName: employeeName || userId,
    actorEmail: '',
    affectedEntryCount: 2,
    createdAt: receivedAt,
    metadata: {
      employeeId,
      previousTimeEntryId: previousTimeEntry.id,
      newTimeEntryId: nextTimeEntry.id,
      previousWorkType: previousTimeEntry.workType,
      newWorkType: nextTimeEntry.workType,
      previousJobIds: Array.isArray(previousTimeEntry.jobIds) ? previousTimeEntry.jobIds : [],
      newJobIds: Array.isArray(nextTimeEntry.jobIds) ? nextTimeEntry.jobIds : [],
      previousWorkAreaId: previousTimeEntry.workType === 'job' ? previousTimeEntry.workAreaId ?? null : undefined,
      newWorkAreaId: nextTimeEntry.workType === 'job' ? nextTimeEntry.workAreaId ?? null : undefined,
      source,
      eventOccurredAt,
      serverReceivedAt: receivedAt,
      timestampSource,
    },
  };

  return {
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: idempotencyItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: {
            PK: businessPk(businessId),
            SK: timeEntrySk(previousTimeEntry.id),
          },
          UpdateExpression: 'SET #status = :status, #clockOut = :clockOut, #updatedAt = :updatedAt, #clockOutServerReceivedAt = :clockOutServerReceivedAt, #clockOutTimestampSource = :clockOutTimestampSource',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :clockedIn AND #clockIn = :expectedClockIn',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#clockOut': 'clockOut',
            '#updatedAt': 'updatedAt',
            '#clockOutServerReceivedAt': 'clockOutServerReceivedAt',
            '#clockOutTimestampSource': 'clockOutTimestampSource',
            '#clockIn': 'clockIn',
          },
          ExpressionAttributeValues: {
            ':status': 'clocked_out',
            ':clockOut': eventOccurredAt,
            ':updatedAt': receivedAt,
            ':clockOutServerReceivedAt': receivedAt,
            ':clockOutTimestampSource': timestampSource,
            ':clockedIn': 'clocked_in',
            ':expectedClockIn': previousTimeEntry.clockIn,
          },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: nextEntryItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: {
            PK: activeShiftPk(businessId, employeeId),
            SK: activeShiftSk(),
          },
          UpdateExpression: 'SET #activeEntryId = :newEntryId, #activeEntryStartedAt = :activeEntryStartedAt, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #activeEntryId = :previousEntryId',
          ExpressionAttributeNames: {
            '#activeEntryId': 'activeEntryId',
            '#updatedAt': 'updatedAt',
            '#activeEntryStartedAt': 'activeEntryStartedAt',
          },
          ExpressionAttributeValues: {
            ':newEntryId': nextTimeEntry.id,
            ':previousEntryId': previousTimeEntry.id,
            ':activeEntryStartedAt': eventOccurredAt,
            ':updatedAt': receivedAt,
          },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: auditItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
    ],
  };
}

export async function getActiveShiftForEmployee({ businessId, employeeId, consistentRead = false }) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: activeShiftPk(businessId, employeeId),
        SK: activeShiftSk(),
      },
      ConsistentRead: consistentRead,
    })
  );

  if (!result.Item) {
    return null;
  }

  return {
    businessId,
    employeeId: result.Item.employeeId,
    activeEntryId: result.Item.activeEntryId,
    activeEntryStartedAt: result.Item.activeEntryStartedAt,
    status: result.Item.status,
    timelineRevision: result.Item.timelineRevision,
    createdAt: result.Item.createdAt,
    updatedAt: result.Item.updatedAt,
  };
}

export async function clearOrphanActiveShiftForEmployee({ businessId, employeeId }) {
  const activeShiftResult = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: activeShiftPk(businessId, employeeId), SK: activeShiftSk() },
    ConsistentRead: true,
  }));
  const activeShift = activeShiftResult.Item;
  if (!activeShift) return { ok: true, cleared: false };

  const activeEntryId = typeof activeShift.activeEntryId === 'string' ? activeShift.activeEntryId.trim() : '';
  const referencedEntryResult = activeEntryId
    ? await ddb.send(new GetCommand({
        TableName: tableName,
        Key: { PK: businessPk(businessId), SK: timeEntrySk(activeEntryId) },
        ConsistentRead: true,
      }))
    : { Item: undefined };
  const referencedEntry = referencedEntryResult.Item;
  if (referencedEntry?.employeeId === employeeId && referencedEntry.status === 'clocked_in') {
    return { ok: false, cleared: false, reason: 'active-entry-exists' };
  }

  const lockCondition = activeEntryId
    ? {
        ConditionExpression: '#activeEntryId = :activeEntryId',
        ExpressionAttributeNames: { '#activeEntryId': 'activeEntryId' },
        ExpressionAttributeValues: { ':activeEntryId': activeEntryId },
      }
    : {
        ConditionExpression: 'attribute_not_exists(#activeEntryId)',
        ExpressionAttributeNames: { '#activeEntryId': 'activeEntryId' },
      };
  const referencedEntryCondition = referencedEntry
    ? {
        ConditionExpression: '#status = :status AND #employeeId = :employeeId',
        ExpressionAttributeNames: { '#status': 'status', '#employeeId': 'employeeId' },
        ExpressionAttributeValues: { ':status': referencedEntry.status, ':employeeId': referencedEntry.employeeId },
      }
    : { ConditionExpression: 'attribute_not_exists(PK)' };

  try {
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: tableName,
            Key: { PK: activeShiftPk(businessId, employeeId), SK: activeShiftSk() },
            ...lockCondition,
          },
        },
        ...(activeEntryId ? [{
          ConditionCheck: {
            TableName: tableName,
            Key: { PK: businessPk(businessId), SK: timeEntrySk(activeEntryId) },
            ...referencedEntryCondition,
          },
        }] : []),
      ],
    }));
    return { ok: true, cleared: true, activeEntryId };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, cleared: false, reason: 'state-changed' };
    }
    throw error;
  }
}

export function resolveClockOutActiveShift({ activeShift, requestedEntryId }) {
  if (!activeShift) {
    return { ok: false, status: 409, error: 'No active shift found', reason: 'missing-active-shift' };
  }

  if (typeof activeShift.activeEntryId !== 'string' || activeShift.activeEntryId.trim().length === 0) {
    return { ok: false, status: 409, error: 'No active shift found', reason: 'missing-active-entry-id' };
  }

  if (activeShift.activeEntryId !== requestedEntryId) {
    return { ok: false, status: 409, error: 'No active shift found', reason: 'entry-mismatch' };
  }

  return { ok: true, reason: 'match' };
}

export function getClockingErrorResponse(error) {
  const code = error?.code;
  if (code === 'ALREADY_CLOCKED_IN') {
    return { status: 409, error: 'Already Clocked In' };
  }
  if (code === 'NO_ACTIVE_SHIFT') {
    return { status: 409, error: 'No active shift found' };
  }
  if (code === 'ALREADY_CLOCKED_OUT') {
    return { status: 409, error: 'Already Clocked Out' };
  }
  if (error?.statusCode === 409) {
    return { status: 409, error: error?.error ?? 'Conflict' };
  }
  return { status: error?.statusCode ?? 400, error: error?.error ?? 'Clocking request failed' };
}

export function getClockingFailureResponse(action, error) {
  const cancellationReasons = Array.isArray(error?.CancellationReasons) ? error.CancellationReasons : [];
  const hasConditionalFailure = cancellationReasons.some((reason) => {
    const code = reason?.Code ?? reason?.code ?? '';
    return code === 'ConditionalCheckFailed';
  });

  if (error?.name === 'TransactionCanceledException') {
    if (action === 'clock-in' && hasConditionalFailure) {
      return { status: 409, error: 'Already Clocked In', code: 'ALREADY_CLOCKED_IN' };
    }
    if (action === 'clock-out' && hasConditionalFailure) {
      return { status: 409, error: 'No active shift found', code: 'NO_ACTIVE_SHIFT' };
    }
    if (action === 'switch-activity' && hasConditionalFailure) {
      return { status: 409, error: 'No active shift found', code: 'NO_ACTIVE_SHIFT' };
    }
  }

  return { status: 500, error: 'Clocking request failed' };
}

export async function getExistingClockingIdempotency({ businessId, idempotencyKey }) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: businessPk(businessId),
        SK: idempotencySk(idempotencyKey),
      },
    })
  );

  return result.Item ?? null;
}

export async function persistClockingIdempotency({ businessId, idempotencyKey, response, action, requestId, payloadHash }) {
  const now = nowIso();
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: idempotencySk(idempotencyKey),
        entityType: 'IDEMPOTENCY',
        businessId,
        requestId,
        idempotencyKey,
        action,
        payloadHash,
        response,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );
}

export async function createClockingAuditEvent({ businessId, auditEvent }) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: businessPk(businessId),
        SK: auditEventSk(auditEvent.id),
        entityType: 'AUDIT_EVENT',
        businessId,
        eventId: auditEvent.id,
        ...auditEvent,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    })
  );
}

export async function deleteActiveShiftLock({ businessId, employeeId }) {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: activeShiftPk(businessId, employeeId),
        SK: activeShiftSk(),
      },
    })
  );
}
