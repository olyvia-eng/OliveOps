import type { TimeCorrectionRequest, TimeEntry } from '../types';

function correctionSortTimestamp(correction: TimeCorrectionRequest) {
  const reviewedAt = Date.parse(correction.reviewedAt ?? '');
  if (!Number.isNaN(reviewedAt)) return reviewedAt;
  const updatedAt = Date.parse(correction.updatedAt ?? '');
  if (!Number.isNaN(updatedAt)) return updatedAt;
  const createdAt = Date.parse(correction.createdAt ?? '');
  if (!Number.isNaN(createdAt)) return createdAt;
  return 0;
}

export function buildEffectiveTimeEntries(
  timeEntries: TimeEntry[],
  timeCorrections: TimeCorrectionRequest[]
): TimeEntry[] {
  const approvedByEntryId = new Map<string, TimeCorrectionRequest>();

  for (const correction of timeCorrections) {
    if (correction.status !== 'approved' || !correction.timeEntryId) continue;

    const existing = approvedByEntryId.get(correction.timeEntryId);
    if (!existing || correctionSortTimestamp(correction) >= correctionSortTimestamp(existing)) {
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

    const requestedJobIds = correction.requestedJobId ? [correction.requestedJobId] : undefined;
    const changesActivityOrJob = Boolean(correction.requestedActivityType || correction.requestedJobId);
    const nextWorkAreaId = nextWorkType === 'job'
      ? (changesActivityOrJob ? correction.requestedWorkAreaId : entry.workAreaId)
      : undefined;
    const nextWorkAreaNameSnapshot = nextWorkType === 'job'
      ? (changesActivityOrJob ? correction.requestedWorkAreaNameSnapshot : entry.workAreaNameSnapshot)
      : undefined;

    return {
      ...entry,
      clockIn: correction.requestedClockInAt ?? entry.clockIn,
      clockOut: correction.requestedClockOutAt ?? entry.clockOut,
      jobId: correction.requestedJobId ?? entry.jobId,
      jobIds: requestedJobIds ?? entry.jobIds,
      workType: nextWorkType,
      workAreaId: nextWorkAreaId,
      workAreaNameSnapshot: nextWorkAreaNameSnapshot,
      unbillableCategoryId: nextUnbillableCategoryId,
      unbillableCategoryName: nextUnbillableCategoryName,
    };
  });
}
