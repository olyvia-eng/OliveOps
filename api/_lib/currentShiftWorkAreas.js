import { createHash } from 'node:crypto';
import { tableName } from './db.js';

const MAX_RECONCILED_SEGMENTS = 40;
const MAX_TRANSACTION_ITEMS = 100;
const ABSOLUTE_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const timeEntrySk = (entryId) => `TIME#${entryId}`;
const activeShiftPk = (businessId, employeeId) => `${businessPk(businessId)}#EMPLOYEE#${employeeId}`;
const idempotencySk = (idempotencyKey) => `IDEMPOTENCY#${idempotencyKey}`;
const auditEventSk = (eventId) => `AUDIT#${eventId}`;

const failure = (code, error, status = 400) => ({ ok: false, status, code, error });
const entryJobId = (entry) => entry.jobId ?? entry.jobIds?.[0] ?? null;
const instant = (value) => typeof value === 'string' && ABSOLUTE_ISO_TIMESTAMP.test(value.trim())
  ? new Date(value.trim()).toISOString()
  : null;

function timelineSummary(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    workType: entry.workType,
    jobId: entryJobId(entry),
    workAreaId: entry.workAreaId ?? null,
    startAt: entry.clockIn,
    endAt: entry.clockOut ?? null,
  }));
}

export function currentShiftTimelineRevision(activeShift, entries) {
  return createHash('sha256').update(JSON.stringify({
    activeEntryId: activeShift.activeEntryId,
    activeShiftUpdatedAt: activeShift.updatedAt ?? null,
    timeline: timelineSummary(entries),
  })).digest('hex');
}

export function reconstructCurrentShiftTimeline({ entries, activeShift, employeeId }) {
  if (!activeShift || activeShift.employeeId !== employeeId || activeShift.status !== 'active') {
    return failure('current_shift_not_active', 'An active shift is required.', 409);
  }
  const employeeEntries = entries.filter((entry) => entry.employeeId === employeeId);
  const activeEntry = employeeEntries.find((entry) => entry.id === activeShift.activeEntryId);
  if (!activeEntry || activeEntry.status !== 'clocked_in' || activeEntry.clockOut) {
    return failure('shift_timeline_changed', 'The current shift changed. Reload and try again.', 409);
  }

  const timeline = [activeEntry];
  const includedIds = new Set([activeEntry.id]);
  while (timeline[0].createdAt !== activeShift.createdAt) {
    const first = timeline[0];
    const candidates = employeeEntries
      .filter((entry) => !includedIds.has(entry.id)
        && entry.status === 'clocked_out'
        && entry.clockOut === first.clockIn)
      .sort((left, right) => Date.parse(right.clockIn) - Date.parse(left.clockIn));
    if (candidates.length !== 1) {
      return failure('shift_timeline_unavailable', 'The current shift timeline cannot be reconciled safely.', 409);
    }
    timeline.unshift(candidates[0]);
    includedIds.add(candidates[0].id);
  }

  for (let index = 0; index < timeline.length; index += 1) {
    const entry = timeline[index];
    if (!instant(entry.clockIn)) {
      return failure('shift_timeline_unavailable', 'The current shift timeline contains an invalid boundary.', 409);
    }
    if (index < timeline.length - 1 && entry.clockOut !== timeline[index + 1].clockIn) {
      return failure('shift_timeline_unavailable', 'The current shift timeline is not contiguous.', 409);
    }
  }

  const shiftStart = Date.parse(timeline[0].clockIn);
  const outsideConflict = employeeEntries.some((entry) => {
    if (includedIds.has(entry.id)) return false;
    const start = Date.parse(entry.clockIn);
    const end = Date.parse(entry.clockOut);
    if (!Number.isFinite(start)) return true;
    return start >= shiftStart || (!Number.isFinite(end) || end > shiftStart);
  });
  if (outsideConflict) {
    return failure('shift_timeline_changed', 'The current shift conflicts with another Time Entry.', 409);
  }

  return {
    ok: true,
    timeline,
    timelineRevision: currentShiftTimelineRevision(activeShift, timeline),
  };
}

