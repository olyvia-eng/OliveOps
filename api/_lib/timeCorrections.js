const MAX_EMPLOYEE_CORRECTION_AGE_DAYS = 14;

export const TIME_CORRECTION_REQUEST_TYPES = new Set([
  'forgot_clock_in',
  'forgot_clock_out',
  'wrong_time',
  'wrong_job',
  'wrong_activity',
  'split_activity',
  'other',
]);

export const TIME_CORRECTION_STATUSES = new Set(['pending', 'approved', 'rejected']);

export function toIsoOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isValidCorrectionWindow(targetIso, nowIso, maxAgeDays = MAX_EMPLOYEE_CORRECTION_AGE_DAYS) {
  const targetMs = Date.parse(targetIso);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(targetMs) || Number.isNaN(nowMs)) return false;
  const ageMs = nowMs - targetMs;
  if (ageMs < 0) return false;
  return ageMs <= (maxAgeDays * 24 * 60 * 60 * 1000);
}

export function normalizeTimeCorrectionRequest(input) {
  return {
    requestType: typeof input?.requestType === 'string' ? input.requestType.trim().toLowerCase() : '',
    timeEntryId: typeof input?.timeEntryId === 'string' && input.timeEntryId.trim() ? input.timeEntryId.trim() : undefined,
    employeeId: typeof input?.employeeId === 'string' && input.employeeId.trim() ? input.employeeId.trim() : undefined,
    requestedClockInAt: toIsoOrNull(input?.requestedClockInAt) ?? undefined,
    requestedClockOutAt: toIsoOrNull(input?.requestedClockOutAt) ?? undefined,
    requestedJobId: typeof input?.requestedJobId === 'string' && input.requestedJobId.trim() ? input.requestedJobId.trim() : undefined,
    requestedWorkAreaId: typeof input?.requestedWorkAreaId === 'string' && input.requestedWorkAreaId.trim()
      ? input.requestedWorkAreaId.trim()
      : undefined,
    clockingContractVersion: Number.isInteger(Number(input?.clockingContractVersion))
      ? Number(input.clockingContractVersion)
      : undefined,
    requestedActivityType: typeof input?.requestedActivityType === 'string' ? input.requestedActivityType.trim() : undefined,
    requestedUnbillableCategoryId: typeof input?.requestedUnbillableCategoryId === 'string' && input.requestedUnbillableCategoryId.trim()
      ? input.requestedUnbillableCategoryId.trim()
      : undefined,
    requestedUnbillableCategoryName: typeof input?.requestedUnbillableCategoryName === 'string' && input.requestedUnbillableCategoryName.trim()
      ? input.requestedUnbillableCategoryName.trim()
      : undefined,
    requestedSegments: Array.isArray(input?.requestedSegments)
      ? input.requestedSegments
          .filter((segment) => segment && typeof segment === 'object')
          .map((segment) => ({
            id: typeof segment.id === 'string' && segment.id.trim() ? segment.id.trim() : '',
            startAt: toIsoOrNull(segment.startAt) ?? '',
            endAt: toIsoOrNull(segment.endAt) ?? '',
            requestedJobId: typeof segment.requestedJobId === 'string' && segment.requestedJobId.trim() ? segment.requestedJobId.trim() : undefined,
            requestedActivityType: typeof segment.requestedActivityType === 'string' ? segment.requestedActivityType.trim() : '',
            notes: typeof segment.notes === 'string' ? segment.notes.trim() : undefined,
          }))
      : undefined,
    reason: typeof input?.reason === 'string' ? input.reason.trim() : '',
  };
}

