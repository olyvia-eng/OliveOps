import { randomUUID } from 'node:crypto';
import { requireSession } from './_lib/session.js';
import { createAuditEventForBusiness, getBusinessProfile, getCustomerForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getFileForBusiness, getJobForBusiness } from './_lib/authRepo.js';
import { getServiceVisitForBusiness } from './_lib/serviceVisitRepo.js';
import {
  commitSnowIdempotentMutation, deleteSnowStopForBusiness, getSnowEventForBusiness, getSnowOccurrenceForBusiness, getSnowRouteForBusiness,
  getSnowServiceTypeForBusiness,
  getSnowStopForBusiness, listSnowBreadcrumbsForStop, listSnowEventsForBusiness, listSnowEvidenceForStop, listSnowOccurrencesForRoute,
  listSnowOccurrencesForStop, listSnowRoutesForEvent, listSnowServiceTypesForBusiness, listSnowStopsForRoute, putSnowBreadcrumbBatchForBusiness,
  putSnowEventForBusiness, putSnowEvidenceForBusiness, putSnowOccurrenceForBusiness, putSnowRouteForBusiness, putSnowServiceTypeForBusiness,
  putSnowStopForBusiness,
} from './_lib/snowRepo.js';
import {
  DEFAULT_SNOW_SERVICE_TYPES, SNOW_EVENT_TRANSITIONS, SNOW_OCCURRENCE_TRANSITIONS, SNOW_ROUTE_TRANSITIONS, SNOW_STOP_TRANSITIONS,
  canTransitionSnowState, deriveSnowStopAttention, nextSnowStop, normalizeBreadcrumbBatch, normalizeGpsEvidence, snowRouteProgress,
} from '../src/utils/snowOperationsModel.js';
import { isBusinessFeatureEnabled } from '../shared/businessFeatures.js';

const ALL_ROLES = ['owner', 'admin', 'foreman', 'crew_member'];
const ADMIN_ROLES = ['owner', 'admin'];
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const clean = (value, length = 240) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const ids = (value) => Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))] : [];
const absoluteTime = (value) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

async function audit(deps, session, action, metadata, at) {
  await deps.createAuditEventForBusiness({ businessId: session.businessId, auditEvent: { id: deps.randomUUID(), action, actorUserId: session.id, actorName: session.name, actorEmail: session.email, metadata, createdAt: at } });
}

async function validateAssignments(deps, businessId, foremanId, crewIds, equipmentIds) {
  const foreman = await deps.getEmployeeForBusiness(businessId, foremanId);
  if (!foreman || foreman.active === false || foreman.role !== 'foreman') return 'Assigned Foreman must be an active Foreman in this business.';
  if (crewIds.includes(foremanId)) return 'Assigned Foreman cannot also be in Assigned Crew.';
  for (const employeeId of crewIds) {
    const employee = await deps.getEmployeeForBusiness(businessId, employeeId);
    if (!employee || employee.active === false) return 'Assigned Crew must contain active Employees in this business.';
  }
  for (const equipmentId of equipmentIds) if (!await deps.getEquipmentAssetForBusiness(businessId, equipmentId)) return 'Assigned Equipment must belong to this business.';
  return null;
}

function isAssigned(session, route) {
  if (ADMIN_ROLES.includes(session.role)) return true;
  return Boolean(session.employeeId && route.assignedEmployeeIds?.includes(session.employeeId));
}

async function context(deps, session, query) {
  const event = await deps.getSnowEventForBusiness(session.businessId, clean(query.eventId));
  if (!event) return { error: [404, 'Snow Event not found.'] };
  const route = query.routeId ? await deps.getSnowRouteForBusiness(session.businessId, event.id, clean(query.routeId)) : null;
  if (query.routeId && (!route || route.snowEventId !== event.id)) return { error: [404, 'Snow Route not found.'] };
  const stop = query.stopId && route ? await deps.getSnowStopForBusiness(session.businessId, event.id, route.id, clean(query.stopId)) : null;
  if (query.stopId && (!stop || stop.snowRouteId !== route?.id)) return { error: [404, 'Snow Route Stop not found.'] };
  const occurrence = query.occurrenceId && stop ? await deps.getSnowOccurrenceForBusiness(session.businessId, event.id, route.id, stop.id, clean(query.occurrenceId)) : null;
  if (query.occurrenceId && (!occurrence || occurrence.routeStopId !== stop?.id)) return { error: [404, 'Snow Service occurrence not found.'] };
  return { event, route, stop, occurrence };
}

