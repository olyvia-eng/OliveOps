function normalizeJobIds(entry) {
  if (Array.isArray(entry?.jobIds) && entry.jobIds.length > 0) {
    return entry.jobIds.filter((value) => typeof value === 'string' && value.trim());
  }
  return typeof entry?.jobId === 'string' && entry.jobId.trim() ? [entry.jobId] : [];
}

function timestamp(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortTimeEntriesNewestFirst(entries) {
  return [...entries].sort((left, right) => {
    const activeOrder = Number(right?.status === 'clocked_in') - Number(left?.status === 'clocked_in');
    if (activeOrder !== 0) return activeOrder;

    const clockInOrder = timestamp(right?.clockIn) - timestamp(left?.clockIn);
    if (clockInOrder !== 0) return clockInOrder;

    const createdOrder = timestamp(right?.createdAt) - timestamp(left?.createdAt);
    if (createdOrder !== 0) return createdOrder;

    return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
  });
}

export function getTimeEntryWorkAreaLabel(entry) {
  if (entry?.workType !== 'job') return null;
  const snapshot = typeof entry.workAreaNameSnapshot === 'string' ? entry.workAreaNameSnapshot.trim() : '';
  return snapshot || null;
}

export function getTimeEntryJobLabel(entry, jobs) {
  const titles = normalizeJobIds(entry)
    .map((jobId) => jobs.find((job) => job.id === jobId)?.title)
    .filter(Boolean);
  return titles.length > 0 ? titles.join(', ') : 'Job Work';
}

export function getTimeEntryWorkLabel(entry, jobs) {
  if (entry?.workType === 'drive_time') return 'Drive Time';
  if (entry?.workType === 'non_billable') return 'Non-Billable Work';

  const jobLabel = getTimeEntryJobLabel(entry, jobs);
  const workAreaLabel = getTimeEntryWorkAreaLabel(entry);
  return workAreaLabel ? `${jobLabel} · ${workAreaLabel}` : jobLabel;
}

export function getTimeEntryActivityLabel(entry) {
  if (entry?.workType === 'drive_time') return 'Drive Time';
  if (entry?.workType === 'non_billable') {
    const category = typeof entry.unbillableCategoryName === 'string' ? entry.unbillableCategoryName.trim() : '';
    return category ? `Non-Billable · ${category}` : 'Non-Billable';
  }
  return 'Job Work';
}

export function getTimeEntryPresentation(entry, jobs) {
  const jobLabel = entry?.workType === 'job' ? getTimeEntryJobLabel(entry, jobs) : null;
  const workAreaLabel = getTimeEntryWorkAreaLabel(entry);
  return {
    activityLabel: getTimeEntryActivityLabel(entry),
    jobLabel,
    workAreaId: entry?.workAreaId ?? null,
    workAreaLabel,
    workLabel: getTimeEntryWorkLabel(entry, jobs),
  };
}

export function formatTimeEntryDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return '0m';
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours === 0) return `${minutes}m`;
  if (minutes === 0) return `${wholeHours}h`;
  return `${wholeHours}h ${minutes}m`;
}