export function validateTimeCorrectionRequestPayload({ request, timeEntry, isOwnerOrAdmin, requesterEmployeeId }) {
  if (!TIME_CORRECTION_REQUEST_TYPES.has(request.requestType)) {
    return 'Correction request type is invalid.';
  }

  if (!request.reason) {
    return 'Correction reason is required.';
  }

  if (request.reason.length > 1000) {
    return 'Correction reason cannot exceed 1000 characters.';
  }

  if (request.requestType !== 'forgot_clock_in' && !request.timeEntryId) {
    return 'A time entry is required for this correction type.';
  }

  if (timeEntry && timeEntry.status !== 'clocked_out') {
    return 'Only historical clocked-out entries can be corrected.';
  }

  if (!isOwnerOrAdmin && request.employeeId && request.employeeId !== requesterEmployeeId) {
    return 'You can only submit correction requests for your own entries.';
  }

  if (request.requestedClockInAt && request.requestedClockOutAt) {
    if (Date.parse(request.requestedClockInAt) >= Date.parse(request.requestedClockOutAt)) {
      return 'Requested clock-out must be after requested clock-in.';
    }
  }

  if (request.requestedActivityType === 'non_billable' && !request.requestedUnbillableCategoryId) {
    return 'Non-billable corrections require an unbillable category.';
  }

  if (request.requestType === 'split_activity') {
    if (!Array.isArray(request.requestedSegments) || request.requestedSegments.length < 2) {
      return 'Split activity corrections must include at least two segments.';
    }

    const sorted = request.requestedSegments
      .slice()
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

    for (let index = 0; index < sorted.length; index += 1) {
      const segment = sorted[index];
      if (!segment.id || !segment.startAt || !segment.endAt || !segment.requestedActivityType) {
        return 'Split activity segments are incomplete.';
      }
      if (Date.parse(segment.startAt) >= Date.parse(segment.endAt)) {
        return 'Split activity segment times are invalid.';
      }
      if (index > 0) {
        const previous = sorted[index - 1];
        if (Date.parse(previous.endAt) > Date.parse(segment.startAt)) {
          return 'Split activity segments cannot overlap.';
        }
      }
    }
  }

  return null;
}

export function buildEffectiveTimeEntries(timeEntries, timeCorrections) {
  if (!Array.isArray(timeEntries) || timeEntries.length === 0) return [];

  const approvedByEntryId = new Map();

  for (const correction of Array.isArray(timeCorrections) ? timeCorrections : []) {
    if (correction?.status !== 'approved' || typeof correction?.timeEntryId !== 'string') continue;

    const existing = approvedByEntryId.get(correction.timeEntryId);
    const existingTime = Date.parse(existing?.reviewedAt ?? existing?.updatedAt ?? existing?.createdAt ?? '') || 0;
    const candidateTime = Date.parse(correction.reviewedAt ?? correction.updatedAt ?? correction.createdAt ?? '') || 0;

    if (!existing || candidateTime >= existingTime) {
      approvedByEntryId.set(correction.timeEntryId, correction);
    }
  }

  return timeEntries.map((entry) => {
    const correction = approvedByEntryId.get(entry.id);
    if (!correction) return entry;

    const nextWorkType = correction.requestedActivityType ?? entry.workType;
    const nextUnbillableCategoryId = nextWorkType === 'non_billable'
      ? (correction.requestedUnbillableCategoryId ?? entry.unbillableCategoryId)
      : undefined;
    const nextUnbillableCategoryName = nextWorkType === 'non_billable'
      ? (correction.requestedUnbillableCategoryName ?? entry.unbillableCategoryName)
      : undefined;

    const nextJobIds = correction.requestedJobId
      ? [correction.requestedJobId]
      : (Array.isArray(entry.jobIds) ? entry.jobIds : (entry.jobId ? [entry.jobId] : []));
    const changesActivityOrJob = Boolean(correction.requestedActivityType || correction.requestedJobId);
    const nextWorkAreaId = nextWorkType === 'job'
      ? (changesActivityOrJob ? correction.requestedWorkAreaId ?? null : entry.workAreaId)
      : undefined;
    const nextWorkAreaNameSnapshot = nextWorkType === 'job'
      ? (changesActivityOrJob ? correction.requestedWorkAreaNameSnapshot ?? null : entry.workAreaNameSnapshot)
      : undefined;

    return {
      ...entry,
      clockIn: correction.requestedClockInAt ?? entry.clockIn,
      clockOut: correction.requestedClockOutAt ?? entry.clockOut,
      jobId: correction.requestedJobId ?? entry.jobId,
      jobIds: nextJobIds,
      workType: nextWorkType,
      workAreaId: nextWorkAreaId,
      workAreaNameSnapshot: nextWorkAreaNameSnapshot,
      unbillableCategoryId: nextUnbillableCategoryId,
      unbillableCategoryName: nextUnbillableCategoryName,
    };
  });
}

export function getCorrectionTargetTimestamp({ request, timeEntry }) {
  if (timeEntry?.clockIn) return timeEntry.clockIn;
  if (request.requestedClockInAt) return request.requestedClockInAt;
  if (request.requestedClockOutAt) return request.requestedClockOutAt;
  return null;
}

export { MAX_EMPLOYEE_CORRECTION_AGE_DAYS };
