export const WORK_AREA_CLOCKING_CONTRACT_VERSION = 2;

const ELIGIBLE_WORK_AREA_STATUSES = new Set(['not_started', 'in_progress']);

const text = (value) => typeof value === 'string' ? value.trim() : '';

export function getEligibleJobWorkAreas(job) {
  if (!Array.isArray(job?.operationalWorkAreas)) return [];
  return job.operationalWorkAreas
    .filter((area) => text(area?.id) && text(area?.name) && ELIGIBLE_WORK_AREA_STATUSES.has(area?.status))
    .map((area) => ({
      id: text(area.id),
      name: text(area.name),
      description: text(area.description),
      status: area.status,
      sortOrder: Number.isFinite(area.sortOrder) ? area.sortOrder : 0,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export function resolveClockingWorkArea({ job, workType, workAreaId, contractVersion }) {
  if (workType !== 'job') return { ok: true, workAreaId: null, workAreaNameSnapshot: null };

  const allAreas = Array.isArray(job?.operationalWorkAreas) ? job.operationalWorkAreas : [];
  const eligibleAreas = getEligibleJobWorkAreas(job);
  const normalizedWorkAreaId = text(workAreaId);
  const usesWorkAreaContract = Number(contractVersion) >= WORK_AREA_CLOCKING_CONTRACT_VERSION;

  if (allAreas.length === 0) {
    return { ok: true, workAreaId: null, workAreaNameSnapshot: null };
  }
  if (eligibleAreas.length === 0) {
    return {
      ok: false,
      status: 409,
      code: 'job_work_area_unavailable',
      error: 'This Job has no Work Areas available for clocking.',
    };
  }
  if (!normalizedWorkAreaId) {
    if (!usesWorkAreaContract) return { ok: true, workAreaId: null, workAreaNameSnapshot: null };
    return {
      ok: false,
      status: 400,
      code: 'job_work_area_required',
      error: 'Select a Work Area before clocking Job Work.',
    };
  }

  const selected = eligibleAreas.find((area) => area.id === normalizedWorkAreaId);
  if (!selected) {
    return {
      ok: false,
      status: 400,
      code: 'job_work_area_invalid',
      error: 'The selected Work Area is not available for this Job.',
    };
  }
  return { ok: true, workAreaId: selected.id, workAreaNameSnapshot: selected.name };
}