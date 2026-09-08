import test from 'node:test';
import assert from 'node:assert/strict';

import { createSnowOperationsHandler } from '../api/snow-operations.js';

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function harness(options = {}) {
  const state = {
    events: [{ id: 'event-a', title: 'December storm', startAt: '2027-12-01T22:00:00.000Z', status: 'active', revision: 1 }],
    routes: [{ id: 'route-a', snowEventId: 'event-a', name: 'North', assignedForemanId: 'foreman-a', assignedCrewEmployeeIds: ['employee-a'], assignedEmployeeIds: ['foreman-a', 'employee-a'], assignedEquipmentIds: ['truck-a'], status: 'active', revision: 1 }],
    stops: [{ id: 'stop-a', snowEventId: 'event-a', snowRouteId: 'route-a', serviceJobId: 'job-a', customerId: 'customer-a', address: '1 Main St', sortOrder: 0, status: 'pending', revision: 1 }],
    occurrences: [], evidence: [], breadcrumbs: [], claims: new Map(), audits: [],
  };
  let sequence = 0;
  const clone = (value) => structuredClone(value);
  const find = (items, id) => clone(items.find((item) => item.id === id) ?? null);
  const replace = (items, record) => { const index = items.findIndex((item) => item.id === record.id); if (index >= 0) items[index] = clone(record); else items.push(clone(record)); };
  const session = options.session ?? { businessId: 'biz-a', id: 'user-a', employeeId: 'employee-a', role: 'crew_member', name: 'A User', email: 'a@example.com' };
  const deps = {
    requireSession: async () => session,
    now: () => new Date('2027-12-02T01:00:00.000Z'),
    randomUUID: () => `generated-${++sequence}`,
    createAuditEventForBusiness: async ({ auditEvent }) => state.audits.push(clone(auditEvent)),
    getSnowEventForBusiness: async (businessId, id) => businessId === 'biz-a' ? find(state.events, id) : null,
    getSnowRouteForBusiness: async (businessId, eventId, id) => businessId === 'biz-a' ? clone(state.routes.find((item) => item.id === id && item.snowEventId === eventId) ?? null) : null,
    getSnowStopForBusiness: async (businessId, eventId, routeId, id) => businessId === 'biz-a' ? clone(state.stops.find((item) => item.id === id && item.snowEventId === eventId && item.snowRouteId === routeId) ?? null) : null,
    getSnowOccurrenceForBusiness: async (businessId, eventId, routeId, stopId, id) => businessId === 'biz-a' ? clone(state.occurrences.find((item) => item.id === id && item.snowEventId === eventId && item.snowRouteId === routeId && item.routeStopId === stopId) ?? null) : null,
    listSnowEventsForBusiness: async () => clone(state.events),
    listSnowRoutesForEvent: async (_businessId, eventId) => clone(state.routes.filter((item) => item.snowEventId === eventId)),
    listSnowStopsForRoute: async (_businessId, eventId, routeId) => clone(state.stops.filter((item) => item.snowEventId === eventId && item.snowRouteId === routeId)),
    listSnowOccurrencesForStop: async (_businessId, eventId, routeId, stopId) => clone(state.occurrences.filter((item) => item.snowEventId === eventId && item.snowRouteId === routeId && item.routeStopId === stopId)),
    listSnowOccurrencesForRoute: async () => clone(state.occurrences),
    listSnowEvidenceForStop: async (_businessId, eventId, routeId, stopId) => clone(state.evidence.filter((item) => item.snowEventId === eventId && item.snowRouteId === routeId && item.routeStopId === stopId)),
    listSnowBreadcrumbsForStop: async (_businessId, eventId, routeId, stopId) => clone(state.breadcrumbs.filter((item) => item.snowEventId === eventId && item.snowRouteId === routeId && item.routeStopId === stopId)),
    listSnowServiceTypesForBusiness: async () => [{ id: 'plowing', name: 'Plowing', active: true, sortOrder: 0 }],
    getEmployeeForBusiness: async (businessId, id) => businessId === 'biz-a' && id === 'foreman-a' ? { id, role: 'foreman', active: true } : businessId === 'biz-a' && id === 'employee-a' ? { id, role: 'crew_member', active: true } : null,
    getEquipmentAssetForBusiness: async (businessId, id) => businessId === 'biz-a' && id === 'truck-a' ? { id } : null,
    getJobForBusiness: async (businessId, id) => businessId === 'biz-a' && id === 'job-a' ? { id, workType: 'service', customerId: 'customer-a', title: 'Main lot', propertyAddressSnapshot: '1 Main St' } : null,
    getCustomerForBusiness: async (businessId, id) => businessId === 'biz-a' && id === 'customer-a' ? { id, name: 'Customer A' } : null,
    getServiceVisitForBusiness: async () => null,
    getFileForBusiness: async (businessId, id) => {
      const occurrenceId = state.occurrences[0]?.id;
      if (businessId !== 'biz-a' || !occurrenceId) return null;
      if (id === 'before-file') return { id, entityType: 'snow-occurrence', entityId: occurrenceId, category: 'before-photo', uploadStatus: 'uploaded' };
      if (id === 'after-file') return { id, entityType: 'snow-occurrence', entityId: occurrenceId, category: 'after-photo', uploadStatus: 'uploaded' };
      return null;
    },
    commitSnowIdempotentMutation: async ({ key, action, response: commandResponse, writes }) => {
      const existing = state.claims.get(key);
      if (existing) return existing.action === action ? { ok: true, replay: clone(existing.response) } : { ok: false, keyConflict: true };
      for (const write of writes) {
        const collections = { route: state.routes, stop: state.stops, occurrence: state.occurrences, evidence: state.evidence, breadcrumb: state.breadcrumbs };
        const collection = collections[write.kind];
        const current = collection.find((item) => item.id === write.record.id);
        if (write.createOnly && current) return { ok: false, conflict: true };
        if (write.expectedRevision !== undefined && current?.revision !== write.expectedRevision) return { ok: false, conflict: true };
      }
      for (const write of writes) {
        const collections = { route: state.routes, stop: state.stops, occurrence: state.occurrences, evidence: state.evidence, breadcrumb: state.breadcrumbs };
        replace(collections[write.kind], write.record);
      }
      state.claims.set(key, { action, response: clone(commandResponse) });
      return { ok: true, response: clone(commandResponse) };
    },
    putSnowEventForBusiness: async () => ({ ok: true }), putSnowRouteForBusiness: async () => ({ ok: true }),
    putSnowStopForBusiness: async () => ({ ok: true }), putSnowOccurrenceForBusiness: async () => ({ ok: true }),
    putSnowEvidenceForBusiness: async () => ({ ok: true }), putSnowBreadcrumbBatchForBusiness: async () => ({ ok: true }),
    putSnowServiceTypeForBusiness: async () => ({ ok: true }), deleteSnowStopForBusiness: async () => ({ ok: true }),
  };
  const handler = createSnowOperationsHandler({ ...deps, ...options.overrides });
  async function call(method, action, body = {}, query = {}) {
    const res = response();
    await handler({ method, query: { action, ...query }, body }, res);
    return res;
  }
  return { state, call };
}

