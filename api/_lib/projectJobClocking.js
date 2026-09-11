import { isScheduleDateIncluded } from '../../src/utils/scheduleWorkingDays.js';

const INACTIVE_CLOCKING_STATUSES = new Set(['completed', 'cancelled']);

const normalizeRole = (role) => {
  if (role === 'employee' || role === 'worker' || role === 'subcontractor') return 'crew_member';
  return role;
};

const employeeBelongsToCrew = (employeeId, crewId, crews) => Boolean(
  employeeId
    && crewId
    && Array.isArray(crews)
    && crews.some((crew) => crew?.id === crewId
      && crew.active === true
      && (crew.leadEmployeeId === employeeId || crew.memberIds?.includes(employeeId))),
);

export function getProjectJobAssignedEmployeeIds(job) {
  return [...new Set([
    job?.assignedForemanId,
    ...(Array.isArray(job?.assignedCrewEmployeeIds) ? job.assignedCrewEmployeeIds : []),
    ...(Array.isArray(job?.assignedEmployeeIds) ? job.assignedEmployeeIds : []),
  ].filter(Boolean))];
}

export function isEmployeeAssignedToProjectJob(employeeId, job, crews = []) {
  if (!employeeId || !job) return false;
  if (getProjectJobAssignedEmployeeIds(job).includes(employeeId)) return true;
  return employeeBelongsToCrew(employeeId, job.crewId, crews);
}

export function canAccessProjectJobForClocking(session, job, crews = []) {
  if (!session || !job) return false;
  const role = normalizeRole(session.role);
  if (role === 'owner' || role === 'admin' || role === 'foreman') return true;
  if (!session.employeeId) return false;
  return isEmployeeAssignedToProjectJob(session.employeeId, job, crews);
}

export const isProjectJobActiveForClocking = (job) => !INACTIVE_CLOCKING_STATUSES.has(job?.status);

export function isProjectJobClockingEligible(session, job, crews = []) {
  return isProjectJobActiveForClocking(job) && canAccessProjectJobForClocking(session, job, crews);
}

export const isProjectJobScheduledOn = (job, businessDateKey) => isScheduleDateIncluded(job, businessDateKey);

export const isProjectJobScheduledTodayForEmployee = (employeeId, job, crews, businessDateKey) => (
  isProjectJobActiveForClocking(job)
  && isEmployeeAssignedToProjectJob(employeeId, job, crews)
  && isProjectJobScheduledOn(job, businessDateKey)
);