function editableBlocks(timeline) {
  const blocks = [];
  for (const entry of timeline) {
    if (entry.workType !== 'job') continue;
    const jobId = entryJobId(entry);
    if (!jobId || (Array.isArray(entry.jobIds) && entry.jobIds.length > 1)) {
      return failure('shift_timeline_unavailable', 'Legacy multi-Job segments cannot be reconciled.', 409);
    }
    const previous = blocks[blocks.length - 1];
    if (previous && previous.jobId === jobId && previous.endAt === entry.clockIn) {
      previous.endAt = entry.clockOut ?? null;
      previous.sourceEntries.push(entry);
    } else {
      blocks.push({
        jobId,
        startAt: entry.clockIn,
        endAt: entry.clockOut ?? null,
        sourceEntries: [entry],
      });
    }
  }
  return { ok: true, blocks };
}

function normalizeSubmittedSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return failure('shift_timeline_segments_required', 'At least one Job Work segment is required.');
  }
  if (segments.length > MAX_RECONCILED_SEGMENTS) {
    return failure('shift_timeline_too_large', `A maximum of ${MAX_RECONCILED_SEGMENTS} Work Area segments may be submitted.`, 409);
  }

  const normalized = [];
  for (const segment of segments) {
    const jobId = typeof segment?.jobId === 'string' ? segment.jobId.trim() : '';
    const workAreaId = typeof segment?.workAreaId === 'string' ? segment.workAreaId.trim() : '';
    const startAt = instant(segment?.startAt);
    const endAt = segment?.endAt === null ? null : instant(segment?.endAt);
    if (!jobId || !workAreaId || !startAt || (segment?.endAt !== null && !endAt)) {
      return failure('shift_timeline_segment_invalid', 'Each segment requires a valid Job, Work Area, start, and end boundary.');
    }
    if (endAt && Date.parse(endAt) <= Date.parse(startAt)) {
      return failure('shift_timeline_duration_invalid', 'Work Area segments must have a positive duration.');
    }
    normalized.push({ jobId, workAreaId, startAt, endAt });
  }
  return { ok: true, segments: normalized };
}

export function validateCurrentShiftWorkAreaSegments({ timeline, segments, jobsById, serverNow }) {
  const normalizedResult = normalizeSubmittedSegments(segments);
  if (!normalizedResult.ok) return normalizedResult;
  const blockResult = editableBlocks(timeline);
  if (!blockResult.ok) return blockResult;
  const nowMs = Date.parse(serverNow);
  let submittedIndex = 0;
  const authoritativeSegments = [];

  for (const block of blockResult.blocks) {
    let expectedStart = block.startAt;
    let blockComplete = false;
    while (!blockComplete) {
      const segment = normalizedResult.segments[submittedIndex];
      if (!segment) return failure('shift_timeline_gap', 'The submitted Work Area timeline has a gap.');
      if (segment.startAt !== expectedStart) {
        return Date.parse(segment.startAt) < Date.parse(expectedStart)
          ? failure('shift_timeline_overlap', 'The submitted Work Area timeline overlaps.')
          : failure('shift_timeline_gap', 'The submitted Work Area timeline has a gap.');
      }
      if (segment.jobId !== block.jobId) {
        return failure('shift_timeline_job_boundary_locked', 'Job boundaries in the current shift cannot be changed.', 409);
      }
      if (segment.endAt && Date.parse(segment.endAt) > nowMs) {
        return failure('shift_timeline_boundary_invalid', 'Work Area boundaries cannot be in the future.');
      }
      if (block.endAt === null) {
        if (segment.endAt === null) {
          blockComplete = true;
        } else {
          expectedStart = segment.endAt;
        }
      } else {
        if (segment.endAt === null || Date.parse(segment.endAt) > Date.parse(block.endAt)) {
          return failure('shift_timeline_boundary_locked', 'Locked shift boundaries cannot be changed.', 409);
        }
        if (segment.endAt === block.endAt) {
          blockComplete = true;
        } else {
          expectedStart = segment.endAt;
        }
      }

      const job = jobsById.get(segment.jobId);
      const area = job?.operationalWorkAreas?.find((candidate) => candidate?.id === segment.workAreaId);
      if (!job || !area || !['not_started', 'in_progress'].includes(area.status) || typeof area.name !== 'string' || !area.name.trim()) {
        return failure('job_work_area_invalid', 'The selected Work Area is not available for this Job.');
      }
      authoritativeSegments.push({
        ...segment,
        workAreaNameSnapshot: area.name.trim(),
        sourceEntries: block.sourceEntries,
      });
      submittedIndex += 1;
    }
  }

  if (submittedIndex !== normalizedResult.segments.length) {
    return failure('shift_timeline_boundary_locked', 'The submitted timeline extends outside editable Job Work boundaries.', 409);
  }
  return { ok: true, segments: authoritativeSegments, blocks: blockResult.blocks };
}

