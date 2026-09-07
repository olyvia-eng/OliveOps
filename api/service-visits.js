import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness, getBusinessProfile, getEmployeeForBusiness, getEquipmentAssetForBusiness, getJobForBusiness, listFilesForBusiness, listFormsForBusiness, listFormSubmissionsForBusiness, listTimeEntriesForBusiness } from './_lib/authRepo.js';
import { normalizeBusinessTimeZone, getBusinessDateParts } from './_lib/businessTime.js';
import { getCrewForBusiness } from './_lib/schedulingConfig.js';
import { listJobSopAssociationsForBusiness } from './_lib/jobSopRepo.js';
import { requireSession } from './_lib/session.js';
import { createGeneratedServiceVisitsForBusiness, createServiceVisitForBusiness, getServiceVisitForBusiness, listServiceVisitsForJob, listServiceVisitsForSchedule, updateOperationalServiceForBusiness, updateServiceVisitForBusiness } from './_lib/serviceVisitRepo.js';
import { buildGeneratedServiceVisits, resolveVisitBillingStatus, synchronizeServiceVisits, validateVisitStatusTransition } from '../src/utils/serviceVisitModel.js';
import { resolveWorkType } from '../src/utils/workTypeModel.js';
import { calculateServiceVisitAnalysis } from '../src/utils/serviceVisitAnalysis.js';

