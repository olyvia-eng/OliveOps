import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './db.js';
import {
  buildClockInTransaction,
  buildClockOutTransaction,
  clearOrphanActiveShiftForEmployee,
  getActiveShiftForEmployee,
  getClockingFailureResponse,
  resolveClockOutActiveShift,
} from './clocking.js';
import {
  getEmployeeForBusiness,
  getTimeEntryForBusiness,
  getUnbillableTimeCategoryForBusiness,
  listTimeEntriesForBusiness,
} from './authRepo.js';
import {
  buildClockInWorkflowFinalizationItems,
  clockInWorkflowStatus,
  getClockInWorkflowForBusiness,
} from './mandatoryClockIn.js';
import {
  buildWorkflowFinalizationItems,
  clockOutWorkflowStatus,
  getClockOutWorkflowForBusiness,
  getPendingClockOutWorkflowForEmployee,
} from './mandatoryClockOut.js';
import { WORK_AREA_CLOCKING_CONTRACT_VERSION } from './jobWorkAreas.js';
import { calculateEmployeeLabourCost } from '../../src/utils/employeeLabourCost.js';
import { canClockForEmployee } from './authorization.js';

const VALID_WORK_TYPES = new Set(['job', 'drive_time', 'non_billable']);

const nowIso = () => new Date().toISOString();