async function commitCommand(deps, session, body, action, response, writes, at) {
  const key = clean(body.clientSubmissionId, 128);
  if (!IDEMPOTENCY_PATTERN.test(key)) return { error: [400, 'A valid client submission ID is required.'] };
  const employeeId = session.employeeId ?? session.id;
  const result = await deps.commitSnowIdempotentMutation({ businessId: session.businessId, employeeId, key, action, response, writes, createdAt: at });
  if (result.keyConflict) return { error: [409, 'Client submission ID was already used for another action.'] };
  if (result.conflict) return { error: [409, 'Snow Operations data changed since it was opened.'] };
  return result.replay ? { replay: result.replay } : { ok: true };
}

export function createSnowOperationsHandler(overrides = {}) {
  const deps = { requireSession, randomUUID, now: () => new Date(), createAuditEventForBusiness, getBusinessProfile, getCustomerForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getFileForBusiness, getJobForBusiness, getServiceVisitForBusiness, commitSnowIdempotentMutation, deleteSnowStopForBusiness, getSnowEventForBusiness, getSnowOccurrenceForBusiness, getSnowRouteForBusiness, getSnowServiceTypeForBusiness, getSnowStopForBusiness, listSnowBreadcrumbsForStop, listSnowEventsForBusiness, listSnowEvidenceForStop, listSnowOccurrencesForRoute, listSnowOccurrencesForStop, listSnowRoutesForEvent, listSnowServiceTypesForBusiness, listSnowStopsForRoute, putSnowBreadcrumbBatchForBusiness, putSnowEventForBusiness, putSnowEvidenceForBusiness, putSnowOccurrenceForBusiness, putSnowRouteForBusiness, putSnowServiceTypeForBusiness, putSnowStopForBusiness, ...overrides };
  return async function snowOperationsHandler(req, res) {
    const session = await deps.requireSession(req, res, ALL_ROLES, 'jobs');
    if (!session) return;
    const action = clean(req.query?.action, 80);
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const now = deps.now().toISOString();
    try {
      const business = await deps.getBusinessProfile(session.businessId);
      if (!isBusinessFeatureEnabled(business?.features, 'snowOperations')) {
        return res.status(403).json({ ok: false, error: 'Snow Operations is not enabled for your company.' });
      }
      if (req.method === 'GET' && action === 'events') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const events = (await deps.listSnowEventsForBusiness(session.businessId)).sort((a, b) => b.startAt.localeCompare(a.startAt));
        return res.status(200).json({ ok: true, events });
      }
      if (req.method === 'GET' && action === 'service-types') {
        let serviceTypes = await deps.listSnowServiceTypesForBusiness(session.businessId);
        if (!serviceTypes.length && ADMIN_ROLES.includes(session.role)) {
          serviceTypes = await Promise.all(DEFAULT_SNOW_SERVICE_TYPES.map(async (name, index) => {
            const serviceType = { id: `snow-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, active: true, sortOrder: index, revision: 1, createdAt: now, updatedAt: now };
            await deps.putSnowServiceTypeForBusiness({ businessId: session.businessId, serviceType, createOnly: true });
            return serviceType;
          }));
        }
        return res.status(200).json({ ok: true, serviceTypes: serviceTypes.sort((a, b) => a.sortOrder - b.sortOrder) });
      }
      if (req.method === 'POST' && action === 'service-type') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const name = clean(body.name, 80); if (!name) return res.status(400).json({ ok: false, error: 'Service Type name is required.' });
        const serviceType = { id: clean(body.id) || deps.randomUUID(), name, active: body.active !== false, sortOrder: Number(body.sortOrder) || 0, revision: 1, createdAt: now, updatedAt: now };
        const result = await deps.putSnowServiceTypeForBusiness({ businessId: session.businessId, serviceType, createOnly: true });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Service Type already exists.' });
        return res.status(201).json({ ok: true, serviceType });
      }
      if (req.method === 'PATCH' && action === 'service-type') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const existing = await deps.getSnowServiceTypeForBusiness(session.businessId, clean(body.id));
        if (!existing) return res.status(404).json({ ok: false, error: 'Snow Service Type not found.' });
        const serviceType = { ...existing, name: clean(body.name, 80) || existing.name, active: typeof body.active === 'boolean' ? body.active : existing.active, sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : existing.sortOrder, revision: existing.revision + 1, updatedAt: now };
        const result = await deps.putSnowServiceTypeForBusiness({ businessId: session.businessId, serviceType, expectedRevision: existing.revision });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Snow Service Type changed since it was opened.' });
        await audit(deps, session, 'snow_service_type.updated', { serviceTypeId: serviceType.id, active: serviceType.active }, now);
        return res.status(200).json({ ok: true, serviceType });
      }
      if (req.method === 'POST' && action === 'event') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        if (!clean(body.title, 120) || !absoluteTime(body.startAt)) return res.status(400).json({ ok: false, error: 'Snow Event title and absolute start time are required.' });
        const event = { id: deps.randomUUID(), title: clean(body.title, 120), startAt: body.startAt, ...(absoluteTime(body.endAt) ? { endAt: body.endAt } : {}), status: 'draft', notes: clean(body.notes, 2000), createdBy: session.id, revision: 1, createdAt: now, updatedAt: now };
        await deps.putSnowEventForBusiness({ businessId: session.businessId, event, createOnly: true });
        await audit(deps, session, 'snow_event.created', { snowEventId: event.id }, now);
        return res.status(201).json({ ok: true, event });
      }
      if (req.method === 'PATCH' && action === 'event') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const title = clean(body.title, 120) || scoped.event.title;
        const startAt = body.startAt === undefined ? scoped.event.startAt : body.startAt;
        if (!absoluteTime(startAt) || body.endAt !== undefined && body.endAt !== '' && !absoluteTime(body.endAt)) return res.status(400).json({ ok: false, error: 'Snow Event times must include a timezone.' });
        const event = { ...scoped.event, title, startAt, ...(body.endAt === '' ? { endAt: undefined } : absoluteTime(body.endAt) ? { endAt: body.endAt } : {}), notes: body.notes === undefined ? scoped.event.notes : clean(body.notes, 2000), revision: scoped.event.revision + 1, updatedAt: now };
        const result = await deps.putSnowEventForBusiness({ businessId: session.businessId, event, expectedRevision: scoped.event.revision });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Snow Event changed since it was opened.' });
        await audit(deps, session, 'snow_event.updated', { snowEventId: event.id }, now);
        return res.status(200).json({ ok: true, event });
      }
      if (req.method === 'GET' && action === 'detail') {
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const routes = await deps.listSnowRoutesForEvent(session.businessId, scoped.event.id);
        const authorizedRoutes = ADMIN_ROLES.includes(session.role) ? routes : routes.filter((route) => isAssigned(session, route));
        if (!ADMIN_ROLES.includes(session.role) && !authorizedRoutes.length) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const routeDetails = await Promise.all(authorizedRoutes.map(async (route) => {
          const stops = await deps.listSnowStopsForRoute(session.businessId, scoped.event.id, route.id);
          const enrichedStops = await Promise.all(stops.sort((a, b) => a.sortOrder - b.sortOrder).map(async (stop) => ({
            ...stop,
            occurrences: await deps.listSnowOccurrencesForStop(session.businessId, scoped.event.id, route.id, stop.id),
          })));
          return { ...route, stops: enrichedStops, progress: snowRouteProgress(stops) };
        }));
        return res.status(200).json({ ok: true, event: scoped.event, routes: routeDetails });
      }
      if (req.method === 'GET' && action === 'my-active-route') {
        if (!session.employeeId) return res.status(403).json({ ok: false, error: 'Employee profile is required.' });
        const events = (await deps.listSnowEventsForBusiness(session.businessId)).filter((event) => event.status === 'active').sort((a, b) => b.startAt.localeCompare(a.startAt));
        for (const event of events) {
          const routes = await deps.listSnowRoutesForEvent(session.businessId, event.id);
          const route = routes.find((item) => item.status !== 'completed' && isAssigned(session, item));
          if (route) {
            const stops = (await deps.listSnowStopsForRoute(session.businessId, event.id, route.id)).sort((a, b) => a.sortOrder - b.sortOrder);
            const enrichedStops = await Promise.all(stops.map(async (stop) => ({ ...stop, occurrences: await deps.listSnowOccurrencesForStop(session.businessId, event.id, route.id, stop.id) })));
            return res.status(200).json({ ok: true, event, route, stops: enrichedStops, progress: snowRouteProgress(stops) });
          }
        }
        return res.status(200).json({ ok: true, event: null, route: null, stops: [] });
      }
      if (req.method === 'PATCH' && action === 'event-status') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        if (!canTransitionSnowState(SNOW_EVENT_TRANSITIONS, scoped.event.status, body.status)) return res.status(409).json({ ok: false, error: 'Invalid Snow Event status transition.' });
        const event = { ...scoped.event, status: body.status, ...(body.status === 'completed' ? { endAt: now } : {}), revision: scoped.event.revision + 1, updatedAt: now };
        const result = await deps.putSnowEventForBusiness({ businessId: session.businessId, event, expectedRevision: scoped.event.revision });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Snow Event changed since it was opened.' });
        await audit(deps, session, `snow_event.${body.status}`, { snowEventId: event.id }, now);
        return res.status(200).json({ ok: true, event });
      }
      if (req.method === 'POST' && action === 'route') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const crew = ids(body.assignedCrewEmployeeIds); const equipment = ids(body.assignedEquipmentIds); const foremanId = clean(body.assignedForemanId);
        const assignmentError = await validateAssignments(deps, session.businessId, foremanId, crew, equipment); if (assignmentError) return res.status(400).json({ ok: false, error: assignmentError });
        const route = { id: deps.randomUUID(), snowEventId: scoped.event.id, name: clean(body.name, 80) || 'Snow Route', assignedForemanId: foremanId, assignedCrewEmployeeIds: crew, assignedEmployeeIds: [foremanId, ...crew], assignedEquipmentIds: equipment, startingLocation: clean(body.startingLocation, 300), status: 'not_started', revision: 1, createdAt: now, updatedAt: now, lastUpdatedAt: now };
        await deps.putSnowRouteForBusiness({ businessId: session.businessId, route, createOnly: true });
        await audit(deps, session, 'snow_route.created', { snowEventId: scoped.event.id, snowRouteId: route.id }, now);
        return res.status(201).json({ ok: true, route });
      }
      if (req.method === 'PATCH' && action === 'route-assignments') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const crew = ids(body.assignedCrewEmployeeIds); const equipment = ids(body.assignedEquipmentIds); const foremanId = clean(body.assignedForemanId);
        const assignmentError = await validateAssignments(deps, session.businessId, foremanId, crew, equipment); if (assignmentError) return res.status(400).json({ ok: false, error: assignmentError });
        const route = { ...scoped.route, assignedForemanId: foremanId, assignedCrewEmployeeIds: crew, assignedEmployeeIds: [foremanId, ...crew], assignedEquipmentIds: equipment, revision: scoped.route.revision + 1, updatedAt: now, lastUpdatedAt: now };
        const result = await deps.putSnowRouteForBusiness({ businessId: session.businessId, route, expectedRevision: scoped.route.revision }); if (!result.ok) return res.status(409).json({ ok: false, error: 'Snow Route changed since it was opened.' });
        await audit(deps, session, 'snow_route.assignments_changed', { snowEventId: scoped.event.id, snowRouteId: route.id }, now);
        return res.status(200).json({ ok: true, route });
      }
      if (req.method === 'PATCH' && action === 'route') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const route = { ...scoped.route, name: clean(body.name, 80) || scoped.route.name, startingLocation: body.startingLocation === undefined ? scoped.route.startingLocation : clean(body.startingLocation, 300), revision: scoped.route.revision + 1, updatedAt: now, lastUpdatedAt: now };
        const result = await deps.putSnowRouteForBusiness({ businessId: session.businessId, route, expectedRevision: scoped.route.revision });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Snow Route changed since it was opened.' });
        await audit(deps, session, 'snow_route.updated', { snowEventId: scoped.event.id, snowRouteId: route.id }, now);
        return res.status(200).json({ ok: true, route });
      }
      if (req.method === 'POST' && action === 'stop') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const job = await deps.getJobForBusiness(session.businessId, clean(body.serviceJobId)); if (!job || job.workType !== 'service') return res.status(400).json({ ok: false, error: 'Stop must reference a Service Job in this business.' });
        if (body.serviceVisitId && !await deps.getServiceVisitForBusiness(session.businessId, job.id, clean(body.serviceVisitId))) return res.status(400).json({ ok: false, error: 'Service Visit must belong to the selected Service Job.' });
        const customer = await deps.getCustomerForBusiness(session.businessId, job.customerId); if (!customer) return res.status(400).json({ ok: false, error: 'Service Job Customer was not found.' });
        const existingStops = await deps.listSnowStopsForRoute(session.businessId, scoped.event.id, scoped.route.id);
        const stop = { id: deps.randomUUID(), snowEventId: scoped.event.id, snowRouteId: scoped.route.id, serviceJobId: job.id, ...(body.serviceVisitId ? { serviceVisitId: clean(body.serviceVisitId) } : {}), customerId: job.customerId, customerNameSnapshot: customer.name || customer.company || 'Customer', propertyLabel: job.propertyLabel || customer.properties?.[0]?.nickname || job.title, address: job.propertyAddressSnapshot || clean(body.address, 400), siteNotes: clean(body.siteNotes, 2000), sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : existingStops.length, plannedServiceTypeIds: ids(body.plannedServiceTypeIds), status: 'pending', revision: 1, createdAt: now, updatedAt: now, lastUpdatedAt: now };
        await deps.putSnowStopForBusiness({ businessId: session.businessId, stop, createOnly: true });
        await audit(deps, session, 'snow_stop.created', { snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: stop.id, serviceJobId: job.id }, now);
        return res.status(201).json({ ok: true, stop });
      }
      if (req.method === 'PATCH' && action === 'reorder-stops') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const order = ids(body.stopIds); const stops = await deps.listSnowStopsForRoute(session.businessId, scoped.event.id, scoped.route.id);
        if (order.length !== stops.length || stops.some((stop) => !order.includes(stop.id))) return res.status(400).json({ ok: false, error: 'Stop order must contain every Route Stop exactly once.' });
        await Promise.all(stops.map((stop) => deps.putSnowStopForBusiness({ businessId: session.businessId, stop: { ...stop, sortOrder: order.indexOf(stop.id), revision: stop.revision + 1, updatedAt: now }, expectedRevision: stop.revision })));
        await audit(deps, session, 'snow_route.stops_reordered', { snowEventId: scoped.event.id, snowRouteId: scoped.route.id, stopIds: order }, now);
        return res.status(200).json({ ok: true, stopIds: order });
      }
      if (req.method === 'PATCH' && action === 'stop') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        const stop = { ...scoped.stop, siteNotes: body.siteNotes === undefined ? scoped.stop.siteNotes : clean(body.siteNotes, 2000), plannedServiceTypeIds: body.plannedServiceTypeIds === undefined ? scoped.stop.plannedServiceTypeIds : ids(body.plannedServiceTypeIds), revision: scoped.stop.revision + 1, updatedAt: now, lastUpdatedAt: now };
        const result = await deps.putSnowStopForBusiness({ businessId: session.businessId, stop, expectedRevision: scoped.stop.revision });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Snow Route Stop changed since it was opened.' });
        await audit(deps, session, 'snow_stop.updated', { snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: stop.id }, now);
        return res.status(200).json({ ok: true, stop });
      }
      if (req.method === 'DELETE' && action === 'stop') {
        if (!ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        if (scoped.stop.status !== 'pending') return res.status(409).json({ ok: false, error: 'Only pending Route Stops can be removed.' });
        await deps.deleteSnowStopForBusiness({ businessId: session.businessId, eventId: scoped.event.id, routeId: scoped.route.id, stopId: scoped.stop.id });
        await audit(deps, session, 'snow_stop.removed', { snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: scoped.stop.id }, now);
        return res.status(200).json({ ok: true });
      }
      if (req.method === 'POST' && action === 'start-route') {
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        if (!isAssigned(session, scoped.route)) return res.status(403).json({ ok: false, error: 'You are not assigned to this Snow Route.' });
        if (scoped.event.status !== 'active') return res.status(409).json({ ok: false, error: 'The Snow Event must be active before its Routes can start.' });
        if (!canTransitionSnowState(SNOW_ROUTE_TRANSITIONS, scoped.route.status, 'active')) return res.status(409).json({ ok: false, error: 'Snow Route cannot be started from its current state.' });
        const route = { ...scoped.route, status: 'active', startedAt: scoped.route.startedAt ?? now, revision: scoped.route.revision + 1, updatedAt: now, lastUpdatedAt: now };
        const claim = await commitCommand(deps, session, body, action, { route }, [{ kind: 'route', record: route, expectedRevision: scoped.route.revision }], now); if (claim.error) return res.status(claim.error[0]).json({ ok: false, error: claim.error[1] }); if (claim.replay) return res.status(200).json({ ok: true, replayed: true, ...claim.replay });
        await audit(deps, session, 'snow_route.started', { snowEventId: scoped.event.id, snowRouteId: route.id }, now);
        return res.status(200).json({ ok: true, route });
      }
      if (req.method === 'POST' && action === 'complete-route') {
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        if (!isAssigned(session, scoped.route)) return res.status(403).json({ ok: false, error: 'You are not assigned to this Snow Route.' });
        const stops = await deps.listSnowStopsForRoute(session.businessId, scoped.event.id, scoped.route.id);
        if (stops.some((stop) => !['completed', 'skipped'].includes(stop.status))) return res.status(409).json({ ok: false, error: 'Every Stop must be completed or skipped before completing the Route.' });
        if (!canTransitionSnowState(SNOW_ROUTE_TRANSITIONS, scoped.route.status, 'completed')) return res.status(409).json({ ok: false, error: 'Snow Route cannot be completed from its current state.' });
        const route = { ...scoped.route, status: 'completed', completedAt: now, revision: scoped.route.revision + 1, updatedAt: now, lastUpdatedAt: now };
        const claim = await commitCommand(deps, session, body, action, { route }, [{ kind: 'route', record: route, expectedRevision: scoped.route.revision }], now); if (claim.error) return res.status(claim.error[0]).json({ ok: false, error: claim.error[1] }); if (claim.replay) return res.status(200).json({ ok: true, replayed: true, ...claim.replay });
        await audit(deps, session, 'snow_route.completed', { snowEventId: scoped.event.id, snowRouteId: route.id }, now);
        return res.status(200).json({ ok: true, route });
      }
      if (['en-route', 'arrival', 'select-service', 'before-photo', 'start-service', 'finish-service', 'after-photo', 'complete-service', 'skip-stop', 'flag-stop', 'breadcrumbs'].includes(action)) {
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] });
        if (!isAssigned(session, scoped.route)) return res.status(403).json({ ok: false, error: 'You are not assigned to this Snow Route.' });
        if (scoped.event.status !== 'active' || scoped.route.status !== 'active') return res.status(409).json({ ok: false, error: 'The Snow Event and Route must be active.' });
        const employeeId = session.employeeId ?? session.id;
        const deviceCapturedAt = absoluteTime(body.deviceCapturedAt) ? body.deviceCapturedAt : now;
        const gps = normalizeGpsEvidence(body.gps ?? { unavailableReason: body.gpsUnavailableReason });
        if (action === 'breadcrumbs') {
          if (!scoped.occurrence || scoped.occurrence.status !== 'active') return res.status(409).json({ ok: false, error: 'Breadcrumbs are accepted only during active Snow service.' });
          const points = normalizeBreadcrumbBatch(body.points); if (!points) return res.status(400).json({ ok: false, error: 'Breadcrumb batch is invalid.' });
          const batch = { id: clean(body.clientSubmissionId, 128), snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: scoped.stop.id, occurrenceId: scoped.occurrence.id, employeeId, points: points.map((point) => ({ ...point, serverRecordedAt: now })), createdAt: now };
          const claim = await commitCommand(deps, session, body, action, { batch }, [{ kind: 'breadcrumb', record: batch, createOnly: true }], now); if (claim.error) return res.status(claim.error[0]).json({ ok: false, error: claim.error[1] }); if (claim.replay) return res.status(200).json({ ok: true, replayed: true, ...claim.replay });
          return res.status(201).json({ ok: true, batch });
        }
        if (action === 'select-service') {
          if (scoped.stop.status !== 'arrived') return res.status(409).json({ ok: false, error: 'Arrive at the Stop before selecting service.' });
          const serviceType = (await deps.listSnowServiceTypesForBusiness(session.businessId)).find((item) => item.id === body.serviceTypeId && item.active); if (!serviceType) return res.status(400).json({ ok: false, error: 'Snow Service Type is invalid.' });
          const occurrence = { id: deps.randomUUID(), snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: scoped.stop.id, ...(scoped.stop.serviceVisitId ? { serviceVisitId: scoped.stop.serviceVisitId } : {}), serviceTypeId: serviceType.id, serviceTypeName: serviceType.name, employeeId, status: 'not_started', beforePhotoFileIds: [], afterPhotoFileIds: [], revision: 1, createdAt: now, updatedAt: now };
          const claim = await commitCommand(deps, session, body, action, { occurrence }, [{ kind: 'occurrence', record: occurrence, createOnly: true }], now); if (claim.error) return res.status(claim.error[0]).json({ ok: false, error: claim.error[1] }); if (claim.replay) return res.status(200).json({ ok: true, replayed: true, ...claim.replay });
          await audit(deps, session, 'snow_service.selected', { snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: scoped.stop.id, occurrenceId: occurrence.id, serviceTypeId: serviceType.id }, now); return res.status(201).json({ ok: true, occurrence });
        }
        if (['before-photo', 'after-photo'].includes(action)) {
          if (!scoped.occurrence) return res.status(404).json({ ok: false, error: 'Snow Service occurrence is required.' });
          const stage = action === 'before-photo' ? 'BEFORE' : 'AFTER'; const file = await deps.getFileForBusiness(session.businessId, clean(body.fileId));
          if (stage === 'BEFORE' && !['not_started', 'before_evidence_complete'].includes(scoped.occurrence.status)) return res.status(409).json({ ok: false, error: 'Before Service photos must be recorded before service starts.' });
          if (stage === 'AFTER' && scoped.occurrence.status !== 'awaiting_after_evidence') return res.status(409).json({ ok: false, error: 'After Service photos can be recorded only after service is finished.' });
          if (!file || file.entityType !== 'snow-occurrence' || file.entityId !== scoped.occurrence.id || file.category !== (stage === 'BEFORE' ? 'before-photo' : 'after-photo') || file.uploadStatus !== 'uploaded') return res.status(400).json({ ok: false, error: 'Photo upload does not match this Snow Service occurrence.' });
          const fileIds = stage === 'BEFORE' ? [...new Set([...scoped.occurrence.beforePhotoFileIds, file.id])] : [...new Set([...scoped.occurrence.afterPhotoFileIds, file.id])];
          const occurrence = { ...scoped.occurrence, ...(stage === 'BEFORE' ? { beforePhotoFileIds: fileIds, status: 'before_evidence_complete' } : { afterPhotoFileIds: fileIds }), revision: scoped.occurrence.revision + 1, updatedAt: now };
          const evidence = { id: deps.randomUUID(), snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: scoped.stop.id, occurrenceId: occurrence.id, serviceVisitId: scoped.stop.serviceVisitId, employeeId, eventType: 'PHOTO_RECORDED', stage, fileId: file.id, serviceTypeId: occurrence.serviceTypeId, gps, deviceCapturedAt, serverRecordedAt: now };
          const claim = await commitCommand(deps, session, body, action, { occurrence, evidence }, [{ kind: 'occurrence', record: occurrence, expectedRevision: scoped.occurrence.revision }, { kind: 'evidence', record: evidence, createOnly: true }], now); if (claim.error) return res.status(claim.error[0]).json({ ok: false, error: claim.error[1] }); if (claim.replay) return res.status(200).json({ ok: true, replayed: true, ...claim.replay });
          await audit(deps, session, `snow_photo.${stage.toLowerCase()}_recorded`, { occurrenceId: occurrence.id, fileId: file.id }, now); return res.status(200).json({ ok: true, occurrence, evidence });
        }
        const transitionByAction = { 'en-route': ['en_route', 'EN_ROUTE'], arrival: ['arrived', 'ARRIVED'], 'start-service': ['servicing', 'SERVICE_STARTED'], 'finish-service': ['servicing', 'SERVICE_FINISHED'], 'complete-service': ['completed', 'SERVICE_COMPLETED'], 'skip-stop': ['skipped', 'STOP_SKIPPED'], 'flag-stop': ['needs_attention', 'STOP_FLAGGED'] };
        const [nextStatus, eventType] = transitionByAction[action];
        if (['en-route', 'arrival'].includes(action) && !canTransitionSnowState(SNOW_STOP_TRANSITIONS, scoped.stop.status, nextStatus)) return res.status(409).json({ ok: false, error: `Stop cannot be marked ${nextStatus.replace('_', ' ')} from its current state.` });
        if (action === 'start-service') { if (!canTransitionSnowState(SNOW_STOP_TRANSITIONS, scoped.stop.status, 'servicing') || !scoped.occurrence || !canTransitionSnowState(SNOW_OCCURRENCE_TRANSITIONS, scoped.occurrence.status, 'active') || !scoped.occurrence.beforePhotoFileIds.length) return res.status(409).json({ ok: false, error: 'A valid Before Service photo is required before starting service.' }); }
        if (action === 'finish-service') { if (!scoped.occurrence || !canTransitionSnowState(SNOW_OCCURRENCE_TRANSITIONS, scoped.occurrence.status, 'awaiting_after_evidence')) return res.status(409).json({ ok: false, error: 'Only active service can be finished.' }); }
        if (action === 'complete-service') { if (!canTransitionSnowState(SNOW_STOP_TRANSITIONS, scoped.stop.status, 'completed') || !scoped.occurrence || !canTransitionSnowState(SNOW_OCCURRENCE_TRANSITIONS, scoped.occurrence.status, 'completed') || !scoped.occurrence.afterPhotoFileIds.length) return res.status(409).json({ ok: false, error: 'A valid After Service photo is required before completion.' }); }
        if (['skip-stop', 'flag-stop'].includes(action) && !canTransitionSnowState(SNOW_STOP_TRANSITIONS, scoped.stop.status, nextStatus)) return res.status(409).json({ ok: false, error: 'Stop cannot transition to that status.' });
        const evidence = { id: deps.randomUUID(), snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: scoped.stop.id, ...(scoped.occurrence ? { occurrenceId: scoped.occurrence.id, serviceTypeId: scoped.occurrence.serviceTypeId } : {}), serviceVisitId: scoped.stop.serviceVisitId, employeeId, eventType: gps.status === 'unavailable' ? 'GPS_UNAVAILABLE' : eventType, gps, deviceCapturedAt, serverRecordedAt: now };
        let occurrence = scoped.occurrence;
        if (occurrence && action === 'start-service') occurrence = { ...occurrence, status: 'active', startedAt: now, revision: occurrence.revision + 1, updatedAt: now };
        if (occurrence && action === 'finish-service') occurrence = { ...occurrence, status: 'awaiting_after_evidence', finishRequestedAt: now, revision: occurrence.revision + 1, updatedAt: now };
        if (occurrence && action === 'complete-service') occurrence = { ...occurrence, status: 'completed', completedAt: now, revision: occurrence.revision + 1, updatedAt: now };
        const stopStatus = action === 'finish-service' ? 'servicing' : nextStatus;
        const stop = { ...scoped.stop, status: stopStatus, ...(action === 'arrival' ? { arrivedAt: now } : {}), ...(action === 'start-service' ? { serviceStartedAt: now } : {}), ...(action === 'complete-service' ? { completedAt: now } : {}), ...(action === 'skip-stop' ? { skippedAt: now } : {}), ...(action === 'flag-stop' ? { manualAttentionReason: clean(body.reason, 240) || 'Manually flagged' } : {}), revision: scoped.stop.revision + 1, updatedAt: now, lastUpdatedAt: now };
        const response = { stop, occurrence, nextStop: action === 'complete-service' ? nextSnowStop(await deps.listSnowStopsForRoute(session.businessId, scoped.event.id, scoped.route.id), scoped.stop.id) : undefined };
        const writes = [{ kind: 'stop', record: stop, expectedRevision: scoped.stop.revision }, { kind: 'evidence', record: evidence, createOnly: true }];
        if (occurrence && occurrence !== scoped.occurrence) writes.unshift({ kind: 'occurrence', record: occurrence, expectedRevision: scoped.occurrence.revision });
        const claim = await commitCommand(deps, session, body, action, response, writes, now); if (claim.error) return res.status(claim.error[0]).json({ ok: false, error: claim.error[1] }); if (claim.replay) return res.status(200).json({ ok: true, replayed: true, ...claim.replay });
        await audit(deps, session, `snow_${action.replace(/-/g, '_')}`, { snowEventId: scoped.event.id, snowRouteId: scoped.route.id, routeStopId: scoped.stop.id, occurrenceId: occurrence?.id }, now);
        return res.status(200).json({ ok: true, ...response, evidence });
      }
      if (req.method === 'GET' && action === 'proof') {
        const scoped = await context(deps, session, req.query); if (scoped.error) return res.status(scoped.error[0]).json({ ok: false, error: scoped.error[1] }); if (!isAssigned(session, scoped.route) && !ADMIN_ROLES.includes(session.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const [occurrences, evidence, breadcrumbBatches] = await Promise.all([deps.listSnowOccurrencesForStop(session.businessId, scoped.event.id, scoped.route.id, scoped.stop.id), deps.listSnowEvidenceForStop(session.businessId, scoped.event.id, scoped.route.id, scoped.stop.id), deps.listSnowBreadcrumbsForStop(session.businessId, scoped.event.id, scoped.route.id, scoped.stop.id)]);
        const attention = deriveSnowStopAttention({ stop: scoped.stop, occurrences, evidence });
        return res.status(200).json({ ok: true, event: scoped.event, route: scoped.route, stop: scoped.stop, occurrences, evidence, breadcrumbBatches, attention });
      }
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    } catch (error) {
      console.error('[snow-operations]', error);
      return res.status(500).json({ ok: false, error: 'Snow Operations request failed.' });
    }
  };
}

export default createSnowOperationsHandler();
