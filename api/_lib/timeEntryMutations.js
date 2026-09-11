import { randomUUID } from 'node:crypto';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import {
  getEmployeeForBusiness,
  getJobForBusiness,
  getTimeEntryForBusiness,
  getUnbillableTimeCategoryForBusiness,
  listTimeEntriesForBusiness,
} from './authRepo.js';
import { getPendingClockOutWorkflowForEmployee } from './mandatoryClockOut.js';
import { getActiveShiftForEmployee } from './clocking.js';
import { calculateEmployeeLabourCost } from '../../src/utils/employeeLabourCost.js';
import { timeEntryIndexAttributes } from './timeEntryPagination.js';

const VALID_WORK_TYPES = new Set(['job', 'drive_time', 'non_billable']);
const MAX_EDIT_AGE_MS = 10 * 366 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const timeEntrySk = (timeEntryId) => `TIME#${timeEntryId}`;
const correctionSk = (correctionId) => `TIME_CORRECTION#${correctionId}`;
const auditSk = (eventId) => `AUDIT#${eventId}`;
const activeShiftPk = (businessId, employeeId) => `${businessPk(businessId)}#EMPLOYEE#${employeeId}`;

export function canDirectlyEditTimeEntries(session) {
  return session?.role === 'owner' || session?.role === 'admin';
}

export async function deleteTimeEntryMutation({
  session,
  timeEntryId,
  now = new Date().toISOString(),
  dependencies: dependencyOverrides = {},
}) {
  if (!canDirectlyEditTimeEntries(session)) {
    return { ok: false, status: 403, code: 'time_entry_delete_forbidden', error: 'You do not have permission to delete Time Entries.' };
  }

  const dependencies = {
    getTimeEntryForBusiness,
    getActiveShiftForEmployee,
    getPendingClockOutWorkflowForEmployee,
    transactWrite: (input) => ddb.send(new TransactWriteCommand(input)),
    ...dependencyOverrides,
  };
  const existing = await dependencies.getTimeEntryForBusiness(session.businessId, timeEntryId);
  if (!existing) return { ok: false, status: 404, code: 'time_entry_not_found', error: 'Time Entry not found.' };

  const pendingClockOut = await dependencies.getPendingClockOutWorkflowForEmployee(session.businessId, existing.employeeId);
  if (pendingClockOut?.timeEntryId === existing.id) {
    return { ok: false, status: 409, code: 'pending_clock_out_conflict', error: 'Complete the pending clock-out workflow before deleting this Time Entry.' };
  }
  const activeShift = existing.status === 'clocked_in'
    ? await dependencies.getActiveShiftForEmployee({ businessId: session.businessId, employeeId: existing.employeeId, consistentRead: true })
    : null;
  if (activeShift && activeShift.activeEntryId !== existing.id) {
    return { ok: false, status: 409, code: 'active_shift_conflict', error: 'Employee clock state changed. Refresh and try again.' };
  }

  const eventId = randomUUID();
  const duration = existing.clockOut
    ? Math.max(0, (Date.parse(existing.clockOut) - Date.parse(existing.clockIn)) / 3_600_000 - Number(existing.breakMinutes ?? 0) / 60)
    : 0;

  try {
    const transactItems = [
        {
          Delete: {
            TableName: tableName,
            Key: { PK: businessPk(session.businessId), SK: timeEntrySk(existing.id) },
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #entryId = :entryId',
            ExpressionAttributeNames: { '#entryId': 'entryId' },
            ExpressionAttributeValues: { ':entryId': existing.id },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              PK: businessPk(session.businessId),
              SK: auditSk(eventId),
              entityType: 'AUDIT_EVENT',
              businessId: session.businessId,
              eventId,
              action: 'time_entry_deleted',
              actorUserId: session.id,
              actorName: session.name ?? '',
              actorEmail: session.email ?? '',
              affectedEntryCount: 1,
              createdAt: now,
              metadata: {
                timeEntryId: existing.id,
                employeeId: existing.employeeId,
                deletedBy: session.id,
                timestamp: now,
                originalClockIn: existing.clockIn,
                originalClockOut: existing.clockOut ?? null,
                workType: existing.workType ?? 'job',
                jobId: existing.jobId ?? existing.jobIds?.[0] ?? null,
                workAreaId: existing.workAreaId ?? null,
                originalDurationHours: duration,
              },
            },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ];
    if (activeShift) {
      transactItems.push({
        Delete: {
          TableName: tableName,
          Key: { PK: activeShiftPk(session.businessId, existing.employeeId), SK: 'ACTIVE_SHIFT' },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #activeEntryId = :entryId',
          ExpressionAttributeNames: { '#activeEntryId': 'activeEntryId' },
          ExpressionAttributeValues: { ':entryId': existing.id },
        },
      });
    }
    await dependencies.transactWrite({ TransactItems: transactItems });
    return { ok: true, deletedTimeEntryId: existing.id, auditEventId: eventId };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, status: 404, code: 'time_entry_not_found', error: 'Time Entry not found.' };
    }
    throw error;
  }
}

