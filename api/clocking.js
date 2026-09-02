import { requireSession } from './_lib/session.js';
import { createHash } from 'node:crypto';
import createTimeCorrectionsHandler from './_lib/timeCorrectionsHandler.js';
import {
  buildClockInTransaction,
  buildClockOutTransaction,
  buildSwitchActivityTransaction,
  getActiveShiftForEmployee,
  validateClockOutPhotoAttachment,
  getClockingErrorResponse,
  getClockingFailureResponse,
  getExistingClockingIdempotency,
  normalizeClientOccurredAt,
  resolveClockingEventTime,
  resolveRequestedClockInTime,
  resolveClockOutActiveShift,
} from './_lib/clocking.js';
import { ddb } from './_lib/db.js';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  getEmployeeForBusiness,
  getBusinessProfile,
  listCustomersForBusiness,
  getFileForBusiness,
  getJobForBusiness,
  getTimeEntryForBusiness,
  getUnbillableTimeCategoryForBusiness,
  listEquipmentAssetsForBusiness,
  listFormFieldsForBusiness,
  listFormsForBusiness,
  listJobsForBusiness,
  listTimeEntriesForBusiness,
  listUnbillableTimeCategoriesForBusiness,
} from './_lib/authRepo.js';
import { authorizeRecordAccess, canClockForEmployee } from './_lib/authorization.js';
import { listCrewsForBusiness, listDivisionsForBusiness } from './_lib/schedulingConfig.js';
import {
  clockOutWorkflowStatus,
  createClockOutOccurrenceId,
  createPendingClockOutWorkflow,
  getPendingClockOutWorkflowForEmployee,
  resolveAfterClockOutForms,
} from './_lib/mandatoryClockOut.js';
import {
  clockInWorkflowStatus,
  createClockInOccurrenceId,
  createPendingClockInWorkflow,
  getPendingClockInWorkflowForEmployee,
  resolveBeforeClockInForms,
} from './_lib/mandatoryClockIn.js';
import { finalizePendingClockIn, finalizePendingClockOut } from './_lib/mandatoryClockingFinalization.js';
import { applyTimeEntryMutation, canDirectlyEditTimeEntries } from './_lib/timeEntryMutations.js';
import { calculateEmployeeLabourCost } from '../src/utils/employeeLabourCost.js';
import {
  resolveClockingWorkArea,
  WORK_AREA_CLOCKING_CONTRACT_VERSION,
} from './_lib/jobWorkAreas.js';

const VALID_WORK_TYPES = new Set(['job', 'drive_time', 'non_billable']);

function nowIso() {
  return new Date().toISOString();
}

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

function payloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function sendMandatoryFinalizationResult(res, result, workflowOccurrenceId) {
  if (result.ok) {
    return res.status(200).json({
      ok: true,
      blocked: false,
      status: result.status,
      workflowOccurrenceId,
      timeEntry: result.timeEntry,
    });
  }
  if (result.code === 'required_forms_outstanding') {
    return res.status(result.status).json({ ok: false, blocked: true, code: result.code, ...result.workflow });
  }
  return res.status(result.status).json({
    ok: false,
    code: result.code,
    error: result.error,
    ...(result.pendingClockOutWorkflow ? {
      blocked: true,
      pendingClockOutWorkflow: result.pendingClockOutWorkflow,
    } : {}),
  });
}

function scopedIdempotencyKey(employeeId, idempotencyKey) {
  return `${employeeId}:${idempotencyKey}`;
}

function replayClockingRequest(res, existing, hashedPayload) {
  if (existing.payloadHash !== hashedPayload) {
    return res.status(409).json({ ok: false, code: 'clock_idempotency_conflict', error: 'Clocking idempotency key was reused with a different request.' });
  }
  return res.status(200).json({ ok: true, timeEntry: existing.response });
}

function pendingClockOutResponse(res, workflow) {
  return res.status(202).json({ ok: true, blocked: true, ...clockOutWorkflowStatus(workflow) });
}

function pendingClockInResponse(res, workflow) {
  return res.status(202).json({ ok: true, blocked: true, ...clockInWorkflowStatus(workflow) });
}

function clockingError(res, result) {
  return res.status(result.status).json({ ok: false, code: result.code, error: result.error });
}

function normalizeRequestedEventTime(res, clientOccurredAt) {
  const normalized = normalizeClientOccurredAt(clientOccurredAt);
  if (!normalized.ok) {
    clockingError(res, normalized);
    return null;
  }
  return normalized.clientOccurredAt;
}

function validateEventAfter(eventOccurredAt, boundaryAt) {
  const eventMs = Date.parse(eventOccurredAt);
  const boundaryMs = Date.parse(boundaryAt);
  if (Number.isNaN(boundaryMs) || eventMs <= boundaryMs) {
    return { status: 409, code: 'offline_event_order_conflict', error: 'Clocking event time conflicts with the employee timeline.' };
  }
  return null;
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

export function canRecordDriveTime(workType, _employee) {
  if (workType !== 'drive_time') return true;
  return true;
}

function ensureClockingEmployee(session, employeeId) {
  if (typeof employeeId !== 'string' || employeeId.trim().length === 0) {
    return { ok: false, status: 400, error: 'Employee is required.' };
  }

  if (!canClockForEmployee(session, employeeId)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true };
}

function getTimeEntryIdFromRequest(body) {
  if (typeof body?.entryId === 'string' && body.entryId.trim()) return body.entryId.trim();
  if (typeof body?.id === 'string' && body.id.trim()) return body.id.trim();
  return null;
}

function getNormalizedJobIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
}

function getSwitchWorkType(body) {
  if (typeof body?.workType !== 'string') {
    return { ok: false, status: 400, error: 'Work type is required.' };
  }

  const workType = body.workType.trim();
  if (!VALID_WORK_TYPES.has(workType)) {
    return { ok: false, status: 400, error: 'Invalid activity type.' };
  }

  return { ok: true, workType };
}

