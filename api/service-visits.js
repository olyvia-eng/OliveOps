import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness, getBusinessProfile, getEmployeeForBusiness, getEquipmentAssetForBusiness, getJobForBusiness } from './_lib/authRepo.js';
import { normalizeBusinessTimeZone, getBusinessDateParts } from './_lib/businessTime.js';
import { getCrewForBusiness } from './_lib/schedulingConfig.js';
import { requireSession } from './_lib/session.js';
import { createGeneratedServiceVisitsForBusiness, createServiceVisitForBusiness, getServiceVisitForBusiness, listServiceVisitsForJob, listServiceVisitsForSchedule, updateOperationalServiceForBusiness, updateServiceVisitForBusiness } from './_lib/serviceVisitRepo.js';
import { buildGeneratedServiceVisits, resolveVisitBillingStatus, synchronizeServiceVisits, validateVisitStatusTransition } from '../src/utils/serviceVisitModel.js';
import { resolveWorkType } from '../src/utils/workTypeModel.js';

const WRITE_ROLES = ['owner', 'admin', 'foreman'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const idList = (value) => Array.isArray(value) && value.every((id) => typeof id === 'string' && id.trim()) && new Set(value).size === value.length;
const businessDate = (instant, timezone) => { const parts = getBusinessDateParts(instant, timezone); return `${parts.year}-${parts.month}-${parts.day}`; };

function serviceForJob(job, serviceId) {
  return Array.isArray(job?.services) ? job.services.find((service) => service.id === serviceId) : null;
}

async function validateAssignments(deps, businessId, input, existing = {}) {
  if (input.crewId && !await deps.getCrewForBusiness(businessId, input.crewId)) return 'Assigned crew must belong to this business.';
  if (input.assignedEmployeeIds !== undefined) {
    if (!idList(input.assignedEmployeeIds)) return 'Assigned employees are invalid.';
    for (const id of input.assignedEmployeeIds) {
      const employee = await deps.getEmployeeForBusiness(businessId, id);
      if (!employee || (employee.active === false && !existing.assignedEmployeeIds?.includes(id))) return 'Assigned employees must be active and belong to this business.';
    }
  }
  if (input.assignedEquipmentIds !== undefined) {
    if (!idList(input.assignedEquipmentIds)) return 'Assigned equipment is invalid.';
    for (const id of input.assignedEquipmentIds) if (!await deps.getEquipmentAssetForBusiness(businessId, id)) return 'Assigned equipment must belong to this business.';
  }
  return null;
}

function validateSchedule(input, service) {
  if (!DATE_PATTERN.test(input.scheduledDate ?? '')) return 'Visit date is invalid.';
  const start = service.operationalSchedule?.startDate ?? service.startDate;
  const end = service.operationalSchedule?.endDate ?? service.endDate;
  if (start && input.scheduledDate < start) return 'Visit date is before the Service period.';
  if (end && input.scheduledDate > end) return 'Visit date is after the Service period.';
  if (input.startTime && !TIME_PATTERN.test(input.startTime)) return 'Visit start time is invalid.';
  if (input.durationMinutes !== undefined && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440)) return 'Visit duration is invalid.';
  return null;
}

