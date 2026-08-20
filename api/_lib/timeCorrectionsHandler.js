import { requireSession } from './session.js';
import {
  approveTimeCorrectionForBusiness,
  createTimeCorrectionForBusiness,
  generateId,
  getEmployeeForBusiness,
  getJobForBusiness,
  getUnbillableTimeCategoryForBusiness,
  getTimeCorrectionForBusiness,
  getTimeEntryForBusiness,
  listTimeCorrectionsForBusiness,
  listTimeEntriesForBusiness,
  rejectTimeCorrectionForBusiness,
} from './authRepo.js';
import {
  buildEffectiveTimeEntries,
  getCorrectionTargetTimestamp,
  isValidCorrectionWindow,
  MAX_EMPLOYEE_CORRECTION_AGE_DAYS,
  normalizeTimeCorrectionRequest,
  validateTimeCorrectionRequestPayload,
} from './timeCorrections.js';
import { authorizeRecordAccess } from './authorization.js';
import { listCrewsForBusiness } from './schedulingConfig.js';

function nowIso() {
  return new Date().toISOString();
}

function formatLocalTimestamp(isoValue, options) {
  if (typeof isoValue !== 'string' || !isoValue.trim()) return null;
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', options).format(parsed);
}

function formatDateLabel(isoValue) {
  return formatLocalTimestamp(isoValue, { month: 'short', day: 'numeric' });
}

function formatTimeLabel(isoValue) {
  return formatLocalTimestamp(isoValue, { hour: 'numeric', minute: '2-digit' });
}

function buildNotificationSummary(correction) {
  if (correction.requestType === 'forgot_clock_in') {
    const dateLabel = formatDateLabel(correction.requestedClockInAt ?? correction.submittedAt);
    return dateLabel
      ? `Reported missing time for ${dateLabel}.`
      : 'Reported missing time that requires review.';
  }

  if (correction.requestType === 'forgot_clock_out' || correction.requestType === 'wrong_time') {
    const fromLabel = formatTimeLabel(correction.originalClockOutAt);
    const toLabel = formatTimeLabel(correction.requestedClockOutAt);
    if (fromLabel && toLabel) {
      return `Requested clock-out change from ${fromLabel} to ${toLabel}.`;
    }
    if (toLabel) {
      return `Requested an updated clock-out time to ${toLabel}.`;
    }
    return 'Requested a time correction for this shift.';
  }

  if (correction.requestType === 'wrong_job') {
    return 'Requested a job assignment correction.';
  }

  if (correction.requestType === 'wrong_activity') {
    return 'Requested an activity type correction.';
  }

  if (correction.requestType === 'split_activity') {
    return 'Requested a shift activity split review.';
  }

  return 'Requested a time correction that requires review.';
}

function normalizeRole(role) {
  if (role === 'employee') return 'crew_member';
  return role;
}

function isOwnerOrAdmin(session) {
  const role = normalizeRole(session?.role);
  return role === 'owner' || role === 'admin';
}

function canReviewCorrections(session) {
  return isOwnerOrAdmin(session);
}

function filterCorrectionsForSession(session, corrections) {
  if (!Array.isArray(corrections)) return [];
  if (isOwnerOrAdmin(session)) return corrections;
  if (!session?.employeeId) return [];
  return corrections.filter((correction) => correction.employeeId === session.employeeId);
}

function buildHistoricalTimeEntryFromRequest({ request, employeeId, reviewedAt }) {
  const clockIn = request.requestedClockInAt;
  const clockOut = request.requestedClockOutAt;
  const requestedWorkType = request.requestedActivityType ?? 'job';
  const requestedJobId = request.requestedJobId;

  return {
    id: generateId(),
    employeeId,
    jobId: requestedWorkType === 'job' ? requestedJobId : undefined,
    jobIds: requestedWorkType === 'job' && requestedJobId ? [requestedJobId] : [],
    workType: requestedWorkType,
    unbillableCategoryId: requestedWorkType === 'non_billable' ? request.requestedUnbillableCategoryId : undefined,
    unbillableCategoryName: requestedWorkType === 'non_billable' ? request.requestedUnbillableCategoryName : undefined,
    clockIn,
    clockOut,
    breakMinutes: 0,
    notes: `Created from approved time correction request ${request.id}`,
    status: 'clocked_out',
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
  };
}

function ensureSameBusinessJobOrError(job, requestedJobId) {
  if (!requestedJobId) return null;
  if (!job) return 'Requested job does not exist.';
  return null;
}

