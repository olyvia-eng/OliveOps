import test from 'node:test';
import assert from 'node:assert/strict';

import { createServiceVisitsHandler } from '../api/service-visits.js';

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function harness(overrides = {}) {
  const service = {
    id: 'service-a', sourceEstimateServiceId: 'service-a', name: 'Weekly mowing', scheduleType: 'recurring', billingType: 'per_visit',
    startDate: '2027-04-05', endDate: '2027-04-19', frequency: { interval: 1, unit: 'week' }, status: 'active', lineItems: [],
    operationalSchedule: { startDate: '2027-04-05', endDate: '2027-04-19', preferredWeekdays: [1], startTime: '08:00', durationMinutes: 90, defaultEmployeeIds: [], defaultEquipmentIds: [], revision: 1 },
  };
  let job = { id: 'job-a', workType: 'service', services: [service] };
  let visits = [];
  const audits = [];
  const deps = {
    requireSession: async () => ({ businessId: 'biz-a', id: 'user-a', name: 'A User', email: 'a@example.com' }),
    getJobForBusiness: async (_businessId, id) => id === job.id ? structuredClone(job) : null,
    updateOperationalServiceForBusiness: async ({ serviceIndex, service: nextService, expectedRevision }) => {
      if (job.services[serviceIndex].operationalSchedule.revision !== expectedRevision) return { ok: false, conflict: true };
      job.services[serviceIndex] = structuredClone(nextService); return { ok: true };
    },
    getBusinessProfile: async () => ({ timezone: 'America/Toronto' }),
    getCrewForBusiness: async (_businessId, id) => id === 'crew-a' ? { id, active: true } : null,
    getEmployeeForBusiness: async (_businessId, id) => id === 'employee-a' ? { id, active: true } : null,
    getEquipmentAssetForBusiness: async (_businessId, id) => id === 'equipment-a' ? { id } : null,
    listServiceVisitsForJob: async () => structuredClone(visits),
    listServiceVisitsForSchedule: async (_businessId, startDate, endDate) => visits.filter((visit) => visit.scheduledDate >= startDate && visit.scheduledDate <= endDate),
    getServiceVisitForBusiness: async (_businessId, _jobId, id) => structuredClone(visits.find((visit) => visit.id === id) ?? null),
    createServiceVisitForBusiness: async ({ visit }) => { visits.push(structuredClone(visit)); return { ok: true, created: true, visit }; },
    createGeneratedServiceVisitsForBusiness: async ({ visits: generated }) => {
      const created = generated.filter((candidate) => !visits.some((visit) => visit.id === candidate.id));
      const existing = generated.filter((candidate) => visits.some((visit) => visit.id === candidate.id));
      visits.push(...structuredClone(created)); return { created, existing };
    },
    updateServiceVisitForBusiness: async ({ visit, expectedRevision }) => {
      const index = visits.findIndex((item) => item.id === visit.id && item.revision === expectedRevision);
      if (index < 0) return { ok: false, conflict: true };
      visits[index] = structuredClone(visit); return { ok: true, visit };
    },
    createAuditEventForBusiness: async ({ auditEvent }) => { audits.push(auditEvent); },
    randomUUID: () => `id-${visits.length + audits.length + 1}`,
    now: () => new Date('2027-04-01T14:00:00.000Z'),
    ...overrides,
  };
  const handler = createServiceVisitsHandler(deps);
  async function call(method, action, body = {}, query = {}) {
    const res = response(); await handler({ method, query: { action, ...query }, body }, res); return res;
  }
  return { call, service, audits, get visits() { return structuredClone(visits); }, set visits(value) { visits = structuredClone(value); } };
}

test('schedule query requires and forwards a bounded date range', async () => {
  let received;
  const run = harness({ listServiceVisitsForSchedule: async (...args) => { received = args; return []; } });
  assert.equal((await run.call('GET', 'schedule', {}, { startDate: 'bad', endDate: '2027-04-30' })).statusCode, 400);
  const result = await run.call('GET', 'schedule', {}, { startDate: '2027-04-01', endDate: '2027-04-30' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(received, ['biz-a', '2027-04-01', '2027-04-30']);
});

test('Job-scoped operations reject a Job outside the tenant', async () => {
  const run = harness();
  const result = await run.call('GET', '', {}, { jobId: 'job-foreign' });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error, 'Service Job not found.');
});

test('generated Visits are deterministic and replay-safe', async () => {
  const run = harness();
  const first = await run.call('POST', 'generate', { jobId: 'job-a', serviceId: 'service-a' });
  const second = await run.call('POST', 'generate', { jobId: 'job-a', serviceId: 'service-a' });
  assert.equal(first.body.createdCount, 3);
  assert.equal(second.body.createdCount, 0);
  assert.equal(run.visits.length, 3);
  assert.deepEqual(run.visits.map((visit) => visit.scheduledDate), ['2027-04-05', '2027-04-12', '2027-04-19']);
});

test('manual Visit rejects cross-tenant assignments before persistence', async () => {
  const run = harness();
  const result = await run.call('POST', 'manual', { jobId: 'job-a', serviceId: 'service-a', scheduledDate: '2027-04-08', assignedEmployeeIds: ['employee-foreign'] });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'Assigned employees must be active and belong to this business.');
  assert.equal(run.visits.length, 0);
});