function editableValues(entry) {
  return {
    clockIn: entry.clockIn,
    clockOut: entry.clockOut,
    jobId: entry.jobId,
    jobIds: entry.jobIds,
    workType: entry.workType,
    workAreaId: entry.workAreaId ?? null,
    workAreaNameSnapshot: entry.workAreaNameSnapshot ?? null,
    unbillableCategoryId: entry.unbillableCategoryId,
    unbillableCategoryName: entry.unbillableCategoryName,
    notes: entry.notes ?? '',
    labourCostRateSnapshot: entry.labourCostRateSnapshot,
    labourCostTotalSnapshot: entry.labourCostTotalSnapshot,
  };
}

function labourCostSnapshot(employee, entry) {
  if (!entry.clockOut) {
    return {
      labourCostRateSnapshot: entry.labourCostRateSnapshot,
      labourCostTotalSnapshot: undefined,
    };
  }
  const durationHours = Math.max(0, (Date.parse(entry.clockOut) - Date.parse(entry.clockIn)) / 3600000 - Number(entry.breakMinutes ?? 0) / 60);
  const labourCostRateSnapshot = typeof entry.labourCostRateSnapshot === 'number' && Number.isFinite(entry.labourCostRateSnapshot)
    ? entry.labourCostRateSnapshot
    : calculateEmployeeLabourCost(employee).labourCostPerPaidHour;
  if (!Number.isFinite(labourCostRateSnapshot)) return {};
  return { labourCostRateSnapshot, labourCostTotalSnapshot: durationHours * labourCostRateSnapshot };
}