async function validateActivityAndJobRules({
  session,
  request,
  employee,
  jobId,
  getJobForBusinessFn,
  getUnbillableTimeCategoryForBusinessFn,
  listCrewsForBusinessFn,
}) {
  if (!jobId && request.requestedActivityType === 'job') {
    return { error: 'Job work corrections must include a requested job.' };
  }

  if (jobId) {
    const job = await getJobForBusinessFn(session.businessId, jobId);
    const error = ensureSameBusinessJobOrError(job, jobId);
    if (error) return { error };
    const crews = await listCrewsForBusinessFn(session.businessId);
    if (!authorizeRecordAccess(session, 'jobs', job, { crews })) {
      return { error: 'Requested job is not available to this employee.', status: 403 };
    }
  }

  if (request.requestedActivityType === 'non_billable') {
    if (!request.requestedUnbillableCategoryId) {
      return { error: 'Non-billable corrections require an unbillable category.' };
    }

    const category = await getUnbillableTimeCategoryForBusinessFn(session.businessId, request.requestedUnbillableCategoryId);
    if (!category || category.active !== true) {
      return { error: 'Unbillable category is invalid or inactive.' };
    }

    return { error: null, requestedUnbillableCategoryName: category.name };
  }

  return { error: null };
}

export function createTimeCorrectionsHandler(overrides = {}) {
  const deps = {
    requireSession,
    createTimeCorrectionForBusiness,
    listTimeCorrectionsForBusiness,
    getTimeCorrectionForBusiness,
    getTimeEntryForBusiness,
    getJobForBusiness,
    getUnbillableTimeCategoryForBusiness,
    getEmployeeForBusiness,
    approveTimeCorrectionForBusiness,
    rejectTimeCorrectionForBusiness,
    listTimeEntriesForBusiness,
    listCrewsForBusiness,
    ...overrides,
  };

  return async function handler(req, res) {
    const session = await deps.requireSession(req, res, ['owner', 'admin', 'foreman', 'crew_member']);
    if (!session) return;

    const action = typeof req.query.action === 'string' ? req.query.action : '';

    if (req.method === 'GET' && action === 'notifications') {
      if (!canReviewCorrections(session)) {
        return res.status(200).json({ ok: true, count: 0, items: [] });
      }

      const all = await deps.listTimeCorrectionsForBusiness(session.businessId);
      const pending = all
        .filter((item) => item.status === 'pending')
        .slice()
        .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));

      const items = await Promise.all(
        pending.map(async (correction) => {
          const employee = await deps.getEmployeeForBusiness(session.businessId, correction.employeeId);
          const employeeName = employee?.name?.trim() || 'An employee';

          return {
            id: correction.id,
            type: 'time_correction_pending_review',
            title: 'Time correction requested',
            employeeName,
            summary: buildNotificationSummary(correction),
            submittedAt: correction.submittedAt,
            href: `/reports/time?correctionStatus=pending&correctionId=${encodeURIComponent(correction.id)}`,
            actionable: true,
          };
        })
      );

      return res.status(200).json({ ok: true, count: items.length, items });
    }

    if (req.method === 'GET' && action === 'list') {
      const all = await deps.listTimeCorrectionsForBusiness(session.businessId);
      const mine = req.query.mine === 'true';
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';

      let filtered = mine ? filterCorrectionsForSession(session, all) : filterCorrectionsForSession(session, all);
      if (statusFilter) filtered = filtered.filter((item) => item.status === statusFilter);

      return res.status(200).json({ ok: true, items: filtered });
    }

    if (req.method === 'POST' && action === 'create') {
      const normalized = normalizeTimeCorrectionRequest(req.body ?? {});
      const submittedAt = nowIso();
      const ownerAdmin = isOwnerOrAdmin(session);

      const timeEntry = normalized.timeEntryId
        ? await deps.getTimeEntryForBusiness(session.businessId, normalized.timeEntryId)
        : null;
      if (normalized.timeEntryId && !timeEntry) {
        return res.status(404).json({ ok: false, error: 'Time entry not found.' });
      }

      const requesterEmployeeId = typeof session.employeeId === 'string' ? session.employeeId : undefined;
      const targetEmployeeId = normalized.employeeId ?? timeEntry?.employeeId ?? requesterEmployeeId;
      if (!targetEmployeeId) {
        return res.status(400).json({ ok: false, error: 'Employee is required for this correction request.' });
      }

      if (!ownerAdmin && targetEmployeeId !== requesterEmployeeId) {
        return res.status(403).json({ ok: false, error: 'You can only submit correction requests for your own entries.' });
      }

      if (timeEntry && targetEmployeeId !== timeEntry.employeeId) {
        return res.status(400).json({ ok: false, error: 'Correction employee does not match time entry employee.' });
      }

      const validationError = validateTimeCorrectionRequestPayload({
        request: normalized,
        timeEntry,
        isOwnerOrAdmin: ownerAdmin,
        requesterEmployeeId,
      });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }

      const targetTimestamp = getCorrectionTargetTimestamp({ request: normalized, timeEntry });
      if (!targetTimestamp) {
        return res.status(400).json({ ok: false, error: 'Could not determine correction target timestamp.' });
      }

      if (!ownerAdmin && !isValidCorrectionWindow(targetTimestamp, submittedAt, MAX_EMPLOYEE_CORRECTION_AGE_DAYS)) {
        return res.status(400).json({ ok: false, error: `Correction requests must be submitted within ${MAX_EMPLOYEE_CORRECTION_AGE_DAYS} days.` });
      }

      if (timeEntry && normalized.requestedActivityType === 'job' && !normalized.requestedJobId) {
        return res.status(400).json({ ok: false, error: 'Job work corrections require a job.' });
      }

      const targetEmployee = await deps.getEmployeeForBusiness(session.businessId, targetEmployeeId);
      if (!targetEmployee) {
        return res.status(400).json({ ok: false, error: 'Target employee is invalid.' });
      }

      const activityValidation = await validateActivityAndJobRules({
        session,
        request: normalized,
        employee: targetEmployee,
        jobId: normalized.requestedJobId,
        getJobForBusinessFn: deps.getJobForBusiness,
        getUnbillableTimeCategoryForBusinessFn: deps.getUnbillableTimeCategoryForBusiness,
        listCrewsForBusinessFn: deps.listCrewsForBusiness,
      });
      if (activityValidation.error) {
        return res.status(activityValidation.status ?? 400).json({ ok: false, error: activityValidation.error });
      }

      const correction = {
        id: generateId(),
        employeeId: targetEmployeeId,
        timeEntryId: normalized.timeEntryId,
        requestType: normalized.requestType,
        status: 'pending',
        requestedClockInAt: normalized.requestedClockInAt,
        requestedClockOutAt: normalized.requestedClockOutAt,
        requestedJobId: normalized.requestedJobId,
        requestedActivityType: normalized.requestedActivityType,
        requestedUnbillableCategoryId: normalized.requestedActivityType === 'non_billable'
          ? normalized.requestedUnbillableCategoryId
          : undefined,
        requestedUnbillableCategoryName: normalized.requestedActivityType === 'non_billable'
          ? activityValidation.requestedUnbillableCategoryName
          : undefined,
        requestedSegments: normalized.requestedSegments,
        reason: normalized.reason,
        submittedByUserId: session.id,
        submittedAt,
        createdAt: submittedAt,
        updatedAt: submittedAt,
        originalClockInAt: timeEntry?.clockIn,
        originalClockOutAt: timeEntry?.clockOut,
        originalJobId: timeEntry?.jobId,
        originalJobIds: Array.isArray(timeEntry?.jobIds) ? timeEntry.jobIds : undefined,
        originalActivityType: timeEntry?.workType,
        originalUnbillableCategoryId: timeEntry?.unbillableCategoryId,
        originalUnbillableCategoryName: timeEntry?.unbillableCategoryName,
      };

      await deps.createTimeCorrectionForBusiness({ businessId: session.businessId, correction });
      return res.status(200).json({ ok: true, correction });
    }

    if (req.method === 'POST' && action === 'approve') {
      if (!canReviewCorrections(session)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }

      const correctionId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
      const reviewNote = typeof req.body?.reviewNote === 'string' ? req.body.reviewNote.trim() : '';
      if (!correctionId) {
        return res.status(400).json({ ok: false, error: 'Correction id is required.' });
      }

      const correction = await deps.getTimeCorrectionForBusiness(session.businessId, correctionId);
      if (!correction) {
        return res.status(404).json({ ok: false, error: 'Correction request not found.' });
      }

      if (correction.status === 'approved') {
        return res.status(200).json({ ok: true, correction, idempotent: true });
      }

      if (correction.status !== 'pending') {
        return res.status(409).json({ ok: false, error: 'Only pending correction requests can be approved.' });
      }

      if (correction.requestType === 'split_activity') {
        return res.status(409).json({ ok: false, error: 'Split activity approvals are not enabled in this release.' });
      }

      const targetEmployee = await deps.getEmployeeForBusiness(session.businessId, correction.employeeId);
      if (!targetEmployee) {
        return res.status(400).json({ ok: false, error: 'Target employee is invalid.' });
      }

      const existingEntry = correction.timeEntryId
        ? await deps.getTimeEntryForBusiness(session.businessId, correction.timeEntryId)
        : null;

      if (correction.timeEntryId && !existingEntry) {
        return res.status(409).json({ ok: false, error: 'Target time entry no longer exists.' });
      }

      const activityValidation = await validateActivityAndJobRules({
        session,
        request: correction,
        employee: targetEmployee,
        jobId: correction.requestedJobId,
        getJobForBusinessFn: deps.getJobForBusiness,
        getUnbillableTimeCategoryForBusinessFn: deps.getUnbillableTimeCategoryForBusiness,
        listCrewsForBusinessFn: deps.listCrewsForBusiness,
      });
      if (activityValidation.error) {
        return res.status(409).json({ ok: false, error: activityValidation.error });
      }

      const allCorrections = await deps.listTimeCorrectionsForBusiness(session.businessId);
      if (correction.timeEntryId) {
        const conflictingApproved = allCorrections.find((item) => (
          item.id !== correction.id
          && item.timeEntryId === correction.timeEntryId
          && item.status === 'approved'
        ));
        if (conflictingApproved) {
          return res.status(409).json({ ok: false, error: 'Another approved correction already exists for this time entry.' });
        }
      }

      const reviewedAt = nowIso();
      let createdTimeEntry;
      if (!correction.timeEntryId && correction.requestType === 'forgot_clock_in') {
        if (!correction.requestedClockInAt || !correction.requestedClockOutAt) {
          return res.status(409).json({ ok: false, error: 'Forgot clock-in approvals require requested start and end times.' });
        }
        createdTimeEntry = buildHistoricalTimeEntryFromRequest({
          request: correction,
          employeeId: correction.employeeId,
          reviewedAt,
        });
      }

      const result = await deps.approveTimeCorrectionForBusiness({
        businessId: session.businessId,
        correction,
        reviewerUserId: session.id,
        reviewerName: session.name,
        reviewerEmail: session.email,
        reviewNote,
        reviewedAt,
        createdTimeEntry,
      });

      if (!result.ok) {
        const latest = await deps.getTimeCorrectionForBusiness(session.businessId, correction.id);
        if (latest?.status === 'approved') {
          return res.status(200).json({ ok: true, correction: latest, idempotent: true });
        }
        return res.status(409).json({ ok: false, error: 'Correction approval conflicted. Reload and retry.' });
      }

      const approved = await deps.getTimeCorrectionForBusiness(session.businessId, correction.id);
      return res.status(200).json({ ok: true, correction: approved, createdTimeEntry });
    }

    if (req.method === 'POST' && action === 'reject') {
      if (!canReviewCorrections(session)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }

      const correctionId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
      const reviewNote = typeof req.body?.reviewNote === 'string' ? req.body.reviewNote.trim() : '';
      if (!correctionId) {
        return res.status(400).json({ ok: false, error: 'Correction id is required.' });
      }

      const correction = await deps.getTimeCorrectionForBusiness(session.businessId, correctionId);
      if (!correction) {
        return res.status(404).json({ ok: false, error: 'Correction request not found.' });
      }

      if (correction.status === 'rejected') {
        return res.status(200).json({ ok: true, correction, idempotent: true });
      }

      if (correction.status !== 'pending') {
        return res.status(409).json({ ok: false, error: 'Only pending correction requests can be rejected.' });
      }

      const reviewedAt = nowIso();
      const result = await deps.rejectTimeCorrectionForBusiness({
        businessId: session.businessId,
        correction,
        reviewerUserId: session.id,
        reviewerName: session.name,
        reviewerEmail: session.email,
        reviewNote,
        reviewedAt,
      });

      if (!result.ok) {
        return res.status(409).json({ ok: false, error: 'Correction rejection conflicted. Reload and retry.' });
      }

      const rejected = await deps.getTimeCorrectionForBusiness(session.businessId, correction.id);
      return res.status(200).json({ ok: true, correction: rejected });
    }

    if (req.method === 'GET' && action === 'effective-time-entries') {
      const entries = await deps.listTimeEntriesForBusiness(session.businessId);
      const corrections = await deps.listTimeCorrectionsForBusiness(session.businessId);
      const scopedCorrections = filterCorrectionsForSession(session, corrections);
      const scopedEntries = isOwnerOrAdmin(session)
        ? entries
        : entries.filter((entry) => entry.employeeId === session.employeeId);
      const effectiveEntries = buildEffectiveTimeEntries(scopedEntries, scopedCorrections);
      return res.status(200).json({ ok: true, items: effectiveEntries });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  };
}

export default createTimeCorrectionsHandler();