test('Visit updates reject stale revisions', async () => {
  const run = harness();
  await run.call('POST', 'generate', { jobId: 'job-a', serviceId: 'service-a' });
  const visit = run.visits[0];
  const result = await run.call('PATCH', 'status', { jobId: 'job-a', serviceId: 'service-a', visitId: visit.id, revision: 0, status: 'completed' });
  assert.equal(result.statusCode, 409);
  assert.equal(run.visits[0].status, 'scheduled');
});

test('rescheduling a recurring Visit keeps its recurrence identity and marks an exception', async () => {
  const run = harness();
  await run.call('POST', 'generate', { jobId: 'job-a', serviceId: 'service-a' });
  const visit = run.visits[0];
  const result = await run.call('PATCH', 'reschedule', { jobId: 'job-a', serviceId: 'service-a', visitId: visit.id, revision: 1, scheduledDate: '2027-04-06', startTime: '09:30', durationMinutes: 60 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.visit.scheduledDate, '2027-04-06');
  assert.equal(result.body.visit.originalRecurrenceDate, '2027-04-05');
  assert.equal(result.body.visit.isSeriesException, true);
  assert.match(result.body.visit.recurrenceKey, /2027-04-05$/);
});

test('operational Service updates surface concurrent schedule changes', async () => {
  const run = harness({ updateOperationalServiceForBusiness: async () => ({ ok: false, conflict: true }) });
  const result = await run.call('PATCH', 'service', { jobId: 'job-a', serviceId: 'service-a', operationalSchedule: { startTime: '07:30' } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error, 'Service schedule changed since it was opened.');
});

test('explicit completion blocks active linked Time Entries and replays safely after clock-out', async () => {
  let entries = [{ id: 'entry-a', serviceVisitId: 'visit-a', status: 'clocked_in' }];
  const run = harness({
    requireSession: async () => ({ businessId: 'biz-a', id: 'user-a', employeeId: 'employee-a', role: 'crew_member', name: 'A User' }),
    listTimeEntriesForBusiness: async () => structuredClone(entries),
    listFormSubmissionsForBusiness: async () => [],
    listFilesForBusiness: async () => [],
  });
  run.visits = [{ id: 'visit-a', jobId: 'job-a', serviceId: 'service-a', assignedEmployeeIds: ['employee-a'], status: 'in_progress', billingTypeSnapshot: 'per_visit', billingStatus: 'pending', revision: 2 }];
  const body = { jobId: 'job-a', serviceId: 'service-a', visitId: 'visit-a', clientSubmissionId: 'complete-1' };

  const blocked = await run.call('POST', 'complete', body);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.code, 'VISIT_HAS_ACTIVE_TIME_ENTRIES');

  entries = [{ ...entries[0], status: 'clocked_out' }];
  const completed = await run.call('POST', 'complete', body);
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.visit.status, 'completed');
  const replay = await run.call('POST', 'complete', body);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(run.audits.filter((event) => event.action === 'service_visit.completed').length, 1);
});

test('employee Visit detail and mutations fail closed when the Visit is not assigned', async () => {
  const run = harness({ requireSession: async () => ({ businessId: 'biz-a', id: 'user-b', employeeId: 'employee-b', role: 'crew_member' }) });
  run.visits = [{ id: 'visit-a', jobId: 'job-a', serviceId: 'service-a', assignedEmployeeIds: ['employee-a'], status: 'scheduled', revision: 1 }];

  const detail = await run.call('GET', 'detail', {}, { jobId: 'job-a', visitId: 'visit-a' });
  assert.equal(detail.statusCode, 403);
  assert.equal(detail.body.code, 'VISIT_NOT_ASSIGNED');
  const completion = await run.call('POST', 'complete', { jobId: 'job-a', serviceId: 'service-a', visitId: 'visit-a', clientSubmissionId: 'complete-1' });
  assert.equal(completion.statusCode, 403);
  assert.equal(completion.body.code, 'VISIT_NOT_ASSIGNED');
});