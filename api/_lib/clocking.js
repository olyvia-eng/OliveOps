import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

function nowIso() {
  return new Date().toISOString();
}

export const DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS = 12;
export const MAX_CLOCK_OUT_PHOTO_ATTACHMENTS = 5;

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
  requestId,
  idempotencyKey,
  payloadHash,
  source,
  auditEventId,
  jobIds = [],
  workType = 'job',
  unbillableCategoryId,
  unbillableCategoryName,
  employeeName = '',
}) {
  const now = clockInAt ?? nowIso();
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
    unbillableCategoryId: workType === 'non_billable' ? unbillableCategoryId : undefined,
    unbillableCategoryName: workType === 'non_billable' ? unbillableCategoryName : undefined,
    clockIn: now,
    status: 'clocked_in',
    breakMinutes: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  };

  const lockItem = {
    PK: activeShiftPk(businessId, employeeId),
    SK: activeShiftSk(),
    entityType: 'ACTIVE_SHIFT',
    businessId,
    employeeId,
    activeEntryId: timeEntryId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
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
    createdAt: now,
    metadata: {
      employeeId,
      timeEntryId,
      source,
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
      unbillableCategoryId: workType === 'non_billable' ? unbillableCategoryId : undefined,
      unbillableCategoryName: workType === 'non_billable' ? unbillableCategoryName : undefined,
      clockIn: now,
      breakMinutes: 0,
      notes: '',
      status: 'clocked_in',
    },
    createdAt: now,
    updatedAt: now,
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
  clockIn,
  employeeName = '',
}) {
  const now = clockOutAt ?? nowIso();
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
      clockIn,
      clockOut: now,
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
    },
    createdAt: now,
    updatedAt: now,
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
    createdAt: now,
    metadata: {
      employeeId,
      timeEntryId,
      source,
    },
  };

  const updateExpressionParts = [
    '#status = :status',
    '#clockOut = :clockOut',
    '#breakMinutes = :breakMinutes',
    '#notes = :notes',
    '#updatedAt = :updatedAt',
  ];
  const expressionAttributeNames = {
    '#status': 'status',
    '#clockOut': 'clockOut',
    '#breakMinutes': 'breakMinutes',
    '#notes': 'notes',
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues = {
    ':status': 'clocked_out',
    ':clockOut': now,
    ':breakMinutes': breakMinutes,
    ':notes': notes,
    ':updatedAt': now,
    ':clockedIn': 'clocked_in',
  };

  if (hasPhotoAttachment) {
    updateExpressionParts.push('#photoAttachmentUrl = :photoAttachmentUrl');
    expressionAttributeNames['#photoAttachmentUrl'] = 'photoAttachmentUrl';
    expressionAttributeValues[':photoAttachmentUrl'] = photoAttachmentUrl;
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
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :clockedIn',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
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

export function buildSwitchActivityTransaction({
  businessId,
  employeeId,
  userId,
  previousTimeEntry,
  nextTimeEntry,
  switchedAt,
  requestId,
  idempotencyKey,
  payloadHash,
  source,
  auditEventId,
  employeeName = '',
}) {
  const now = switchedAt ?? nowIso();
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
      unbillableCategoryId: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryId : undefined,
      unbillableCategoryName: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryName : undefined,
      clockIn: now,
      breakMinutes: 0,
      notes: '',
      status: 'clocked_in',
    },
    createdAt: now,
    updatedAt: now,
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
    unbillableCategoryId: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryId : undefined,
    unbillableCategoryName: nextTimeEntry.workType === 'non_billable' ? nextTimeEntry.unbillableCategoryName : undefined,
    clockIn: now,
    status: 'clocked_in',
    breakMinutes: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
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
    createdAt: now,
    metadata: {
      employeeId,
      previousTimeEntryId: previousTimeEntry.id,
      newTimeEntryId: nextTimeEntry.id,
      previousWorkType: previousTimeEntry.workType,
      newWorkType: nextTimeEntry.workType,
      previousJobIds: Array.isArray(previousTimeEntry.jobIds) ? previousTimeEntry.jobIds : [],
      newJobIds: Array.isArray(nextTimeEntry.jobIds) ? nextTimeEntry.jobIds : [],
      source,
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
          UpdateExpression: 'SET #status = :status, #clockOut = :clockOut, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :clockedIn',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#clockOut': 'clockOut',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':status': 'clocked_out',
            ':clockOut': now,
            ':updatedAt': now,
            ':clockedIn': 'clocked_in',
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
          UpdateExpression: 'SET #activeEntryId = :newEntryId, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #activeEntryId = :previousEntryId',
          ExpressionAttributeNames: {
            '#activeEntryId': 'activeEntryId',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':newEntryId': nextTimeEntry.id,
            ':previousEntryId': previousTimeEntry.id,
            ':updatedAt': now,
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

export async function getActiveShiftForEmployee({ businessId, employeeId }) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: activeShiftPk(businessId, employeeId),
        SK: activeShiftSk(),
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  return {
    businessId,
    employeeId,
    activeEntryId: result.Item.activeEntryId,
    status: result.Item.status,
    createdAt: result.Item.createdAt,
    updatedAt: result.Item.updatedAt,
  };
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