function sourceCondition(entry) {
  const names = {
    '#employeeId': 'employeeId',
    '#status': 'status',
    '#clockIn': 'clockIn',
    '#clockOut': 'clockOut',
    '#updatedAt': 'updatedAt',
  };
  const values = {
    ':employeeId': entry.employeeId,
    ':status': entry.status,
    ':clockIn': entry.clockIn,
  };
  if (entry.clockOut) values[':clockOut'] = entry.clockOut;
  if (entry.updatedAt) values[':updatedAt'] = entry.updatedAt;
  return {
    ConditionExpression: `attribute_exists(PK) AND attribute_exists(SK) AND #employeeId = :employeeId AND #status = :status AND #clockIn = :clockIn AND ${entry.clockOut ? '#clockOut = :clockOut' : 'attribute_not_exists(#clockOut)'} AND ${entry.updatedAt ? '#updatedAt = :updatedAt' : 'attribute_not_exists(#updatedAt)'}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

function replacementId(employeeId, clientRequestId, index, startAt) {
  const digest = createHash('sha256')
    .update(`${employeeId}\0${clientRequestId}\0${index}\0${startAt}`)
    .digest('hex')
    .slice(0, 32);
  return `work-area-reconcile-${digest}`;
}

function publicEntry(item) {
  return {
    id: item.entryId,
    employeeId: item.employeeId,
    jobId: item.jobId,
    jobIds: item.jobIds,
    workType: item.workType,
    workAreaId: item.workAreaId,
    workAreaNameSnapshot: item.workAreaNameSnapshot,
    unbillableCategoryId: item.unbillableCategoryId,
    unbillableCategoryName: item.unbillableCategoryName,
    clockIn: item.clockIn,
    clockOut: item.clockOut,
    breakMinutes: item.breakMinutes ?? 0,
    notes: item.notes ?? '',
    status: item.status,
    adjustmentSource: item.adjustmentSource,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildCurrentShiftWorkAreaTransaction({
  businessId,
  employee,
  userId,
  activeShift,
  sourceTimeline,
  segments,
  clientRequestId,
  idempotencyKey,
  payloadHash,
  editedAt,
}) {
  const editableSource = sourceTimeline.filter((entry) => entry.workType === 'job');
  const lockedSource = sourceTimeline.filter((entry) => entry.workType !== 'job');
  const replacementItems = segments.map((segment, index) => {
    const source = segment.sourceEntries.find((entry) => Date.parse(segment.startAt) >= Date.parse(entry.clockIn)
      && (!entry.clockOut || Date.parse(segment.startAt) < Date.parse(entry.clockOut))) ?? segment.sourceEntries[0];
    const entryId = replacementId(employee.id, clientRequestId, index, segment.startAt);
    const isShiftStart = segment.startAt === sourceTimeline[0].clockIn;
    return {
      PK: businessPk(businessId),
      SK: timeEntrySk(entryId),
      entityType: 'TIME_ENTRY',
      businessId,
      entryId,
      employeeId: employee.id,
      employeeName: employee.name,
      jobId: segment.jobId,
      jobIds: [segment.jobId],
      workType: 'job',
      workAreaId: segment.workAreaId,
      workAreaNameSnapshot: segment.workAreaNameSnapshot,
      clockIn: segment.startAt,
      clockOut: segment.endAt ?? undefined,
      clockInServerReceivedAt: segment.startAt === source.clockIn ? source.clockInServerReceivedAt : editedAt,
      clockInTimestampSource: segment.startAt === source.clockIn ? source.clockInTimestampSource : 'server',
      clockInTimeSource: segment.startAt === source.clockIn ? source.clockInTimeSource : undefined,
      requestedClockInAt: segment.startAt === source.clockIn ? source.requestedClockInAt : undefined,
      clockOutServerReceivedAt: segment.endAt && segment.endAt === source.clockOut ? source.clockOutServerReceivedAt : segment.endAt ? editedAt : undefined,
      clockOutTimestampSource: segment.endAt && segment.endAt === source.clockOut ? source.clockOutTimestampSource : segment.endAt ? 'server' : undefined,
      status: segment.endAt ? 'clocked_out' : 'clocked_in',
      breakMinutes: 0,
      notes: '',
      adjustmentSource: 'employee_self_edit',
      adjustmentRequestId: clientRequestId,
      createdAt: isShiftStart ? activeShift.createdAt : editedAt,
      updatedAt: editedAt,
    };
  });
  const resultTimeline = [
    ...lockedSource,
    ...replacementItems.map(publicEntry),
  ].sort((left, right) => Date.parse(left.clockIn) - Date.parse(right.clockIn));
  const activeResult = resultTimeline[resultTimeline.length - 1];
  if (!activeResult || activeResult.status !== 'clocked_in') {
    return failure('shift_timeline_boundary_locked', 'The active segment must remain open.', 409);
  }
  const nextActiveShift = {
    ...activeShift,
    activeEntryId: activeResult.id,
    activeEntryStartedAt: activeResult.clockIn,
    updatedAt: editedAt,
  };
  const timelineRevision = currentShiftTimelineRevision(nextActiveShift, resultTimeline);
  const response = {
    timeline: resultTimeline,
    activeEntryId: activeResult.id,
    timelineRevision,
  };
  const eventId = `${userId}:${clientRequestId}:reconcile-current-shift-work-areas`;
  const items = [
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: idempotencySk(idempotencyKey),
          entityType: 'IDEMPOTENCY',
          businessId,
          requestId: clientRequestId,
          idempotencyKey,
          action: 'reconcile_current_shift_work_areas',
          payloadHash,
          status: 'completed',
          response,
          createdAt: editedAt,
          updatedAt: editedAt,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    },
    ...editableSource.map((entry) => ({
      Delete: {
        TableName: tableName,
        Key: { PK: businessPk(businessId), SK: timeEntrySk(entry.id) },
        ...sourceCondition(entry),
      },
    })),
    ...lockedSource.map((entry) => ({
      ConditionCheck: {
        TableName: tableName,
        Key: { PK: businessPk(businessId), SK: timeEntrySk(entry.id) },
        ...sourceCondition(entry),
      },
    })),
    ...replacementItems.map((Item) => ({
      Put: {
        TableName: tableName,
        Item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    })),
    {
      Update: {
        TableName: tableName,
        Key: { PK: activeShiftPk(businessId, employee.id), SK: 'ACTIVE_SHIFT' },
        UpdateExpression: 'SET #activeEntryId = :activeEntryId, #activeEntryStartedAt = :activeEntryStartedAt, #updatedAt = :updatedAt, #timelineRevision = :timelineRevision',
        ConditionExpression: `attribute_exists(PK) AND attribute_exists(SK) AND #activeEntryId = :expectedActiveEntryId AND ${activeShift.updatedAt ? '#updatedAt = :expectedUpdatedAt' : 'attribute_not_exists(#updatedAt)'}`,
        ExpressionAttributeNames: {
          '#activeEntryId': 'activeEntryId',
          '#activeEntryStartedAt': 'activeEntryStartedAt',
          '#updatedAt': 'updatedAt',
          '#timelineRevision': 'timelineRevision',
        },
        ExpressionAttributeValues: {
          ':activeEntryId': activeResult.id,
          ':activeEntryStartedAt': activeResult.clockIn,
          ':updatedAt': editedAt,
          ':timelineRevision': timelineRevision,
          ':expectedActiveEntryId': activeShift.activeEntryId,
          ...(activeShift.updatedAt ? { ':expectedUpdatedAt': activeShift.updatedAt } : {}),
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: auditEventSk(eventId),
          entityType: 'AUDIT_EVENT',
          businessId,
          eventId,
          action: 'employee_shift_work_areas_reconciled',
          actorUserId: userId,
          actorName: employee.name || userId,
          actorEmail: employee.email ?? '',
          affectedEntryCount: editableSource.length + replacementItems.length,
          createdAt: editedAt,
          metadata: {
            employeeId: employee.id,
            shiftIdentifier: activeShift.createdAt,
            editedAt,
            source: 'employee_self_edit',
            originalSegments: timelineSummary(sourceTimeline),
            resultSegments: timelineSummary(resultTimeline),
          },
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    },
  ];
  if (items.length > MAX_TRANSACTION_ITEMS) {
    return failure('shift_timeline_too_large', 'This shift has too many segments to reconcile safely.', 409);
  }
  return { ok: true, transaction: { TransactItems: items }, response };
}

export function currentShiftTimelineResponse(snapshot, canEdit) {
  return {
    timeline: snapshot.timeline,
    activeEntryId: snapshot.timeline[snapshot.timeline.length - 1]?.id ?? null,
    timelineRevision: snapshot.timelineRevision,
    canEdit,
  };
}
