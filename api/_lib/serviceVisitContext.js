import { authorizeRecordAccess } from './authorization.js';
import { getJobForBusiness } from './authRepo.js';
import { listCrewsForBusiness } from './schedulingConfig.js';
import { getServiceVisitForBusiness } from './serviceVisitRepo.js';
import { resolveWorkType } from '../../src/utils/workTypeModel.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';

export function isEmployeeAssignedToServiceVisit(session, visit, crews) {
  if (session.role === 'owner' || session.role === 'admin' || session.role === 'foreman') return true;
  const employeeId = text(session.employeeId);
  if (!employeeId) return false;
  if (visit.assignedEmployeeIds?.includes(employeeId)) return true;
  const crew = crews.find((candidate) => candidate.id === visit.crewId && candidate.active !== false);
  return Boolean(crew && (crew.leadEmployeeId === employeeId || crew.memberIds?.includes(employeeId)));
}

export async function resolveServiceVisitContext({ session, workType, jobIds, workAreaId, serviceId, serviceVisitId }) {
  const requestedServiceId = text(serviceId);
  const requestedVisitId = text(serviceVisitId);
  if (workType !== 'job') {
    if (requestedServiceId || requestedVisitId) return { ok: false, status: 400, code: 'SERVICE_CONTEXT_INVALID', error: 'Service context is only valid for Job Work.' };
    return { ok: true, serviceId: undefined, serviceVisitId: undefined };
  }
  if (jobIds.length !== 1) return { ok: true };
  const job = await getJobForBusiness(session.businessId, jobIds[0]);
  if (!job) return { ok: false, status: 400, code: 'JOB_NOT_FOUND', error: 'Job is invalid.' };
  const crews = await listCrewsForBusiness(session.businessId);
  if (!authorizeRecordAccess(session, 'jobs', job, { crews })) return { ok: false, status: 403, code: 'VISIT_NOT_ASSIGNED', error: 'This work is not assigned to the employee.' };

  if (resolveWorkType(job) === 'project') {
    if (requestedServiceId || requestedVisitId) return { ok: false, status: 400, code: 'SERVICE_JOB_MISMATCH', error: 'Service Visit context cannot be used with a Project Job.' };
    return { ok: true, job, serviceId: undefined, serviceVisitId: undefined };
  }
  if (text(workAreaId)) return { ok: false, status: 400, code: 'SERVICE_JOB_MISMATCH', error: 'Service Job Work cannot use a Project Work Area.' };
  if (!requestedServiceId && !requestedVisitId) return { ok: true, job, serviceId: undefined, serviceVisitId: undefined, legacyServiceJobContext: true };
  if (!requestedServiceId || !requestedVisitId) return { ok: false, status: 400, code: 'SERVICE_CONTEXT_INVALID', error: 'Service and Visit are both required for Visit work.' };
  const service = job.services?.find((candidate) => candidate.id === requestedServiceId);
  if (!service) return { ok: false, status: 409, code: 'SERVICE_JOB_MISMATCH', error: 'Service does not belong to the supplied Job.' };
  const visit = await getServiceVisitForBusiness(session.businessId, job.id, requestedVisitId);
  if (!visit) return { ok: false, status: 404, code: 'VISIT_NOT_FOUND', error: 'Service Visit was not found.' };
  if (visit.jobId !== job.id || visit.serviceId !== service.id) return { ok: false, status: 409, code: 'SERVICE_JOB_MISMATCH', error: 'Visit does not belong to the supplied Job and Service.' };
  if (!isEmployeeAssignedToServiceVisit(session, visit, crews)) return { ok: false, status: 403, code: 'VISIT_NOT_ASSIGNED', error: 'This Visit is not assigned to the employee.' };
  if (visit.status === 'cancelled') return { ok: false, status: 409, code: 'VISIT_CANCELLED', error: 'Cancelled Visits cannot be started.' };
  if (visit.status === 'completed') return { ok: false, status: 409, code: 'VISIT_ALREADY_COMPLETED', error: 'Completed Visits cannot be started.' };
  if (visit.status === 'skipped') return { ok: false, status: 409, code: 'VISIT_SKIPPED', error: 'Skipped Visits cannot be started.' };
  if (!['scheduled', 'in_progress'].includes(visit.status)) return { ok: false, status: 409, code: 'VISIT_STATUS_INVALID', error: 'Visit status does not allow work to begin.' };
  return { ok: true, job, service, visit, serviceId: service.id, serviceVisitId: visit.id };
}