function summarizeTransaction(tx) {
  return (tx?.TransactItems ?? []).map((item, index) => {
    const operationType = item.Put ? 'Put' : item.Delete ? 'Delete' : item.Update ? 'Update' : item.ConditionCheck ? 'ConditionCheck' : 'Unknown';
    return {
      index,
      operationType,
      PK: item.Put?.Item?.PK ?? item.Delete?.Key?.PK ?? item.Update?.Key?.PK ?? item.ConditionCheck?.Key?.PK ?? null,
      SK: item.Put?.Item?.SK ?? item.Delete?.Key?.SK ?? item.Update?.Key?.SK ?? item.ConditionCheck?.Key?.SK ?? null,
      ConditionExpression: item.Put?.ConditionExpression ?? item.Delete?.ConditionExpression ?? item.Update?.ConditionExpression ?? item.ConditionCheck?.ConditionExpression ?? null,
      UpdateExpression: item.Update?.UpdateExpression ?? null,
    };
  });
}

async function resolveActiveUnbillableCategoryOrError({ businessId, categoryId }) {
  const normalized = typeof categoryId === 'string' ? categoryId.trim() : '';
  if (!normalized) {
    return { ok: false, status: 400, error: 'Unbillable category is required.' };
  }

  const category = await getUnbillableTimeCategoryForBusiness(businessId, normalized);
  if (!category || category.active !== true) {
    return { ok: false, status: 400, error: 'Unbillable category is invalid or inactive.' };
  }

  return { ok: true, category };
}

async function validateClockingJobs({ session, jobIds }) {
  if (jobIds.length === 0) return { ok: true, jobs: [] };
  const crews = await listCrewsForBusiness(session.businessId);
  const jobs = [];

  for (const jobId of jobIds) {
    const job = await getJobForBusiness(session.businessId, jobId);
    if (!job) return { ok: false, status: 400, error: 'Job is invalid.' };
    if (!authorizeRecordAccess(session, 'jobs', job, { crews })) {
      return { ok: false, status: 403, code: 'offline_job_unauthorized', error: 'Forbidden' };
    }
    jobs.push(job);
  }

  return { ok: true, jobs };
}

async function validateClockingSelection({ session, workType, jobIds, workAreaId, contractVersion }) {
  const jobValidation = await validateClockingJobs({ session, jobIds });
  if (!jobValidation.ok) return jobValidation;
  if (workType !== 'job') return { ok: true, workAreaId: null, workAreaNameSnapshot: null };
  if (Number(contractVersion) >= WORK_AREA_CLOCKING_CONTRACT_VERSION && jobIds.length !== 1) {
    return { ok: false, status: 400, code: 'job_selection_invalid', error: 'Select one Job for Job Work.' };
  }
  return resolveClockingWorkArea({ job: jobValidation.jobs[0], workType, workAreaId, contractVersion });
}

