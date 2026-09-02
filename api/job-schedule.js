import { requireSession } from './_lib/session.js';
import {
  getEmployeeForBusiness,
  getEquipmentAssetForBusiness,
  getJobForBusiness,
  updateJobForBusiness,
} from './_lib/authRepo.js';
import { getCrewForBusiness, getDivisionForBusiness } from './_lib/schedulingConfig.js';
import { syncJobToExternalCalendars } from './_lib/calendarSync.js';

const WRITE_ROLES = ['owner', 'admin', 'foreman'];
const SCHEDULE_FIELDS = new Set([
  'startDate',
  'endDate',
  'scheduledStartAt',
  'scheduledEndAt',
  'scheduleAllDay',
  'scheduleConfirmed',
  'scheduleNotes',
  'crewId',
  'divisionId',
  'assignedEmployeeIds',
  'assignedEquipmentIds',
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isId = (value) => typeof value === 'string' && value.trim().length > 0;
const isDateTime = (value) => typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));

function validateIdList(value, label) {
  if (!Array.isArray(value) || value.some((id) => !isId(id))) return `${label} are invalid.`;
  if (new Set(value).size !== value.length) return `${label} must be unique.`;
  return null;
}

function validateSchedulePatch(existing, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'Schedule changes are invalid.';
  const unsupportedField = Object.keys(patch).find((field) => !SCHEDULE_FIELDS.has(field));
  if (unsupportedField) return `${unsupportedField} cannot be changed through Schedule.`;
  if (existing.sourceEstimateId && hasOwn(patch, 'divisionId')) {
    return 'Converted Job divisionId must be changed through the Job planning workflow.';
  }
  if (hasOwn(patch, 'startDate') && (typeof patch.startDate !== 'string' || !DATE_PATTERN.test(patch.startDate))) return 'Job start date is invalid.';
  if (hasOwn(patch, 'endDate') && patch.endDate !== null && (typeof patch.endDate !== 'string' || !DATE_PATTERN.test(patch.endDate))) return 'Job end date is invalid.';
  if (hasOwn(patch, 'scheduledStartAt') && patch.scheduledStartAt !== null && !isDateTime(patch.scheduledStartAt)) return 'Job scheduled start must be a valid ISO datetime.';
  if (hasOwn(patch, 'scheduledEndAt') && patch.scheduledEndAt !== null && !isDateTime(patch.scheduledEndAt)) return 'Job scheduled end must be a valid ISO datetime.';
  if (hasOwn(patch, 'scheduleAllDay') && typeof patch.scheduleAllDay !== 'boolean') return 'Job schedule all-day flag is invalid.';
  if (hasOwn(patch, 'scheduleConfirmed') && typeof patch.scheduleConfirmed !== 'boolean') return 'Job schedule confirmed flag is invalid.';
  if (hasOwn(patch, 'scheduleNotes') && typeof patch.scheduleNotes !== 'string') return 'Job schedule notes must be a string.';
  if (hasOwn(patch, 'crewId') && patch.crewId !== null && !isId(patch.crewId)) return 'Job crew is invalid.';
  if (hasOwn(patch, 'divisionId') && patch.divisionId !== null && !isId(patch.divisionId)) return 'Job division is invalid.';
  if (hasOwn(patch, 'assignedEmployeeIds')) {
    const error = validateIdList(patch.assignedEmployeeIds, 'Assigned employees');
    if (error) return error;
  }
  if (hasOwn(patch, 'assignedEquipmentIds')) {
    const error = validateIdList(patch.assignedEquipmentIds, 'Assigned equipment');
    if (error) return error;
  }

  const next = { ...existing, ...patch };
  if (next.endDate && next.startDate && next.endDate < next.startDate) return 'Job end date must be on or after the start date.';
  if (next.scheduledStartAt && next.scheduledEndAt && Date.parse(next.scheduledEndAt) < Date.parse(next.scheduledStartAt)) {
    return 'Job scheduled end must be on or after the scheduled start.';
  }
  return null;
}

async function validateRelationships(deps, businessId, existing, patch) {
  if (hasOwn(patch, 'crewId') && patch.crewId) {
    const crew = await deps.getCrewForBusiness(businessId, patch.crewId);
    if (!crew) return 'Assigned crew must belong to this business.';
    if (crew.active === false && patch.crewId !== existing.crewId) return 'Assigned crew must be active.';
  }
  if (hasOwn(patch, 'divisionId') && patch.divisionId && !await deps.getDivisionForBusiness(businessId, patch.divisionId)) {
    return 'Assigned division must belong to this business.';
  }
  if (hasOwn(patch, 'assignedEmployeeIds')) {
    for (const employeeId of patch.assignedEmployeeIds) {
      const employee = await deps.getEmployeeForBusiness(businessId, employeeId);
      if (!employee) return 'Assigned employees must belong to this business.';
      if (employee.active === false && !existing.assignedEmployeeIds?.includes(employeeId)) return 'Assigned employees must be active.';
    }
  }
  if (hasOwn(patch, 'assignedEquipmentIds')) {
    for (const equipmentId of patch.assignedEquipmentIds) {
      if (!await deps.getEquipmentAssetForBusiness(businessId, equipmentId)) return 'Assigned equipment must belong to this business.';
    }
  }
  return null;
}

export function createJobScheduleHandler(overrides = {}) {
  const deps = {
    requireSession,
    getJobForBusiness,
    updateJobForBusiness,
    getCrewForBusiness,
    getDivisionForBusiness,
    getEmployeeForBusiness,
    getEquipmentAssetForBusiness,
    syncJobToExternalCalendars,
    ...overrides,
  };

  return async function jobScheduleHandler(req, res) {
    if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const session = await deps.requireSession(req, res, WRITE_ROLES, 'jobs');
    if (!session) return;
    const jobId = typeof req.query?.jobId === 'string' ? req.query.jobId : '';
    if (!jobId) return res.status(400).json({ ok: false, error: 'Job id is required.' });

    try {
      const existing = await deps.getJobForBusiness(session.businessId, jobId);
      if (!existing) return res.status(404).json({ ok: false, error: 'Job not found.' });
      const patch = req.body;
      const validationError = validateSchedulePatch(existing, patch);
      if (validationError) return res.status(existing.sourceEstimateId && hasOwn(patch ?? {}, 'divisionId') ? 409 : 400).json({ ok: false, error: validationError });
      const relationshipError = await validateRelationships(deps, session.businessId, existing, patch);
      if (relationshipError) return res.status(400).json({ ok: false, error: relationshipError });

      const job = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await deps.updateJobForBusiness({ businessId: session.businessId, job });
      try {
        await deps.syncJobToExternalCalendars({ businessId: session.businessId, job });
      } catch {
        // The Job schedule is authoritative even when an external calendar is temporarily unavailable.
      }
      return res.status(200).json({ ok: true, job });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not update Job schedule.' });
    }
  };
}

export default createJobScheduleHandler();