function overlaps(left, right) {
  const leftStart = Date.parse(left.clockIn);
  const leftEnd = left.clockOut ? Date.parse(left.clockOut) : Number.POSITIVE_INFINITY;
  const rightStart = Date.parse(right.clockIn);
  const rightEnd = right.clockOut ? Date.parse(right.clockOut) : Number.POSITIVE_INFINITY;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function toIsoOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function resolveActivity({ businessId, workType, jobId, workAreaId, unbillableCategoryId, dependencies }) {
  if (!VALID_WORK_TYPES.has(workType)) {
    return { ok: false, status: 400, code: 'time_entry_activity_invalid', error: 'Activity type is invalid.' };
  }

  if (workType === 'job') {
    if (!jobId) return { ok: false, status: 400, code: 'time_entry_job_required', error: 'Job Work requires a Job.' };
    const job = await dependencies.getJobForBusiness(businessId, jobId);
    if (!job) return { ok: false, status: 400, code: 'time_entry_job_invalid', error: 'Job is invalid.' };
    const normalizedWorkAreaId = typeof workAreaId === 'string' && workAreaId.trim() ? workAreaId.trim() : null;
    const workArea = normalizedWorkAreaId
      ? (Array.isArray(job.operationalWorkAreas) ? job.operationalWorkAreas : []).find((area) => area?.id === normalizedWorkAreaId)
      : null;
    if (normalizedWorkAreaId && (!workArea || typeof workArea.name !== 'string' || !workArea.name.trim())) {
      return { ok: false, status: 400, code: 'time_entry_work_area_invalid', error: 'Work Area is not part of the selected Job.' };
    }
    if (dependencies.requireOperationalWorkArea && Array.isArray(job.operationalWorkAreas) && job.operationalWorkAreas.length > 0 && !workArea) {
      return { ok: false, status: 400, code: 'time_entry_work_area_required', error: 'Job Work requires a Work Area for this Job.' };
    }
    return {
      ok: true,
      jobId,
      jobIds: [jobId],
      workAreaId: normalizedWorkAreaId,
      workAreaNameSnapshot: workArea?.name.trim() ?? null,
      unbillableCategoryId: undefined,
      unbillableCategoryName: undefined,
    };
  }

  const contextualJobId = typeof jobId === 'string' && jobId.trim() ? jobId.trim() : undefined;
  if (contextualJobId && !await dependencies.getJobForBusiness(businessId, contextualJobId)) {
    return { ok: false, status: 400, code: 'time_entry_job_invalid', error: 'Job is invalid.' };
  }

  if (workType === 'non_billable') {
    const category = await dependencies.getUnbillableTimeCategoryForBusiness(businessId, unbillableCategoryId);
    if (!category?.active) {
      return { ok: false, status: 400, code: 'time_entry_unbillable_category_invalid', error: 'Non-Billable activity requires an active category.' };
    }
    return {
      ok: true,
      jobId: contextualJobId,
      jobIds: contextualJobId ? [contextualJobId] : [],
      workAreaId: undefined,
      workAreaNameSnapshot: undefined,
      unbillableCategoryId: category.id,
      unbillableCategoryName: category.name,
    };
  }

  return {
    ok: true,
    jobId: contextualJobId,
    jobIds: contextualJobId ? [contextualJobId] : [],
    workAreaId: undefined,
    workAreaNameSnapshot: undefined,
    unbillableCategoryId: undefined,
    unbillableCategoryName: undefined,
  };
}

export async function createManualTimeEntryMutation({
  session,
  input,
  now = new Date().toISOString(),
  dependencies: dependencyOverrides = {},
}) {
  if (!canDirectlyEditTimeEntries(session)) {
    return { ok: false, status: 403, code: 'time_entry_create_forbidden', error: 'You do not have permission to add Time Entries.' };
  }

  const dependencies = {
    getEmployeeForBusiness,
    getJobForBusiness,
    getUnbillableTimeCategoryForBusiness,
    listTimeEntriesForBusiness,
    transactWrite: (transaction) => ddb.send(new TransactWriteCommand(transaction)),
    requireOperationalWorkArea: true,
    ...dependencyOverrides,
  };
  const employeeId = typeof input?.employeeId === 'string' ? input.employeeId.trim() : '';
  const employee = employeeId ? await dependencies.getEmployeeForBusiness(session.businessId, employeeId) : null;
  if (!employee) return { ok: false, status: 400, code: 'time_entry_employee_invalid', error: 'Employee is invalid.' };

  const clockIn = toIsoOrNull(input?.clockIn);
  const clockOut = toIsoOrNull(input?.clockOut);
  if (!clockIn || !clockOut) {
    return { ok: false, status: 400, code: 'time_entry_time_invalid', error: 'Clock In and Clock Out must be valid dates.' };
  }
  if (Date.parse(clockOut) <= Date.parse(clockIn)) {
    return { ok: false, status: 400, code: 'time_entry_duration_invalid', error: 'Clock Out must be after Clock In.' };
  }
  const nowMs = Date.parse(now);
  if (Date.parse(clockIn) < nowMs - MAX_EDIT_AGE_MS || Date.parse(clockIn) > nowMs + MAX_FUTURE_SKEW_MS || Date.parse(clockOut) > nowMs + MAX_FUTURE_SKEW_MS) {
    return { ok: false, status: 400, code: 'time_entry_date_out_of_bounds', error: 'Time Entry dates are outside the supported range.' };
  }

  const activity = await resolveActivity({
    businessId: session.businessId,
    workType: input?.workType,
    jobId: input?.jobId,
    workAreaId: input?.workAreaId,
    unbillableCategoryId: input?.unbillableCategoryId,
    dependencies,
  });
  if (!activity.ok) return activity;

  const notes = typeof input?.notes === 'string' ? input.notes.trim() : '';
  if (notes.length > 5000) {
    return { ok: false, status: 400, code: 'time_entry_notes_too_long', error: 'Notes cannot exceed 5000 characters.' };
  }
  const timeEntryId = randomUUID();
  const timeEntry = {
    id: timeEntryId,
    employeeId,
    employeeName: employee.name ?? '',
    ...activity,
    workType: input.workType,
    clockIn,
    clockOut,
    breakMinutes: 0,
    notes,
    status: 'clocked_out',
    source: 'manual_admin',
    createdByUserId: session.id,
    createdAt: now,
    updatedAt: now,
  };
  Object.assign(timeEntry, labourCostSnapshot(employee, timeEntry));

  const entries = await dependencies.listTimeEntriesForBusiness(session.businessId, { consistentRead: true });
  if (entries.some((entry) => entry.employeeId === employeeId && overlaps(timeEntry, entry))) {
    return { ok: false, status: 409, code: 'time_entry_overlap', error: 'This Time Entry overlaps another Time Entry for the employee.' };
  }

  const eventId = randomUUID();
  try {
    await dependencies.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: {
              PK: businessPk(session.businessId),
              SK: timeEntrySk(timeEntryId),
              entityType: 'TIME_ENTRY',
              businessId: session.businessId,
              entryId: timeEntryId,
              ...timeEntry,
              ...timeEntryIndexAttributes(session.businessId, timeEntry),
            },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              PK: businessPk(session.businessId),
              SK: auditSk(eventId),
              entityType: 'AUDIT_EVENT',
              businessId: session.businessId,
              eventId,
              action: 'time_entry_created',
              actorUserId: session.id,
              actorName: session.name ?? '',
              actorEmail: session.email ?? '',
              affectedEntryCount: 1,
              createdAt: now,
              metadata: {
                timeEntryId,
                employeeId,
                createdByUserId: session.id,
                source: 'manual_admin',
                clockIn,
                clockOut,
                workType: input.workType,
                jobId: activity.jobId ?? null,
                workAreaId: activity.workAreaId ?? null,
                unbillableCategoryId: activity.unbillableCategoryId ?? null,
              },
            },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
    return { ok: true, timeEntry, auditEventId: eventId };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, status: 409, code: 'time_entry_conflict', error: 'Time Entry could not be added. Refresh and try again.' };
    }
    throw error;
  }
}