function scheduledFields(input) {
  if (!input.startTime) return { scheduleAllDay: true, scheduledStartAt: undefined, scheduledEndAt: undefined };
  const [hour, minute] = input.startTime.split(':').map(Number);
  const duration = input.durationMinutes ?? 60;
  const endMinutes = hour * 60 + minute + duration;
  const nextDate = new Date(`${input.scheduledDate}T12:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + Math.floor(endMinutes / 1440));
  const pad = (value) => String(value).padStart(2, '0');
  return { scheduleAllDay: false, scheduledStartAt: `${input.scheduledDate}T${input.startTime}:00`, scheduledEndAt: `${nextDate.toISOString().slice(0, 10)}T${pad(Math.floor((endMinutes % 1440) / 60))}:${pad(endMinutes % 60)}:00` };
}

async function audit(deps, session, action, metadata) {
  await deps.createAuditEventForBusiness({ businessId: session.businessId, auditEvent: { id: deps.randomUUID(), action, actorUserId: session.id, actorName: session.name, actorEmail: session.email, metadata, createdAt: deps.now().toISOString() } });
}

export function createServiceVisitsHandler(overrides = {}) {
  const deps = { requireSession, getJobForBusiness, getBusinessProfile, getCrewForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getServiceVisitForBusiness, listServiceVisitsForJob, listServiceVisitsForSchedule, createServiceVisitForBusiness, createGeneratedServiceVisitsForBusiness, updateOperationalServiceForBusiness, updateServiceVisitForBusiness, createAuditEventForBusiness, randomUUID, now: () => new Date(), ...overrides };
  return async function serviceVisitsHandler(req, res) {
    const session = await deps.requireSession(req, res, WRITE_ROLES, 'jobs');
    if (!session) return;
    const action = String(req.query?.action ?? '');
    try {
      if (req.method === 'GET' && action === 'schedule') {
        const startDate = String(req.query?.startDate ?? ''); const endDate = String(req.query?.endDate ?? '');
        if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || endDate < startDate) return res.status(400).json({ ok: false, error: 'Schedule date range is invalid.' });
        const visits = await deps.listServiceVisitsForSchedule(session.businessId, startDate, endDate);
        return res.status(200).json({ ok: true, visits });
      }
      const jobId = String(req.query?.jobId ?? req.body?.jobId ?? '');
      if (!jobId) return res.status(400).json({ ok: false, error: 'Job id is required.' });
      const job = await deps.getJobForBusiness(session.businessId, jobId);
      if (!job || resolveWorkType(job) !== 'service') return res.status(404).json({ ok: false, error: 'Service Job not found.' });
      if (req.method === 'GET') return res.status(200).json({ ok: true, visits: await deps.listServiceVisitsForJob(session.businessId, jobId) });

      const serviceId = String(req.body?.serviceId ?? '');
      const service = serviceForJob(job, serviceId);
      if (!service) return res.status(404).json({ ok: false, error: 'Service not found for this Job.' });
      const profile = await deps.getBusinessProfile(session.businessId);
      const timezone = normalizeBusinessTimeZone(profile?.timezone);
      const now = deps.now(); const nowIso = now.toISOString(); const today = businessDate(now, timezone);

      if (req.method === 'POST' && (action === 'generate' || action === 'sync')) {
        if (service.status !== 'active') return res.status(409).json({ ok: false, error: 'Only active Services generate Visits.' });
        const generated = buildGeneratedServiceVisits({ businessId: session.businessId, job, service, now: nowIso });
        const existing = await deps.listServiceVisitsForJob(session.businessId, job.id);
        const serviceVisits = existing.filter((visit) => visit.serviceId === service.id);
        if (action === 'generate') {
          const result = await deps.createGeneratedServiceVisitsForBusiness({ businessId: session.businessId, visits: generated });
          await audit(deps, session, 'service_visit.generated', { jobId, serviceId, createdCount: result.created.length });
          return res.status(200).json({ ok: true, visits: [...result.existing, ...result.created], createdCount: result.created.length });
        }
        const changes = synchronizeServiceVisits(serviceVisits, generated, req.body?.effectiveFrom && DATE_PATTERN.test(req.body.effectiveFrom) ? req.body.effectiveFrom : today);
        const created = await deps.createGeneratedServiceVisitsForBusiness({ businessId: session.businessId, visits: changes.create });
        for (const visit of [...changes.update, ...changes.cancel]) await deps.updateServiceVisitForBusiness({ businessId: session.businessId, visit: { ...visit, updatedAt: nowIso }, expectedRevision: visit.revision - 1 });
        await audit(deps, session, 'service_series.updated', { jobId, serviceId, createdCount: created.created.length, updatedCount: changes.update.length, cancelledCount: changes.cancel.length });
        return res.status(200).json({ ok: true, createdCount: created.created.length, updatedCount: changes.update.length, cancelledCount: changes.cancel.length });
      }

      if (req.method === 'POST' && action === 'manual') {
        const scheduleError = validateSchedule(req.body, service); if (scheduleError) return res.status(400).json({ ok: false, error: scheduleError });
        const relationshipError = await validateAssignments(deps, session.businessId, req.body); if (relationshipError) return res.status(400).json({ ok: false, error: relationshipError });
        const visit = { id: deps.randomUUID(), businessId: session.businessId, jobId, serviceId, sourceEstimateServiceId: service.sourceEstimateServiceId, scheduledDate: req.body.scheduledDate, ...scheduledFields(req.body), crewId: req.body.crewId || service.operationalSchedule?.defaultCrewId, assignedEmployeeIds: req.body.assignedEmployeeIds ?? service.operationalSchedule?.defaultEmployeeIds ?? [], assignedEquipmentIds: req.body.assignedEquipmentIds ?? service.operationalSchedule?.defaultEquipmentIds ?? [], status: 'scheduled', billingTypeSnapshot: service.billingType, billingStatus: resolveVisitBillingStatus(service.billingType), source: 'manual', revision: 1, notes: String(req.body.notes ?? '').trim(), createdAt: nowIso, updatedAt: nowIso };
        await deps.createServiceVisitForBusiness({ businessId: session.businessId, visit });
        await audit(deps, session, 'service_visit.created', { jobId, serviceId, visitId: visit.id });
        return res.status(201).json({ ok: true, visit });
      }

      if (req.method === 'PATCH' && action === 'service') {
        const status = req.body?.status;
        if (status && !['active', 'paused', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ ok: false, error: 'Service status is invalid.' });
        const operationalSchedule = req.body?.operationalSchedule ? { ...service.operationalSchedule, ...req.body.operationalSchedule, revision: (service.operationalSchedule?.revision ?? 0) + 1, effectiveFrom: req.body.effectiveFrom ?? today } : service.operationalSchedule;
        const relationshipError = await validateAssignments(deps, session.businessId, { crewId: operationalSchedule.defaultCrewId, assignedEmployeeIds: operationalSchedule.defaultEmployeeIds ?? [], assignedEquipmentIds: operationalSchedule.defaultEquipmentIds ?? [] });
        if (relationshipError) return res.status(400).json({ ok: false, error: relationshipError });
        const nextService = { ...service, ...(status ? { status } : {}), operationalSchedule };
        const serviceIndex = job.services.findIndex((item) => item.id === service.id);
        const saved = await deps.updateOperationalServiceForBusiness({ businessId: session.businessId, jobId, serviceIndex, service: nextService, expectedRevision: service.operationalSchedule?.revision ?? 0, updatedAt: nowIso });
        if (!saved.ok) return res.status(409).json({ ok: false, error: 'Service schedule changed since it was opened.' });
        const nextJob = { ...job, services: job.services.map((item) => item.id === service.id ? nextService : item), updatedAt: nowIso };
        await audit(deps, session, 'service_series.updated', { jobId, serviceId, status: nextService.status, scheduleRevision: operationalSchedule.revision });
        return res.status(200).json({ ok: true, job: nextJob, service: nextService });
      }

      if (req.method === 'PATCH') {
        const visitId = String(req.query?.visitId ?? req.body?.visitId ?? '');
        const existing = await deps.getServiceVisitForBusiness(session.businessId, jobId, visitId);
        if (!existing || existing.serviceId !== serviceId) return res.status(404).json({ ok: false, error: 'Visit not found for this Service.' });
        if (req.body?.revision !== existing.revision) return res.status(409).json({ ok: false, error: 'Visit changed since it was opened.' });
        let next = { ...existing, revision: existing.revision + 1, updatedAt: nowIso };
        let event = 'service_visit.rescheduled';
        if (action === 'status') {
          const transitionError = validateVisitStatusTransition(existing.status, req.body.status); if (transitionError) return res.status(409).json({ ok: false, error: transitionError });
          next = { ...next, status: req.body.status, billingStatus: resolveVisitBillingStatus(existing.billingTypeSnapshot, req.body.status), statusReason: String(req.body.reason ?? '').trim(), notes: String(req.body.notes ?? existing.notes ?? '').trim(), ...(req.body.status === 'completed' ? { completedAt: nowIso, completedByUserId: session.id } : {}) };
          event = `service_visit.${req.body.status}`;
        } else if (action === 'reschedule') {
          const scheduleError = validateSchedule(req.body, service); if (scheduleError) return res.status(400).json({ ok: false, error: scheduleError });
          const relationshipError = await validateAssignments(deps, session.businessId, req.body, existing); if (relationshipError) return res.status(400).json({ ok: false, error: relationshipError });
          next = { ...next, scheduledDate: req.body.scheduledDate, ...scheduledFields(req.body), crewId: req.body.crewId ?? existing.crewId, assignedEmployeeIds: req.body.assignedEmployeeIds ?? existing.assignedEmployeeIds, assignedEquipmentIds: req.body.assignedEquipmentIds ?? existing.assignedEquipmentIds, notes: String(req.body.notes ?? existing.notes ?? '').trim(), isSeriesException: Boolean(existing.recurrenceKey) || existing.isSeriesException };
        } else return res.status(405).json({ ok: false, error: 'Method not allowed' });
        const result = await deps.updateServiceVisitForBusiness({ businessId: session.businessId, visit: next, expectedRevision: existing.revision });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Visit changed since it was opened.' });
        await audit(deps, session, event, { jobId, serviceId, visitId });
        return res.status(200).json({ ok: true, visit: next });
      }
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    } catch {
      return res.status(500).json({ ok: false, error: 'Service Visit operation failed.' });
    }
  };
}

export default createServiceVisitsHandler();