const WRITE_ROLES = ['owner', 'admin', 'foreman'];
const ALL_ROLES = [...WRITE_ROLES, 'crew_member'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const CLIENT_SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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

async function canAccessVisit(deps, session, visit) {
  if (WRITE_ROLES.includes(session.role) || !session.role) return true;
  if (visit.assignedEmployeeIds?.includes(session.employeeId)) return true;
  if (!visit.crewId) return false;
  const crew = await deps.getCrewForBusiness(session.businessId, visit.crewId);
  return Boolean(crew?.active !== false && (crew?.leadEmployeeId === session.employeeId || crew?.memberIds?.includes(session.employeeId)));
}

function completionRequirements(service) {
  const configured = service.completionRequirements ?? service.operationalSchedule?.completionRequirements ?? {};
  return {
    requiredFormIds: Array.isArray(configured.requiredFormIds) ? [...new Set(configured.requiredFormIds.filter(Boolean))] : [],
    minimumPhotoCount: Number.isInteger(configured.minimumPhotoCount) ? Math.max(0, configured.minimumPhotoCount) : 0,
    noteRequired: configured.noteRequired === true,
  };
}

function safeTimeEntry(entry, includeCost) {
  return {
    id: entry.id, employeeId: entry.employeeId, employeeName: entry.employeeName, status: entry.status,
    clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes: entry.breakMinutes ?? 0,
    ...(includeCost ? { labourCostTotalSnapshot: entry.labourCostTotalSnapshot } : {}),
  };
}

export function createServiceVisitsHandler(overrides = {}) {
  const deps = { requireSession, getJobForBusiness, getBusinessProfile, getCrewForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getServiceVisitForBusiness, listServiceVisitsForJob, listServiceVisitsForSchedule, createServiceVisitForBusiness, createGeneratedServiceVisitsForBusiness, updateOperationalServiceForBusiness, updateServiceVisitForBusiness, createAuditEventForBusiness, listTimeEntriesForBusiness, listFormSubmissionsForBusiness, listFormsForBusiness, listFilesForBusiness, listJobSopAssociationsForBusiness, randomUUID, now: () => new Date(), ...overrides };
  return async function serviceVisitsHandler(req, res) {
    const session = await deps.requireSession(req, res, ALL_ROLES, 'jobs');
    if (!session) return;
    const action = String(req.query?.action ?? '');
    try {
      if (req.method === 'GET' && action === 'schedule') {
        if (!WRITE_ROLES.includes(session.role) && session.role) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const startDate = String(req.query?.startDate ?? ''); const endDate = String(req.query?.endDate ?? '');
        if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || endDate < startDate) return res.status(400).json({ ok: false, error: 'Schedule date range is invalid.' });
        const visits = await deps.listServiceVisitsForSchedule(session.businessId, startDate, endDate);
        return res.status(200).json({ ok: true, visits });
      }
      const jobId = String(req.query?.jobId ?? req.body?.jobId ?? '');
      if (!jobId) return res.status(400).json({ ok: false, error: 'Job id is required.' });
      const job = await deps.getJobForBusiness(session.businessId, jobId);
      if (!job || resolveWorkType(job) !== 'service') return res.status(404).json({ ok: false, error: 'Service Job not found.' });
      if (req.method === 'GET' && action === 'detail') {
        const visitId = String(req.query?.visitId ?? '');
        const visit = await deps.getServiceVisitForBusiness(session.businessId, jobId, visitId);
        const service = serviceForJob(job, visit?.serviceId);
        if (!visit || !service) return res.status(404).json({ ok: false, code: 'VISIT_NOT_FOUND', error: 'Service Visit was not found.' });
        if (!await canAccessVisit(deps, session, visit)) return res.status(403).json({ ok: false, code: 'VISIT_NOT_ASSIGNED', error: 'This Visit is not assigned to the employee.' });
        const [allEntries, submissions, forms, files, sops] = await Promise.all([
          deps.listTimeEntriesForBusiness(session.businessId), deps.listFormSubmissionsForBusiness(session.businessId),
          deps.listFormsForBusiness(session.businessId), deps.listFilesForBusiness(session.businessId),
          deps.listJobSopAssociationsForBusiness(session.businessId, jobId),
        ]);
        const timeEntries = allEntries.filter((entry) => entry.serviceVisitId === visit.id);
        const visitSubmissions = submissions.filter((submission) => submission.serviceVisitId === visit.id);
        const photos = files.filter((file) => file.entityType === 'service-visit' && file.entityId === visit.id && file.category === 'photo' && file.uploadStatus === 'uploaded');
        const requirements = completionRequirements(service);
        const completedFormIds = [...new Set(visitSubmissions.map((submission) => submission.formId))];
        const completion = {
          ...requirements,
          completedFormIds,
          missingFormIds: requirements.requiredFormIds.filter((formId) => !completedFormIds.includes(formId)),
          photoCount: photos.length,
          noteCount: visit.visitNotes?.length ?? 0,
          activeTimeEntryCount: timeEntries.filter((entry) => entry.status === 'clocked_in').length,
        };
        const includeCost = WRITE_ROLES.includes(session.role) || !session.role;
        return res.status(200).json({ ok: true, visit, job: { id: job.id, title: job.title, customerId: job.customerId, propertyId: job.propertyId }, service: { id: service.id, name: service.name, billingType: service.billingType }, timeEntries: timeEntries.map((entry) => safeTimeEntry(entry, includeCost)), forms: forms.filter((form) => requirements.requiredFormIds.includes(form.id)).map((form) => ({ id: form.id, name: form.name, completionRequirement: form.completionRequirement })), formSubmissions: visitSubmissions, photos: photos.map((file) => ({ id: file.id, fileName: file.fileName, mimeType: file.mimeType, uploadedAt: file.uploadedAt })), sops, completion, ...(includeCost ? { analysis: calculateServiceVisitAnalysis({ visit, service, timeEntries, actualCosts: job.costEntries ?? [] }) } : {}) });
      }
      if (req.method === 'GET') {
        if (!WRITE_ROLES.includes(session.role) && session.role) return res.status(403).json({ ok: false, error: 'Forbidden' });
        return res.status(200).json({ ok: true, visits: await deps.listServiceVisitsForJob(session.businessId, jobId) });
      }

      if (!WRITE_ROLES.includes(session.role) && session.role) {
        if (!(req.method === 'POST' && ['complete', 'add-note'].includes(action))) return res.status(403).json({ ok: false, error: 'Forbidden' });
      }

      const serviceId = String(req.body?.serviceId ?? '');
      const service = serviceForJob(job, serviceId);
      if (!service) return res.status(404).json({ ok: false, error: 'Service not found for this Job.' });
      const profile = await deps.getBusinessProfile(session.businessId);
      const timezone = normalizeBusinessTimeZone(profile?.timezone);
      const now = deps.now(); const nowIso = now.toISOString(); const today = businessDate(now, timezone);

      if (req.method === 'POST' && (action === 'complete' || action === 'add-note')) {
        const visitId = String(req.query?.visitId ?? req.body?.visitId ?? '');
        const existing = await deps.getServiceVisitForBusiness(session.businessId, jobId, visitId);
        if (!existing || existing.serviceId !== serviceId) return res.status(404).json({ ok: false, code: 'VISIT_NOT_FOUND', error: 'Visit not found for this Service.' });
        if (!await canAccessVisit(deps, session, existing)) return res.status(403).json({ ok: false, code: 'VISIT_NOT_ASSIGNED', error: 'This Visit is not assigned to the employee.' });
        const clientSubmissionId = String(req.body?.clientSubmissionId ?? '').trim();
        if (!CLIENT_SUBMISSION_ID_PATTERN.test(clientSubmissionId)) return res.status(400).json({ ok: false, code: 'INVALID_CLIENT_SUBMISSION_ID', error: 'A valid client submission id is required.' });
        if (action === 'add-note') {
          const noteText = String(req.body?.text ?? '').trim();
          if (!noteText) return res.status(400).json({ ok: false, code: 'NOTE_REQUIRED', error: 'Visit note text is required.' });
          const replay = existing.visitNotes?.find((note) => note.clientSubmissionId === clientSubmissionId);
          if (replay) return res.status(200).json({ ok: true, replayed: true, note: replay, visit: existing });
          const note = { id: deps.randomUUID(), clientSubmissionId, text: noteText, authorUserId: session.id, authorName: session.name, createdAt: nowIso };
          const next = { ...existing, visitNotes: [...(existing.visitNotes ?? []), note], revision: existing.revision + 1, updatedAt: nowIso };
          const result = await deps.updateServiceVisitForBusiness({ businessId: session.businessId, visit: next, expectedRevision: existing.revision });
          if (!result.ok) return res.status(409).json({ ok: false, code: 'VISIT_REVISION_CONFLICT', error: 'Visit changed since it was opened.' });
          await audit(deps, session, 'service_visit.note_added', { jobId, serviceId, visitId, noteId: note.id });
          return res.status(201).json({ ok: true, note, visit: next });
        }
        if (existing.status === 'completed' && existing.completionClientSubmissionId === clientSubmissionId) return res.status(200).json({ ok: true, replayed: true, visit: existing });
        if (!['scheduled', 'in_progress'].includes(existing.status)) return res.status(409).json({ ok: false, code: 'VISIT_STATUS_INVALID', error: `Visit cannot be completed from ${existing.status}.` });
        const [entries, submissions, files] = await Promise.all([deps.listTimeEntriesForBusiness(session.businessId, { consistentRead: true }), deps.listFormSubmissionsForBusiness(session.businessId), deps.listFilesForBusiness(session.businessId)]);
        if (entries.some((entry) => entry.serviceVisitId === visitId && entry.status === 'clocked_in')) return res.status(409).json({ ok: false, code: 'VISIT_HAS_ACTIVE_TIME_ENTRIES', error: 'Clock out all employees from this Visit before completing it.' });
        const requirements = completionRequirements(service);
        const completedFormIds = new Set(submissions.filter((submission) => submission.serviceVisitId === visitId && ['submitted', 'pending_review', 'approved'].includes(submission.status)).map((submission) => submission.formId));
        const missingFormIds = requirements.requiredFormIds.filter((formId) => !completedFormIds.has(formId));
        if (missingFormIds.length) return res.status(409).json({ ok: false, code: 'VISIT_REQUIRED_FORMS_OUTSTANDING', error: 'Required Visit Forms are outstanding.', missingFormIds });
        const photoCount = files.filter((file) => file.entityType === 'service-visit' && file.entityId === visitId && file.category === 'photo' && file.uploadStatus === 'uploaded').length;
        if (photoCount < requirements.minimumPhotoCount) return res.status(409).json({ ok: false, code: 'VISIT_REQUIRED_PHOTOS_OUTSTANDING', error: 'Required Visit photos are outstanding.', required: requirements.minimumPhotoCount, actual: photoCount });
        if (requirements.noteRequired && !(existing.visitNotes?.length || String(existing.notes ?? '').trim())) return res.status(409).json({ ok: false, code: 'VISIT_REQUIRED_NOTE_OUTSTANDING', error: 'A Visit note is required before completion.' });
        const next = { ...existing, status: 'completed', billingStatus: resolveVisitBillingStatus(existing.billingTypeSnapshot, 'completed'), completedAt: nowIso, completedByUserId: session.id, completionClientSubmissionId: clientSubmissionId, revision: existing.revision + 1, updatedAt: nowIso };
        const result = await deps.updateServiceVisitForBusiness({ businessId: session.businessId, visit: next, expectedRevision: existing.revision });
        if (!result.ok) return res.status(409).json({ ok: false, code: 'VISIT_REVISION_CONFLICT', error: 'Visit changed since it was opened.' });
        await audit(deps, session, 'service_visit.completed', { jobId, serviceId, visitId });
        return res.status(200).json({ ok: true, visit: next });
      }

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
          if (req.body.status === 'completed') return res.status(409).json({ ok: false, code: 'EXPLICIT_VISIT_COMPLETION_REQUIRED', error: 'Use the Visit completion action so field requirements can be verified.' });
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