export async function applyTimeEntryMutation({
  session,
  timeEntryId,
  expectedUpdatedAt,
  changes,
  reason = '',
  correction,
  now = new Date().toISOString(),
  dependencies: dependencyOverrides = {},
}) {
  const dependencies = {
    getEmployeeForBusiness,
    getJobForBusiness,
    getTimeEntryForBusiness,
    getUnbillableTimeCategoryForBusiness,
    listTimeEntriesForBusiness,
    getPendingClockOutWorkflowForEmployee,
    transactWrite: (input) => ddb.send(new TransactWriteCommand(input)),
    ...dependencyOverrides,
  };
  const existing = await dependencies.getTimeEntryForBusiness(session.businessId, timeEntryId);
  if (!existing) return { ok: false, status: 404, code: 'time_entry_not_found', error: 'Time Entry not found.' };
  if ((existing.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) {
    return { ok: false, status: 409, code: 'time_entry_conflict', error: 'This Time Entry changed after it was opened. Reload and try again.' };
  }

  const employee = await dependencies.getEmployeeForBusiness(session.businessId, existing.employeeId);
  if (!employee) return { ok: false, status: 400, code: 'time_entry_employee_invalid', error: 'Employee is invalid.' };

  const clockIn = toIsoOrNull(changes.clockIn);
  const clockOut = toIsoOrNull(changes.clockOut) ?? undefined;
  if (!clockIn || (changes.clockOut && !clockOut)) {
    return { ok: false, status: 400, code: 'time_entry_time_invalid', error: 'Clock In and Clock Out must be valid dates.' };
  }
  if (existing.status === 'clocked_in' && clockOut) {
    return { ok: false, status: 409, code: 'active_time_entry_clock_out_forbidden', error: 'Use Clock Out to close an active Time Entry.' };
  }
  if (existing.status === 'clocked_out' && !clockOut) {
    return { ok: false, status: 400, code: 'time_entry_clock_out_required', error: 'Clock Out is required for a completed Time Entry.' };
  }
  if (clockOut && Date.parse(clockOut) <= Date.parse(clockIn)) {
    return { ok: false, status: 400, code: 'time_entry_duration_invalid', error: 'Clock Out must be after Clock In.' };
  }

  const nowMs = Date.parse(now);
  const clockInMs = Date.parse(clockIn);
  const clockOutMs = clockOut ? Date.parse(clockOut) : null;
  if (clockInMs < nowMs - MAX_EDIT_AGE_MS || clockInMs > nowMs + MAX_FUTURE_SKEW_MS || (clockOutMs !== null && clockOutMs > nowMs + MAX_FUTURE_SKEW_MS)) {
    return { ok: false, status: 400, code: 'time_entry_date_out_of_bounds', error: 'Time Entry dates are outside the supported edit range.' };
  }

  if (existing.status === 'clocked_in') {
    const pendingClockOut = await dependencies.getPendingClockOutWorkflowForEmployee(session.businessId, existing.employeeId);
    if (pendingClockOut?.timeEntryId === existing.id) {
      return { ok: false, status: 409, code: 'pending_clock_out_conflict', error: 'Complete the pending clock-out workflow before editing this active Time Entry.' };
    }
  }

  const activity = await resolveActivity({
    businessId: session.businessId,
    workType: changes.workType,
    jobId: changes.jobId,
    workAreaId: changes.workAreaId,
    unbillableCategoryId: changes.unbillableCategoryId,
    dependencies,
  });
  if (!activity.ok) return activity;

  const next = {
    ...existing,
    ...activity,
    clockIn,
    clockOut,
    workType: changes.workType,
    notes: typeof changes.notes === 'string' ? changes.notes.trim() : '',
    updatedAt: now,
  };
  if (next.notes.length > 5000) {
    return { ok: false, status: 400, code: 'time_entry_notes_too_long', error: 'Notes cannot exceed 5000 characters.' };
  }
  if (reason.length > 1000) {
    return { ok: false, status: 400, code: 'time_entry_reason_too_long', error: 'Reason for change cannot exceed 1000 characters.' };
  }

  const entries = await dependencies.listTimeEntriesForBusiness(session.businessId, { consistentRead: true });
  const conflict = entries.find((entry) => entry.id !== existing.id && entry.employeeId === existing.employeeId && overlaps(next, entry));
  if (conflict) {
    return { ok: false, status: 409, code: 'time_entry_overlap', error: 'This change overlaps another Time Entry for the employee.' };
  }

  Object.assign(next, labourCostSnapshot(employee, next));
  const eventId = randomUUID();
  const oldValues = editableValues(existing);
  const newValues = editableValues(next);
  const conditionExpression = existing.updatedAt
    ? '#updatedAt = :expectedUpdatedAt'
    : 'attribute_not_exists(#updatedAt)';
  const timeEntryPut = {
    TableName: tableName,
    Item: {
      PK: businessPk(session.businessId),
      SK: timeEntrySk(existing.id),
      entityType: 'TIME_ENTRY',
      businessId: session.businessId,
      entryId: existing.id,
      ...next,
      ...timeEntryIndexAttributes(session.businessId, next),
    },
    ConditionExpression: `attribute_exists(PK) AND attribute_exists(SK) AND ${conditionExpression}`,
    ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
    ...(existing.updatedAt ? { ExpressionAttributeValues: { ':expectedUpdatedAt': expectedUpdatedAt } } : {}),
  };
  const auditPut = {
    TableName: tableName,
    Item: {
      PK: businessPk(session.businessId),
      SK: auditSk(eventId),
      entityType: 'AUDIT_EVENT',
      businessId: session.businessId,
      eventId,
      action: correction ? 'time_correction_approved' : 'time_entry_edited',
      actorUserId: session.id,
      actorName: session.name ?? '',
      actorEmail: session.email ?? '',
      affectedEntryCount: 1,
      createdAt: now,
      metadata: {
        timeEntryId: existing.id,
        employeeId: existing.employeeId,
        changedByUserId: session.id,
        changedAt: now,
        reason,
        correctionId: correction?.id,
        oldValues,
        newValues,
      },
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  };
  const transactItems = [{ Put: timeEntryPut }, { Put: auditPut }];

  if (correction) {
    transactItems.push({
      Update: {
        TableName: tableName,
        Key: { PK: businessPk(session.businessId), SK: correctionSk(correction.id) },
        UpdateExpression: 'SET #status = :approved, #reviewedByUserId = :reviewedByUserId, #reviewedAt = :reviewedAt, #reviewNote = :reviewNote, #updatedAt = :updatedAt, #mutationAppliedAt = :mutationAppliedAt, #appliedTimeEntryUpdatedAt = :appliedTimeEntryUpdatedAt',
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#reviewedByUserId': 'reviewedByUserId',
          '#reviewedAt': 'reviewedAt',
          '#reviewNote': 'reviewNote',
          '#updatedAt': 'updatedAt',
          '#mutationAppliedAt': 'mutationAppliedAt',
          '#appliedTimeEntryUpdatedAt': 'appliedTimeEntryUpdatedAt',
        },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':approved': 'approved',
          ':reviewedByUserId': session.id,
          ':reviewedAt': now,
          ':reviewNote': reason,
          ':updatedAt': now,
          ':mutationAppliedAt': now,
          ':appliedTimeEntryUpdatedAt': now,
        },
      },
    });
  }

  try {
    await dependencies.transactWrite({ TransactItems: transactItems });
    return { ok: true, timeEntry: next, auditEventId: eventId };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      return { ok: false, status: 409, code: 'time_entry_conflict', error: 'This Time Entry changed after it was opened. Reload and try again.' };
    }
    throw error;
  }
}