function labourCostSnapshot(employee, clockIn, clockOut, breakMinutes = 0) {
  if (!employee) return {};
  const start = Date.parse(clockIn ?? '');
  const end = Date.parse(clockOut ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {};
  const hours = Math.max(0, (end - start) / 3600000 - Number(breakMinutes ?? 0) / 60);
  const labourCostRateSnapshot = calculateEmployeeLabourCost(employee).labourCostPerPaidHour;
  if (!Number.isFinite(labourCostRateSnapshot)) return {};
  return { labourCostRateSnapshot, labourCostTotalSnapshot: hours * labourCostRateSnapshot };
}

function hasClockInTimelineConflict(entries, employeeId, eventOccurredAt) {
  const eventMs = Date.parse(eventOccurredAt);
  return entries.some((entry) => {
    if (entry.employeeId !== employeeId) return false;
    const clockInMs = Date.parse(entry.clockIn);
    const clockOutMs = Date.parse(entry.clockOut);
    if (Number.isNaN(clockInMs)) return true;
    if (entry.status === 'clocked_in' || Number.isNaN(clockOutMs)) return true;
    return clockInMs >= eventMs || clockOutMs > eventMs;
  });
}

async function resolvePersistedClockInIntent(businessId, intent) {
  if (!VALID_WORK_TYPES.has(intent?.workType)) {
    return { ok: false, status: 409, code: 'clock_in_intent_invalid', error: 'Saved clock-in work type is invalid.' };
  }

  let workArea = { ok: true, workAreaId: null, workAreaNameSnapshot: null };
  if (intent.workType === 'job') {
    if (!Array.isArray(intent.jobIds) || intent.jobIds.length === 0
      || (Number(intent.clockingContractVersion) >= WORK_AREA_CLOCKING_CONTRACT_VERSION && intent.jobIds.length !== 1)) {
      return { ok: false, status: 409, code: 'clock_in_intent_invalid', error: 'Saved clock-in Job selection is invalid.' };
    }
    workArea = {
      ok: true,
      workAreaId: intent.workAreaId ?? null,
      workAreaNameSnapshot: intent.workAreaNameSnapshot ?? null,
    };
  }

  let unbillableCategory;
  if (intent.workType === 'non_billable') {
    unbillableCategory = await getUnbillableTimeCategoryForBusiness(businessId, intent.unbillableCategoryId);
    if (!unbillableCategory?.active) {
      return { ok: false, status: 409, code: 'clock_in_intent_invalid', error: 'Saved unbillable category is invalid or inactive.' };
    }
  }

  return { ok: true, workArea, unbillableCategory };
}

export async function finalizePendingClockIn({ session, workflowOccurrenceId }) {
  const workflow = await getClockInWorkflowForBusiness(session.businessId, workflowOccurrenceId);
  if (!workflow) return { ok: false, status: 404, code: 'clock_in_workflow_not_found', error: 'Clock-in workflow not found.' };
  if (!canClockForEmployee(session, workflow.employeeId)) {
    return { ok: false, status: 403, code: 'clock_in_workflow_forbidden', error: 'Forbidden' };
  }
  if (workflow.status === 'finalized') return { ok: true, status: 'clock_in_already_finalized', timeEntry: workflow.timeEntry };

  const workflowState = clockInWorkflowStatus(workflow);
  if (workflowState.remainingRequiredFormCount > 0) {
    return { ok: false, status: 409, code: 'required_forms_outstanding', workflow: workflowState };
  }
  const pendingClockOut = await getPendingClockOutWorkflowForEmployee(session.businessId, workflow.employeeId);
  if (pendingClockOut) {
    return {
      ok: false,
      status: 409,
      code: 'pending_clock_out_requires_finalization',
      error: 'Complete the pending clock-out workflow before clocking in.',
      pendingClockOutWorkflow: clockOutWorkflowStatus(pendingClockOut),
    };
  }

  const employee = await getEmployeeForBusiness(session.businessId, workflow.employeeId);
  if (!employee?.active) return { ok: false, status: 409, code: 'employee_form_context_unavailable', error: 'Active employee form context is unavailable.' };
  const intentResult = await resolvePersistedClockInIntent(session.businessId, workflow.clockInIntent);
  if (!intentResult.ok) return intentResult;

  const activeEntries = await listTimeEntriesForBusiness(session.businessId, { consistentRead: true });
  if (activeEntries.some((entry) => entry.employeeId === workflow.employeeId && entry.status === 'clocked_in')) {
    return { ok: false, status: 409, code: 'offline_shift_state_conflict', error: 'Employee is already clocked in.' };
  }
  const activeShiftIntegrity = await clearOrphanActiveShiftForEmployee({ businessId: session.businessId, employeeId: workflow.employeeId });
  if (!activeShiftIntegrity.ok) return { ok: false, status: 409, code: 'offline_shift_state_conflict', error: 'Employee clock state changed. Refresh and try again.' };

  const finalizedAt = nowIso();
  if (hasClockInTimelineConflict(activeEntries, workflow.employeeId, finalizedAt)) {
    return { ok: false, status: 409, code: 'offline_event_order_conflict', error: 'Clocking event time conflicts with the employee timeline.' };
  }

  const intent = workflow.clockInIntent;
  const timeEntry = {
    id: `${workflow.employeeId}:${finalizedAt}`,
    employeeId: workflow.employeeId,
    jobId: intent.jobIds?.[0],
    jobIds: intent.jobIds ?? [],
    workType: intent.workType,
    workAreaId: intentResult.workArea.workAreaId,
    workAreaNameSnapshot: intentResult.workArea.workAreaNameSnapshot,
    unbillableCategoryId: intentResult.unbillableCategory?.id,
    unbillableCategoryName: intentResult.unbillableCategory?.name,
    clockIn: finalizedAt,
    breakMinutes: 0,
    notes: '',
    status: 'clocked_in',
  };
  const tx = buildClockInTransaction({
    businessId: session.businessId,
    employeeId: workflow.employeeId,
    userId: session.id,
    timeEntryId: timeEntry.id,
    clockInAt: finalizedAt,
    serverReceivedAt: finalizedAt,
    timestampSource: 'server',
    requestId: workflow.requestId,
    idempotencyKey: workflow.idempotencyKey,
    payloadHash: workflow.payloadHash,
    source: 'mandatory_forms',
    auditEventId: `${session.id}:${workflow.requestId}:clock-in`,
    jobIds: intent.jobIds ?? [],
    workType: intent.workType,
    workAreaId: timeEntry.workAreaId,
    workAreaNameSnapshot: timeEntry.workAreaNameSnapshot,
    unbillableCategoryId: timeEntry.unbillableCategoryId,
    unbillableCategoryName: timeEntry.unbillableCategoryName,
    employeeName: employee.name,
    workflowFinalizationItems: buildClockInWorkflowFinalizationItems({ businessId: session.businessId, workflow, finalizedAt, timeEntry }),
  });

  try {
    await ddb.send(new TransactWriteCommand(tx));
    return { ok: true, status: 'clock_in_completed', timeEntry };
  } catch (error) {
    const current = await getClockInWorkflowForBusiness(session.businessId, workflowOccurrenceId);
    if (current?.status === 'finalized') return { ok: true, status: 'clock_in_already_finalized', timeEntry: current.timeEntry };
    const failure = getClockingFailureResponse('clock-in', error);
    return { ok: false, status: failure.status, code: 'offline_shift_state_conflict', error: failure.error };
  }
}

export async function finalizePendingClockOut({ session, workflowOccurrenceId }) {
  const workflow = await getClockOutWorkflowForBusiness(session.businessId, workflowOccurrenceId);
  if (!workflow) return { ok: false, status: 404, code: 'clock_out_workflow_not_found', error: 'Clock-out workflow not found.' };
  if (!canClockForEmployee(session, workflow.employeeId)) {
    return { ok: false, status: 403, code: 'clock_out_workflow_forbidden', error: 'Forbidden' };
  }
  if (workflow.status === 'finalized') return { ok: true, status: 'clock_out_already_finalized', timeEntry: workflow.timeEntry };

  const workflowState = clockOutWorkflowStatus(workflow);
  if (workflowState.remainingRequiredFormCount > 0) {
    return { ok: false, status: 409, code: 'required_forms_outstanding', workflow: workflowState };
  }

  const activeEntry = await getTimeEntryForBusiness(session.businessId, workflow.timeEntryId);
  if (!activeEntry || activeEntry.employeeId !== workflow.employeeId) {
    return { ok: false, status: 404, code: 'clock_out_workflow_not_found', error: 'Clock-out workflow not found.' };
  }
  const activeShift = await getActiveShiftForEmployee({ businessId: session.businessId, employeeId: workflow.employeeId });
  const activeShiftState = resolveClockOutActiveShift({ activeShift, requestedEntryId: workflow.timeEntryId });
  if (!activeShiftState.ok || activeEntry.status !== 'clocked_in') {
    return { ok: false, status: 409, code: 'offline_shift_state_conflict', error: activeShiftState.error ?? 'No active shift found.' };
  }

  const employee = await getEmployeeForBusiness(session.businessId, workflow.employeeId);
  const finalData = workflow.finalizationData;
  const costSnapshot = labourCostSnapshot(employee, finalData.clockIn, workflow.intendedClockOutAt, finalData.breakMinutes);
  const timeEntry = {
    id: workflow.timeEntryId,
    employeeId: workflow.employeeId,
    jobId: finalData.jobId,
    jobIds: finalData.jobIds,
    workType: finalData.workType,
    workAreaId: finalData.workAreaId,
    workAreaNameSnapshot: finalData.workAreaNameSnapshot,
    clockIn: finalData.clockIn,
    clockOut: workflow.intendedClockOutAt,
    breakMinutes: finalData.breakMinutes,
    notes: finalData.notes,
    photoAttachmentFileIds: finalData.photoAttachmentFileIds,
    clockOutPhotoFileIds: finalData.photoAttachmentFileIds,
    photoAttachmentFileId: finalData.photoAttachmentFileId,
    clockOutPhotoFileId: finalData.photoAttachmentFileId,
    photoAttachmentUrl: finalData.photoAttachmentUrl,
    unbillableCategoryId: finalData.unbillableCategoryId,
    unbillableCategoryName: finalData.unbillableCategoryName,
    status: 'clocked_out',
    ...costSnapshot,
  };
  const tx = buildClockOutTransaction({
    businessId: session.businessId,
    employeeId: workflow.employeeId,
    userId: session.id,
    timeEntryId: workflow.timeEntryId,
    clockOutAt: workflow.intendedClockOutAt,
    serverReceivedAt: workflow.serverReceivedAt,
    timestampSource: workflow.timestampSource,
    requestId: workflow.requestId,
    idempotencyKey: workflow.idempotencyKey,
    payloadHash: workflow.payloadHash,
    source: workflow.source,
    auditEventId: `${session.id}:${workflow.requestId}:clock-out`,
    ...finalData,
    ...costSnapshot,
    employeeName: employee?.name ?? '',
    workflowFinalizationItems: buildWorkflowFinalizationItems({ businessId: session.businessId, workflow, finalizedAt: nowIso(), timeEntry }),
  });

  try {
    await ddb.send(new TransactWriteCommand(tx));
    return { ok: true, status: 'clock_out_completed', timeEntry };
  } catch (error) {
    const current = await getClockOutWorkflowForBusiness(session.businessId, workflowOccurrenceId);
    if (current?.status === 'finalized') return { ok: true, status: 'clock_out_already_finalized', timeEntry: current.timeEntry };
    const failure = getClockingFailureResponse('clock-out', error);
    return { ok: false, status: failure.status, code: 'offline_shift_state_conflict', error: failure.error };
  }
}

export async function finalizeCompletedMandatoryWorkflow({ session, workflowOccurrenceId, trigger }) {
  return trigger === 'before_clock_in'
    ? finalizePendingClockIn({ session, workflowOccurrenceId })
    : finalizePendingClockOut({ session, workflowOccurrenceId });
}