export default async function handler(req, res) {
  const action = typeof req.query.action === 'string' ? req.query.action : '';
  if (['list', 'create', 'approve', 'reject', 'effective-time-entries', 'notifications'].includes(action)) {
    return createTimeCorrectionsHandler(req, res);
  }

  const session = await requireSession(req, res, ['owner', 'admin', 'crew_member']);
  if (!session) return;

  if (req.method === 'GET' && action === 'active-unbillable-categories') {
    const categories = await listUnbillableTimeCategoriesForBusiness(session.businessId);
    const activeItems = categories.filter((item) => item.active === true);
    return res.status(200).json({ ok: true, items: activeItems });
  }

  if (req.method === 'GET' && action === 'pending-clock-out') {
    const employeeId = typeof req.query.employeeId === 'string' && req.query.employeeId.trim()
      ? req.query.employeeId.trim()
      : session.employeeId;
    const validation = ensureClockingEmployee(session, employeeId);
    if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
    const employee = await getEmployeeForBusiness(session.businessId, employeeId);
    if (!employee?.active) return res.status(404).json({ ok: false, code: 'employee_not_found', error: 'Active employee profile not found.' });
    const workflow = await getPendingClockOutWorkflowForEmployee(session.businessId, employeeId);
    if (!workflow) return res.status(200).json({ ok: true, blocked: false, status: 'no_pending_clock_out', workflow: null });
    return res.status(200).json({ ok: true, blocked: true, ...clockOutWorkflowStatus(workflow) });
  }

  if (req.method === 'GET' && action === 'pending-clock-in') {
    const employeeId = typeof req.query.employeeId === 'string' && req.query.employeeId.trim()
      ? req.query.employeeId.trim()
      : session.employeeId;
    const validation = ensureClockingEmployee(session, employeeId);
    if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
    const employee = await getEmployeeForBusiness(session.businessId, employeeId);
    if (!employee?.active) return res.status(404).json({ ok: false, code: 'employee_not_found', error: 'Active employee profile not found.' });
    const workflow = await getPendingClockInWorkflowForEmployee(session.businessId, employeeId);
    if (!workflow) return res.status(200).json({ ok: true, blocked: false, status: 'no_pending_clock_in', workflow: null });
    return res.status(200).json({ ok: true, blocked: true, ...clockInWorkflowStatus(workflow) });
  }

  if (req.method === 'PATCH' && action === 'edit-time-entry') {
    if (!canDirectlyEditTimeEntries(session)) {
      return res.status(403).json({ ok: false, code: 'time_entry_edit_forbidden', error: 'Forbidden' });
    }
    const timeEntryId = getTimeEntryIdFromRequest(req.body);
    if (!timeEntryId) {
      return res.status(400).json({ ok: false, code: 'time_entry_required', error: 'Time Entry is required.' });
    }
    if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, 'expectedUpdatedAt')) {
      return res.status(400).json({ ok: false, code: 'time_entry_version_required', error: 'Time Entry version is required.' });
    }
    const result = await applyTimeEntryMutation({
      session,
      timeEntryId,
      expectedUpdatedAt: req.body.expectedUpdatedAt ?? null,
      changes: {
        clockIn: req.body.clockIn,
        clockOut: req.body.clockOut,
        workType: req.body.workType,
        jobId: req.body.jobId,
        workAreaId: req.body.workAreaId,
        unbillableCategoryId: req.body.unbillableCategoryId,
        notes: req.body.notes,
      },
      reason: typeof req.body.reason === 'string' ? req.body.reason.trim() : '',
    });
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, code: result.code, error: result.error });
    }
    return res.status(200).json({ ok: true, timeEntry: result.timeEntry, auditEventId: result.auditEventId });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const clockingAction = req.query.action;
  if (clockingAction === 'clock-in-finalize') {
    const workflowOccurrenceId = typeof req.body?.workflowOccurrenceId === 'string' ? req.body.workflowOccurrenceId.trim() : '';
    if (!workflowOccurrenceId) {
      return res.status(400).json({ ok: false, code: 'workflow_occurrence_required', error: 'Clock-in workflow occurrence is required.' });
    }
    const result = await finalizePendingClockIn({ session, workflowOccurrenceId });
    return sendMandatoryFinalizationResult(res, result, workflowOccurrenceId);
  }

  if (clockingAction === 'clock-out-finalize') {
    const workflowOccurrenceId = typeof req.body?.workflowOccurrenceId === 'string' ? req.body.workflowOccurrenceId.trim() : '';
    if (!workflowOccurrenceId) {
      return res.status(400).json({ ok: false, code: 'workflow_occurrence_required', error: 'Clock-out workflow occurrence is required.' });
    }
    const result = await finalizePendingClockOut({ session, workflowOccurrenceId });
    return sendMandatoryFinalizationResult(res, result, workflowOccurrenceId);
  }

  if (clockingAction === 'clock-in') {
    const validation = ensureClockingEmployee(session, req.body?.employeeId);
    if (!validation.ok) {
      return res.status(validation.status).json({ ok: false, error: validation.error });
    }

    const employeeId = req.body.employeeId;
    const serverReceivedAt = nowIso();
    const normalizedClientOccurredAt = normalizeRequestedEventTime(res, req.body?.clientOccurredAt);
    if (req.body?.clientOccurredAt !== undefined && normalizedClientOccurredAt === null) return;
    const employee = await getEmployeeForBusiness(session.businessId, employeeId);
    if (!employee || !employee.active) {
      return res.status(400).json({ ok: false, error: 'Employee is invalid.' });
    }
    if (req.body?.requestedClockInAt !== undefined && req.body?.clientOccurredAt !== undefined) {
      return res.status(400).json({ ok: false, code: 'clock_in_time_invalid', error: 'Requested clock-in time cannot be combined with an offline event time.' });
    }
    const business = req.body?.requestedClockInAt === undefined
      ? null
      : await getBusinessProfile(session.businessId);
    const authenticatedEmployee = req.body?.requestedClockInAt === undefined
      ? null
      : session.employeeId === employeeId
        ? employee
        : session.employeeId
          ? await getEmployeeForBusiness(session.businessId, session.employeeId)
          : null;
    const requestedClockInTime = resolveRequestedClockInTime({
      requestedClockInAt: req.body?.requestedClockInAt,
      serverReceivedAt,
      businessTimeZone: business?.timezone,
      permitted: authenticatedEmployee?.mobileTimePermissions?.adjustClockInTime === true,
    });
    if (!requestedClockInTime.ok) return clockingError(res, requestedClockInTime);

    const requestedWorkType = req.body?.workType ?? 'job';
    if (!VALID_WORK_TYPES.has(requestedWorkType)) {
      return res.status(400).json({ ok: false, error: 'Invalid activity type.' });
    }
    const requestedJobIds = getNormalizedJobIds(req.body?.jobIds);
    const clockingContractVersion = Number(req.body?.clockingContractVersion) || undefined;
    if (requestedWorkType === 'job' && requestedJobIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'At least one job is required for job work.' });
    }
    const workAreaValidation = await validateClockingSelection({
      session,
      workType: requestedWorkType,
      jobIds: requestedJobIds,
      workAreaId: req.body?.workAreaId,
      contractVersion: clockingContractVersion,
    });
    if (!workAreaValidation.ok) {
      return res.status(workAreaValidation.status).json({ ok: false, code: workAreaValidation.code, error: workAreaValidation.error });
    }
    if (!canRecordDriveTime(requestedWorkType, employee)) {
      return res.status(403).json({ ok: false, error: 'Drive time is not enabled for this employee.' });
    }

    let requestedUnbillableCategory;
    if (requestedWorkType === 'non_billable') {
      const categoryResult = await resolveActiveUnbillableCategoryOrError({
        businessId: session.businessId,
        categoryId: req.body?.unbillableCategoryId,
      });
      if (!categoryResult.ok) {
        return res.status(categoryResult.status).json({ ok: false, error: categoryResult.error });
      }
      requestedUnbillableCategory = categoryResult.category;
    }

    const requestId = typeof req.body?.requestId === 'string' && req.body.requestId.trim()
      ? req.body.requestId.trim()
      : `${session.id}:${nowIso()}`;
    const clientIdempotencyKey = typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : `${employeeId}:${requestId}`;
    const payload = {
      action: 'clock-in',
      employeeId,
      workType: requestedWorkType,
      jobIds: requestedJobIds,
      clockingContractVersion,
      workAreaId: workAreaValidation.workAreaId,
      unbillableCategoryId: requestedWorkType === 'non_billable'
        ? requestedUnbillableCategory.id
        : undefined,
      requestId,
      idempotencyKey: clientIdempotencyKey,
      clientOccurredAt: normalizedClientOccurredAt,
      requestedClockInAt: requestedClockInTime.requestedClockInAt,
    };
    const hashedPayload = payloadHash(payload);

    const idempotencyKey = scopedIdempotencyKey(employeeId, clientIdempotencyKey);
    const existing = await getExistingClockingIdempotency({ businessId: session.businessId, idempotencyKey });
    if (existing) {
      return replayClockingRequest(res, existing, hashedPayload);
    }

    const eventTime = requestedClockInTime.clockInTimeSource === 'employee_adjusted'
      ? {
          ok: true,
          eventOccurredAt: requestedClockInTime.effectiveClockInAt,
          serverReceivedAt,
          timestampSource: 'server',
        }
      : resolveClockingEventTime({ clientOccurredAt: normalizedClientOccurredAt, serverReceivedAt });
    if (!eventTime.ok) return clockingError(res, eventTime);

    const activeEntries = await listTimeEntriesForBusiness(session.businessId, { consistentRead: true });
    const activeEntry = activeEntries.find((entry) => entry.employeeId === employeeId && entry.status === 'clocked_in');
    if (activeEntry) {
      const response = getClockingErrorResponse({ statusCode: 409, code: 'ALREADY_CLOCKED_IN' });
      return res.status(response.status).json({ ok: false, code: 'offline_shift_state_conflict', error: response.error });
    }
    if (hasClockInTimelineConflict(activeEntries, employeeId, eventTime.eventOccurredAt)) {
      return clockingError(res, requestedClockInTime.clockInTimeSource === 'employee_adjusted'
        ? { status: 409, code: 'clock_in_time_overlap', error: 'Requested clock-in time overlaps or conflicts with an existing time entry.' }
        : { status: 409, code: 'offline_event_order_conflict', error: 'Clocking event time conflicts with the employee timeline.' });
    }

    const pendingClockOut = await getPendingClockOutWorkflowForEmployee(session.businessId, employeeId);
    if (pendingClockOut) {
      return res.status(409).json({
        ok: false,
        blocked: true,
        code: 'pending_clock_out_requires_finalization',
        error: 'Complete the pending clock-out workflow before clocking in.',
        pendingClockOutWorkflow: clockOutWorkflowStatus(pendingClockOut),
      });
    }
    const pendingClockIn = await getPendingClockInWorkflowForEmployee(session.businessId, employeeId);
    if (pendingClockIn) {
      if (pendingClockIn.idempotencyKey === idempotencyKey && pendingClockIn.payloadHash !== hashedPayload) {
        return res.status(409).json({ ok: false, code: 'clock_idempotency_conflict', error: 'Clocking idempotency key was reused with a different request.' });
      }
      return pendingClockInResponse(res, pendingClockIn);
    }

    const forms = await listFormsForBusiness(session.businessId);
    if (forms.some((form) => form.status === 'active' && form.completionRequirement === 'required' && form.trigger?.includes('before_clock_in'))) {
      if (!employee?.active) {
        return res.status(409).json({ ok: false, code: 'employee_form_context_unavailable', error: 'Active employee form context is unavailable.' });
      }
      const [jobs, equipment, crews, divisions, fields, customers] = await Promise.all([
        listJobsForBusiness(session.businessId),
        listEquipmentAssetsForBusiness(session.businessId),
        listCrewsForBusiness(session.businessId),
        listDivisionsForBusiness(session.businessId),
        listFormFieldsForBusiness(session.businessId),
        listCustomersForBusiness(session.businessId),
      ]);
      const selectedJobs = jobs.filter((job) => requestedJobIds.includes(job.id));
      const applicableForms = resolveBeforeClockInForms({ forms, fields, employee, crews, divisions, jobs: selectedJobs, equipment, customers });
      if (applicableForms.requiredForms.length > 0) {
        const workflowOccurrenceId = createClockInOccurrenceId({
          businessId: session.businessId,
          employeeId,
          idempotencyKey: clientIdempotencyKey,
        });
        const workflow = {
          workflowOccurrenceId,
          employeeId,
          requestId,
          idempotencyKey,
          payloadHash: hashedPayload,
          requiredForms: applicableForms.requiredForms,
          reminderForms: applicableForms.reminderForms,
          clockInIntent: {
            employeeId,
            workType: requestedWorkType,
            jobIds: requestedJobIds,
            clockingContractVersion,
            workAreaId: workAreaValidation.workAreaId,
            workAreaNameSnapshot: workAreaValidation.workAreaNameSnapshot,
            unbillableCategoryId: requestedUnbillableCategory?.id,
            unbillableCategoryName: requestedUnbillableCategory?.name,
            requestedClockInAt: requestedClockInTime.requestedClockInAt,
            effectiveClockInAt: requestedClockInTime.clockInTimeSource === 'employee_adjusted'
              ? eventTime.eventOccurredAt
              : undefined,
            clockInTimeSource: requestedClockInTime.clockInTimeSource,
            serverReceivedAt: eventTime.serverReceivedAt,
          },
          createdAt: eventTime.serverReceivedAt,
        };
        try {
          const created = await createPendingClockInWorkflow({ businessId: session.businessId, workflow });
          return pendingClockInResponse(res, created);
        } catch (error) {
          if (error?.name === 'TransactionCanceledException') {
            const concurrent = await getPendingClockInWorkflowForEmployee(session.businessId, employeeId);
            if (concurrent) return pendingClockInResponse(res, concurrent);
          }
          throw error;
        }
      }
    }

    const clockInAt = eventTime.eventOccurredAt;
    const tx = buildClockInTransaction({
      businessId: session.businessId,
      employeeId,
      userId: session.id,
      timeEntryId: `${employeeId}:${clockInAt}`,
      clockInAt,
      serverReceivedAt: eventTime.serverReceivedAt,
      timestampSource: eventTime.timestampSource,
      clockInTimeSource: requestedClockInTime.clockInTimeSource,
      requestedClockInAt: requestedClockInTime.requestedClockInAt,
      requestId,
      idempotencyKey,
      payloadHash: hashedPayload,
      source: eventTime.timestampSource === 'client' ? 'mobile_offline' : 'web',
      auditEventId: `${session.id}:${requestId}:clock-in`,
      jobIds: requestedJobIds,
      workType: requestedWorkType,
      workAreaId: workAreaValidation.workAreaId,
      workAreaNameSnapshot: workAreaValidation.workAreaNameSnapshot,
      unbillableCategoryId: requestedWorkType === 'non_billable'
        ? requestedUnbillableCategory.id
        : undefined,
      unbillableCategoryName: requestedWorkType === 'non_billable'
        ? requestedUnbillableCategory.name
        : undefined,
      employeeName: employee.name,
    });

    try {
      await ddb.send(new TransactWriteCommand(tx));
      const timeEntry = {
        id: `${employeeId}:${clockInAt}`,
        employeeId,
        jobId: requestedJobIds[0],
        jobIds: requestedJobIds,
        workType: requestedWorkType,
        workAreaId: workAreaValidation.workAreaId,
        workAreaNameSnapshot: workAreaValidation.workAreaNameSnapshot,
        unbillableCategoryId: requestedWorkType === 'non_billable'
          ? requestedUnbillableCategory.id
          : undefined,
        unbillableCategoryName: requestedWorkType === 'non_billable'
          ? requestedUnbillableCategory.name
          : undefined,
        clockIn: clockInAt,
        breakMinutes: 0,
        notes: '',
        status: 'clocked_in',
      };
      return res.status(200).json({ ok: true, timeEntry });
    } catch (error) {
      const committed = await getExistingClockingIdempotency({ businessId: session.businessId, idempotencyKey });
      if (committed) return replayClockingRequest(res, committed, hashedPayload);
      const response = getClockingFailureResponse('clock-in', error);
      console.error('[clocking:clock-in]', {
        action: 'clock-in',
        name: error?.name,
        message: error?.message,
        httpStatusCode: error?.$metadata?.httpStatusCode,
        cancellationReasons: Array.isArray(error?.CancellationReasons)
          ? error.CancellationReasons.map((reason) => ({
              Code: reason?.Code ?? reason?.code,
              Message: typeof reason?.Message === 'string' ? reason.Message : undefined,
            }))
          : undefined,
      });
      return res.status(response.status).json({ ok: false, code: 'offline_shift_state_conflict', error: response.error });
    }
  }

  if (clockingAction === 'clock-out') {
    const entryId = getTimeEntryIdFromRequest(req.body);
    if (!entryId) {
      return res.status(400).json({ ok: false, error: 'Entry id is required.' });
    }

    const requestId = typeof req.body?.requestId === 'string' && req.body.requestId.trim()
      ? req.body.requestId.trim()
      : `${session.id}:${nowIso()}`;
    const clientIdempotencyKey = typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : `${entryId}:${requestId}`;

    const requestedEntry = await getTimeEntryForBusiness(session.businessId, entryId);
    if (!requestedEntry) {
      const response = getClockingErrorResponse({ statusCode: 409, code: 'NO_ACTIVE_SHIFT' });
      return res.status(response.status).json({ ok: false, code: 'offline_shift_state_conflict', error: response.error });
    }

    if (!canClockForEmployee(session, requestedEntry.employeeId)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const serverReceivedAt = nowIso();
    const normalizedClientOccurredAt = normalizeRequestedEventTime(res, req.body?.clientOccurredAt);
    if (req.body?.clientOccurredAt !== undefined && normalizedClientOccurredAt === null) return;
    const payload = {
      action: 'clock-out',
      entryId,
      requestId,
      idempotencyKey: clientIdempotencyKey,
      breakMinutes: req.body?.breakMinutes ?? 0,
      notes: req.body?.notes ?? '',
      photoAttachmentFileIds: Array.isArray(req.body?.photoAttachmentFileIds)
        ? req.body.photoAttachmentFileIds.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
        : undefined,
      photoAttachmentFileId: req.body?.photoAttachmentFileId ?? undefined,
      photoAttachmentUrl: req.body?.photoAttachmentUrl ?? undefined,
      clientOccurredAt: normalizedClientOccurredAt,
    };
    const hashedPayload = payloadHash(payload);

    const idempotencyKey = scopedIdempotencyKey(requestedEntry.employeeId, clientIdempotencyKey);
    const existing = await getExistingClockingIdempotency({ businessId: session.businessId, idempotencyKey });
    if (existing) {
      return replayClockingRequest(res, existing, hashedPayload);
    }

    const eventTime = resolveClockingEventTime({ clientOccurredAt: normalizedClientOccurredAt, serverReceivedAt });
    if (!eventTime.ok) return clockingError(res, eventTime);

    if (requestedEntry.status !== 'clocked_in') {
      const response = getClockingErrorResponse({ statusCode: 409, code: 'NO_ACTIVE_SHIFT' });
      return res.status(response.status).json({ ok: false, code: 'offline_shift_state_conflict', error: response.error });
    }

    const activeEntry = requestedEntry;

    const attachmentValidation = await validateClockOutPhotoAttachment({
      session,
      timeEntryId: entryId,
      photoAttachmentFileIds: req.body?.photoAttachmentFileIds,
      photoAttachmentFileId: req.body?.photoAttachmentFileId ?? undefined,
      getFileForBusiness,
    });
    if (!attachmentValidation.ok) {
      return res.status(attachmentValidation.status).json({ ok: false, error: attachmentValidation.error });
    }

    const activeShift = await getActiveShiftForEmployee({
      businessId: session.businessId,
      employeeId: activeEntry.employeeId,
    });
    const activeShiftState = resolveClockOutActiveShift({
      activeShift,
      requestedEntryId: entryId,
    });

    if (!activeShiftState.ok) {
      if (activeShiftState.reason === 'missing-active-entry-id') {
        console.error('[clocking:clock-out:integrity]', {
          businessId: session.businessId,
          employeeId: activeEntry.employeeId,
          requestedEntryId: entryId,
          activeShiftActiveEntryId: activeShift?.activeEntryId ?? null,
          timeEntryFound: Boolean(activeEntry),
          timeEntryStatus: activeEntry?.status ?? null,
          reason: activeShiftState.reason,
        });
      } else if (activeShiftState.reason === 'entry-mismatch') {
        console.error('[clocking:clock-out:integrity]', {
          businessId: session.businessId,
          employeeId: activeEntry.employeeId,
          requestedEntryId: entryId,
          activeShiftActiveEntryId: activeShift?.activeEntryId ?? null,
          timeEntryFound: Boolean(activeEntry),
          timeEntryStatus: activeEntry?.status ?? null,
          reason: activeShiftState.reason,
        });
      }
      return res.status(activeShiftState.status).json({ ok: false, code: 'offline_shift_state_conflict', error: activeShiftState.error });
    }

    const orderError = validateEventAfter(eventTime.eventOccurredAt, activeEntry.clockIn);
    if (orderError) return clockingError(res, orderError);

    console.info('[clocking:clock-out:pre-transaction]', {
      businessId: session.businessId,
      employeeId: activeEntry.employeeId,
      requestedEntryId: entryId,
      activeShiftActiveEntryId: activeShift?.activeEntryId ?? null,
      timeEntryFound: Boolean(activeEntry),
      timeEntryStatus: activeEntry?.status ?? null,
    });

    const employee = await getEmployeeForBusiness(session.businessId, activeEntry.employeeId);
    const clockOutAt = eventTime.eventOccurredAt;
    const costSnapshot = labourCostSnapshot(employee, activeEntry.clockIn, clockOutAt, req.body?.breakMinutes ?? 0);
    const forms = await listFormsForBusiness(session.businessId);
    if (forms.some((form) => form.status === 'active' && form.completionRequirement === 'required' && form.trigger?.includes('after_clock_out'))) {
      if (!employee?.active) {
        return res.status(409).json({ ok: false, code: 'employee_form_context_unavailable', error: 'Active employee form context is unavailable.' });
      }
      const [jobs, equipment, crews, divisions, fields, customers] = await Promise.all([
        listJobsForBusiness(session.businessId),
        listEquipmentAssetsForBusiness(session.businessId),
        listCrewsForBusiness(session.businessId),
        listDivisionsForBusiness(session.businessId),
        listFormFieldsForBusiness(session.businessId),
        listCustomersForBusiness(session.businessId),
      ]);
      const entryJobIds = Array.isArray(activeEntry.jobIds) && activeEntry.jobIds.length > 0
        ? activeEntry.jobIds
        : activeEntry.jobId ? [activeEntry.jobId] : [];
      const entryJobs = jobs.filter((job) => entryJobIds.includes(job.id));
      const applicableForms = resolveAfterClockOutForms({ forms, fields, employee, crews, divisions, jobs: entryJobs, equipment, customers });
      if (applicableForms.requiredForms.length > 0) {
        const existingWorkflow = await getPendingClockOutWorkflowForEmployee(session.businessId, activeEntry.employeeId);
        if (existingWorkflow) {
          if (existingWorkflow.timeEntryId !== entryId) {
            return res.status(409).json({ ok: false, code: 'pending_clock_out_exists', error: 'Another clock-out workflow is already pending.' });
          }
          if (existingWorkflow.idempotencyKey === idempotencyKey && existingWorkflow.payloadHash !== hashedPayload) {
            return res.status(409).json({ ok: false, code: 'clock_idempotency_conflict', error: 'Clocking idempotency key was reused with a different request.' });
          }
          return pendingClockOutResponse(res, existingWorkflow);
        }

        const workflowOccurrenceId = createClockOutOccurrenceId({
          businessId: session.businessId,
          employeeId: activeEntry.employeeId,
          timeEntryId: entryId,
          idempotencyKey: clientIdempotencyKey,
        });
        const workflow = {
          workflowOccurrenceId,
          employeeId: activeEntry.employeeId,
          timeEntryId: entryId,
          intendedClockOutAt: clockOutAt,
          serverReceivedAt: eventTime.serverReceivedAt,
          timestampSource: eventTime.timestampSource,
          source: eventTime.timestampSource === 'client' ? 'mobile_offline' : 'web',
          requestId,
          idempotencyKey,
          payloadHash: hashedPayload,
          requiredForms: applicableForms.requiredForms,
          reminderForms: applicableForms.reminderForms,
          finalizationData: {
            breakMinutes: req.body?.breakMinutes ?? 0,
            notes: req.body?.notes ?? '',
            photoAttachmentFileIds: attachmentValidation.fileIds?.length ? attachmentValidation.fileIds : undefined,
            photoAttachmentFileId: attachmentValidation.fileId ?? undefined,
            photoAttachmentUrl: req.body?.photoAttachmentUrl ?? undefined,
            unbillableCategoryId: activeEntry.unbillableCategoryId,
            unbillableCategoryName: activeEntry.unbillableCategoryName,
            jobId: activeEntry.jobId,
            jobIds: activeEntry.jobIds,
            workType: activeEntry.workType,
            workAreaId: activeEntry.workAreaId,
            workAreaNameSnapshot: activeEntry.workAreaNameSnapshot,
            clockIn: activeEntry.clockIn,
            ...costSnapshot,
          },
          createdAt: eventTime.serverReceivedAt,
        };
        try {
          const created = await createPendingClockOutWorkflow({ businessId: session.businessId, workflow });
          return pendingClockOutResponse(res, created);
        } catch (error) {
          if (error?.name === 'TransactionCanceledException') {
            const concurrent = await getPendingClockOutWorkflowForEmployee(session.businessId, activeEntry.employeeId);
            if (concurrent?.timeEntryId === entryId) return pendingClockOutResponse(res, concurrent);
          }
          throw error;
        }
      }
    }
    const tx = buildClockOutTransaction({
      businessId: session.businessId,
      employeeId: activeEntry.employeeId,
      userId: session.id,
      timeEntryId: entryId,
      clockOutAt,
      serverReceivedAt: eventTime.serverReceivedAt,
      timestampSource: eventTime.timestampSource,
      requestId,
      idempotencyKey,
      payloadHash: hashedPayload,
      source: eventTime.timestampSource === 'client' ? 'mobile_offline' : 'web',
      auditEventId: `${session.id}:${requestId}:clock-out`,
      breakMinutes: req.body?.breakMinutes ?? 0,
      notes: req.body?.notes ?? '',
      photoAttachmentFileIds: attachmentValidation.fileIds ?? undefined,
      photoAttachmentFileId: attachmentValidation.fileId ?? undefined,
      photoAttachmentUrl: req.body?.photoAttachmentUrl ?? undefined,
      unbillableCategoryId: activeEntry.unbillableCategoryId,
      unbillableCategoryName: activeEntry.unbillableCategoryName,
      jobId: activeEntry.jobId,
      jobIds: activeEntry.jobIds,
      workType: activeEntry.workType,
      workAreaId: activeEntry.workAreaId,
      workAreaNameSnapshot: activeEntry.workAreaNameSnapshot,
      clockIn: activeEntry.clockIn,
      employeeName: employee?.name ?? '',
      ...costSnapshot,
    });

    try {
      await ddb.send(new TransactWriteCommand(tx));
      const timeEntry = {
        id: entryId,
        employeeId: activeEntry.employeeId,
        jobId: activeEntry.jobId,
        jobIds: activeEntry.jobIds,
        workType: activeEntry.workType,
        workAreaId: activeEntry.workAreaId,
        workAreaNameSnapshot: activeEntry.workAreaNameSnapshot,
        clockIn: activeEntry.clockIn,
        clockOut: clockOutAt,
        breakMinutes: req.body?.breakMinutes ?? 0,
        notes: req.body?.notes ?? '',
        photoAttachmentFileIds: attachmentValidation.fileIds?.length ? attachmentValidation.fileIds : undefined,
        clockOutPhotoFileIds: attachmentValidation.fileIds?.length ? attachmentValidation.fileIds : undefined,
        photoAttachmentFileId: attachmentValidation.fileId ?? undefined,
        clockOutPhotoFileId: attachmentValidation.fileId ?? undefined,
        photoAttachmentUrl: req.body?.photoAttachmentUrl ?? undefined,
        unbillableCategoryId: activeEntry.unbillableCategoryId,
        unbillableCategoryName: activeEntry.unbillableCategoryName,
        status: 'clocked_out',
        ...costSnapshot,
      };
      return res.status(200).json({ ok: true, timeEntry });
    } catch (error) {
      const committed = await getExistingClockingIdempotency({ businessId: session.businessId, idempotencyKey });
      if (committed) return replayClockingRequest(res, committed, hashedPayload);
      const response = getClockingFailureResponse('clock-out', error);
      console.error('[clocking:clock-out]', {
        action: 'clock-out',
        name: error?.name,
        message: error?.message,
        code: error?.code,
        Code: error?.Code,
        httpStatusCode: error?.$metadata?.httpStatusCode,
        cancellationReasons: Array.isArray(error?.CancellationReasons)
          ? error.CancellationReasons.map((reason) => ({
              Code: reason?.Code ?? reason?.code,
              Message: typeof reason?.Message === 'string' ? reason.Message : undefined,
            }))
          : undefined,
        legacyCancellationReasons: Array.isArray(error?.cancellationReasons)
          ? error.cancellationReasons.map((reason) => ({
              Code: reason?.Code ?? reason?.code,
              Message: typeof reason?.Message === 'string' ? reason.Message : undefined,
            }))
          : undefined,
        stack: error?.stack,
        transactionSummary: summarizeTransaction(tx),
      });
      return res.status(response.status).json({ ok: false, code: 'offline_shift_state_conflict', error: response.error });
    }
  }

  if (clockingAction === 'switch-activity') {
    const employeeId = typeof session.employeeId === 'string' && session.employeeId.trim()
      ? session.employeeId.trim()
      : null;

    if (!employeeId) {
      return res.status(400).json({ ok: false, error: 'Employee is required.' });
    }

    const employeeValidation = ensureClockingEmployee(session, employeeId);
    if (!employeeValidation.ok) {
      return res.status(employeeValidation.status).json({ ok: false, error: employeeValidation.error });
    }

    const employee = await getEmployeeForBusiness(session.businessId, employeeId);
    if (!employee || !employee.active) {
      return res.status(400).json({ ok: false, error: 'Employee is invalid.' });
    }
    const serverReceivedAt = nowIso();
    const normalizedClientOccurredAt = normalizeRequestedEventTime(res, req.body?.clientOccurredAt);
    if (req.body?.clientOccurredAt !== undefined && normalizedClientOccurredAt === null) return;

    const workTypeResult = getSwitchWorkType(req.body);
    if (!workTypeResult.ok) {
      return res.status(workTypeResult.status).json({ ok: false, error: workTypeResult.error });
    }

    const nextWorkType = workTypeResult.workType;
    const nextJobIds = getNormalizedJobIds(req.body?.jobIds);
    const clockingContractVersion = Number(req.body?.clockingContractVersion) || undefined;
    const requestedUnbillableCategoryId = typeof req.body?.unbillableCategoryId === 'string'
      ? req.body.unbillableCategoryId.trim()
      : '';
    let requestedUnbillableCategory;

    if (nextWorkType === 'job' && nextJobIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'At least one job is required for job work.' });
    }

    if (nextWorkType === 'drive_time' && !canRecordDriveTime(nextWorkType, employee)) {
      return res.status(403).json({ ok: false, error: 'Drive time is not enabled for this employee.' });
    }

    const workAreaValidation = await validateClockingSelection({
      session,
      workType: nextWorkType,
      jobIds: nextJobIds,
      workAreaId: req.body?.workAreaId,
      contractVersion: clockingContractVersion,
    });
    if (!workAreaValidation.ok) {
      return res.status(workAreaValidation.status).json({ ok: false, code: workAreaValidation.code, error: workAreaValidation.error });
    }

    const requestId = typeof req.body?.requestId === 'string' && req.body.requestId.trim()
      ? req.body.requestId.trim()
      : `${session.id}:${nowIso()}`;
    const clientIdempotencyKey = typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : `${employeeId}:${requestId}`;

    const payload = {
      action: 'switch-activity',
      employeeId,
      workType: nextWorkType,
      jobIds: nextJobIds,
      clockingContractVersion,
      workAreaId: workAreaValidation.workAreaId,
      unbillableCategoryId: nextWorkType === 'non_billable' ? requestedUnbillableCategoryId : undefined,
      requestId,
      idempotencyKey: clientIdempotencyKey,
      clientOccurredAt: normalizedClientOccurredAt,
    };
    const hashedPayload = payloadHash(payload);

    const idempotencyKey = scopedIdempotencyKey(employeeId, clientIdempotencyKey);
    const existing = await getExistingClockingIdempotency({ businessId: session.businessId, idempotencyKey });
    if (existing) {
      return replayClockingRequest(res, existing, hashedPayload);
    }

    const eventTime = resolveClockingEventTime({ clientOccurredAt: normalizedClientOccurredAt, serverReceivedAt });
    if (!eventTime.ok) return clockingError(res, eventTime);

    const activeShift = await getActiveShiftForEmployee({
      businessId: session.businessId,
      employeeId,
    });

    if (!activeShift || typeof activeShift.activeEntryId !== 'string' || !activeShift.activeEntryId.trim()) {
      return clockingError(res, { status: 409, code: 'offline_shift_state_conflict', error: 'No active shift found' });
    }

    const allEntries = await listTimeEntriesForBusiness(session.businessId);
    const previousEntry = allEntries.find((entry) => entry.id === activeShift.activeEntryId);
    if (!previousEntry || previousEntry.status !== 'clocked_in' || previousEntry.employeeId !== employeeId) {
      return clockingError(res, { status: 409, code: 'offline_shift_state_conflict', error: 'No active shift found' });
    }
    const orderError = validateEventAfter(eventTime.eventOccurredAt, previousEntry.clockIn);
    if (orderError) return clockingError(res, orderError);

    if (nextWorkType === 'non_billable') {
      const categoryResult = await resolveActiveUnbillableCategoryOrError({
        businessId: session.businessId,
        categoryId: requestedUnbillableCategoryId,
      });
      if (!categoryResult.ok) {
        return res.status(categoryResult.status).json({ ok: false, error: categoryResult.error });
      }
      requestedUnbillableCategory = categoryResult.category;
    }

    console.info('[clocking:switch-activity:pre-transaction]', {
      businessId: session.businessId,
      employeeId,
      previousEntryId: previousEntry.id,
      previousWorkType: previousEntry.workType,
      nextWorkType,
      nextJobIds,
      activeShiftActiveEntryId: activeShift.activeEntryId,
    });

    const switchedAt = eventTime.eventOccurredAt;
    const nextTimeEntryId = `${employeeId}:${switchedAt}`;
    const tx = buildSwitchActivityTransaction({
      businessId: session.businessId,
      employeeId,
      userId: session.id,
      previousTimeEntry: previousEntry,
      nextTimeEntry: {
        id: nextTimeEntryId,
        workType: nextWorkType,
        jobIds: nextWorkType === 'non_billable' ? [] : nextJobIds,
        workAreaId: workAreaValidation.workAreaId,
        workAreaNameSnapshot: workAreaValidation.workAreaNameSnapshot,
        unbillableCategoryId: nextWorkType === 'non_billable' ? requestedUnbillableCategory.id : undefined,
        unbillableCategoryName: nextWorkType === 'non_billable' ? requestedUnbillableCategory.name : undefined,
      },
      switchedAt,
      serverReceivedAt: eventTime.serverReceivedAt,
      timestampSource: eventTime.timestampSource,
      requestId,
      idempotencyKey,
      payloadHash: hashedPayload,
      source: eventTime.timestampSource === 'client' ? 'mobile_offline' : 'mobile',
      auditEventId: `${session.id}:${requestId}:switch-activity`,
      employeeName: employee.name,
    });

    try {
      await ddb.send(new TransactWriteCommand(tx));
      const timeEntry = {
        id: nextTimeEntryId,
        employeeId,
        jobId: nextWorkType === 'non_billable' ? undefined : (nextJobIds[0] ?? undefined),
        jobIds: nextWorkType === 'non_billable' ? [] : nextJobIds,
        workType: nextWorkType,
        workAreaId: workAreaValidation.workAreaId,
        workAreaNameSnapshot: workAreaValidation.workAreaNameSnapshot,
        unbillableCategoryId: nextWorkType === 'non_billable' ? requestedUnbillableCategory.id : undefined,
        unbillableCategoryName: nextWorkType === 'non_billable' ? requestedUnbillableCategory.name : undefined,
        clockIn: switchedAt,
        breakMinutes: 0,
        notes: '',
        status: 'clocked_in',
      };
      return res.status(200).json({ ok: true, timeEntry });
    } catch (error) {
      const committed = await getExistingClockingIdempotency({ businessId: session.businessId, idempotencyKey });
      if (committed) return replayClockingRequest(res, committed, hashedPayload);
      const response = getClockingFailureResponse('switch-activity', error);
      console.error('[clocking:switch-activity]', {
        action: 'switch-activity',
        name: error?.name,
        message: error?.message,
        code: error?.code,
        Code: error?.Code,
        httpStatusCode: error?.$metadata?.httpStatusCode,
        cancellationReasons: Array.isArray(error?.CancellationReasons)
          ? error.CancellationReasons.map((reason) => ({
              Code: reason?.Code ?? reason?.code,
              Message: typeof reason?.Message === 'string' ? reason.Message : undefined,
            }))
          : undefined,
        stack: error?.stack,
        transactionSummary: summarizeTransaction(tx),
      });
      return res.status(response.status).json({ ok: false, code: 'offline_shift_state_conflict', error: response.error });
    }
  }

  return res.status(400).json({ ok: false, error: 'Invalid clocking action' });
}