const scope = { eventId: 'event-a', routeId: 'route-a', stopId: 'stop-a' };
const command = (clientSubmissionId, extra = {}) => ({ clientSubmissionId, deviceCapturedAt: '2027-12-02T00:59:00.000Z', gps: { latitude: 45.4, longitude: -75.7, accuracyMeters: 12 }, ...extra });

test('unassigned employees cannot access or mutate a Snow Route', async () => {
  const run = harness({ session: { businessId: 'biz-a', id: 'user-b', employeeId: 'employee-b', role: 'crew_member' } });
  assert.equal((await run.call('GET', 'detail', {}, { eventId: 'event-a' })).statusCode, 403);
  assert.equal((await run.call('POST', 'en-route', command('en-route-unauthorized'), scope)).statusCode, 403);
});

test('route creation validates Foreman, Crew, and Equipment tenant ownership', async () => {
  const run = harness({ session: { businessId: 'biz-a', id: 'admin-a', role: 'admin' } });
  const invalidForeman = await run.call('POST', 'route', { assignedForemanId: 'employee-a', assignedCrewEmployeeIds: [], assignedEquipmentIds: [] }, { eventId: 'event-a' });
  assert.equal(invalidForeman.statusCode, 400);
  const invalidEquipment = await run.call('POST', 'route', { assignedForemanId: 'foreman-a', assignedCrewEmployeeIds: ['employee-a'], assignedEquipmentIds: ['foreign-truck'] }, { eventId: 'event-a' });
  assert.equal(invalidEquipment.statusCode, 400);
});

test('same Service Job can appear more than once as distinct Route Stops', async () => {
  const run = harness({ session: { businessId: 'biz-a', id: 'admin-a', role: 'admin' } });
  run.state.stops.length = 0;
  const first = await run.call('POST', 'stop', { serviceJobId: 'job-a' }, { eventId: 'event-a', routeId: 'route-a' });
  const second = await run.call('POST', 'stop', { serviceJobId: 'job-a' }, { eventId: 'event-a', routeId: 'route-a' });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.notEqual(first.body.stop.id, second.body.stop.id);
});

test('field workflow enforces order, photo gates, breadcrumbs, completion, and proof', async () => {
  const run = harness();
  assert.equal((await run.call('POST', 'arrival', command('arrival-too-early'), scope)).statusCode, 409);
  assert.equal((await run.call('POST', 'en-route', command('en-route-1'), scope)).body.stop.status, 'en_route');
  assert.equal((await run.call('POST', 'arrival', command('arrival-1'), scope)).body.stop.status, 'arrived');
  const selected = await run.call('POST', 'select-service', command('select-service-1', { serviceTypeId: 'plowing' }), scope);
  const occurrenceId = selected.body.occurrence.id;
  const occurrenceScope = { ...scope, occurrenceId };
  assert.equal((await run.call('POST', 'start-service', command('start-too-early'), occurrenceScope)).statusCode, 409);
  assert.equal((await run.call('POST', 'before-photo', command('before-photo-1', { fileId: 'before-file' }), occurrenceScope)).statusCode, 200);
  assert.equal((await run.call('POST', 'start-service', command('start-service-1'), occurrenceScope)).body.occurrence.status, 'active');
  const breadcrumbs = await run.call('POST', 'breadcrumbs', command('breadcrumbs-1', { points: [{ sequence: 1, latitude: 45.4, longitude: -75.7, accuracyMeters: 12, deviceCapturedAt: '2027-12-02T00:59:30.000Z' }] }), occurrenceScope);
  assert.equal(breadcrumbs.statusCode, 201);
  assert.equal((await run.call('POST', 'finish-service', command('finish-service-1'), occurrenceScope)).body.occurrence.status, 'awaiting_after_evidence');
  assert.equal((await run.call('POST', 'complete-service', command('complete-too-early'), occurrenceScope)).statusCode, 409);
  assert.equal((await run.call('POST', 'after-photo', command('after-photo-1', { fileId: 'after-file' }), occurrenceScope)).statusCode, 200);
  assert.equal((await run.call('POST', 'complete-service', command('complete-service-1'), occurrenceScope)).body.stop.status, 'completed');
  const proof = await run.call('GET', 'proof', {}, scope);
  assert.equal(proof.statusCode, 200);
  assert.equal(proof.body.occurrences.length, 1);
  assert.equal(proof.body.breadcrumbBatches.length, 1);
});

test('idempotent commands replay without duplicate writes or audit records', async () => {
  const run = harness();
  const first = await run.call('POST', 'en-route', command('same-command-1'), scope);
  const replay = await run.call('POST', 'en-route', command('same-command-1'), scope);
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(run.state.evidence.length, 1);
  assert.equal(run.state.audits.filter((item) => item.action === 'snow_en_route').length, 1);
});

test('GPS denial is retained as explicit unavailable evidence', async () => {
  const run = harness();
  const result = await run.call('POST', 'en-route', { clientSubmissionId: 'gps-denied-1', gpsUnavailableReason: 'permission_denied', deviceCapturedAt: '2027-12-02T00:59:00.000Z' }, scope);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.evidence.eventType, 'GPS_UNAVAILABLE');
  assert.deepEqual(result.body.evidence.gps, { status: 'unavailable', unavailableReason: 'permission_denied' });
});
