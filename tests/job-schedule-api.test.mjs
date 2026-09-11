import test from 'node:test';
import assert from 'node:assert/strict';

import { createJobScheduleHandler } from '../api/job-schedule.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createHarness(overrides = {}) {
  let persisted = {
    id: 'job-converted',
    customerId: 'customer-a',
    sourceEstimateId: 'estimate-a',
    pricingBudgetId: 'budget-a',
    divisionId: 'budget-division-a',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    scheduledStartAt: '2026-09-01T07:00:00',
    scheduledEndAt: '2026-09-03T16:00:00',
    scheduleAllDay: false,
    includeWeekends: true,
    scheduleConfirmed: true,
    scheduleNotes: 'Original notes',
    crewId: null,
    assignedEmployeeIds: [],
    assignedEquipmentIds: [],
    operationalWorkAreas: [{ id: 'area-a', name: 'Install', lineItems: [] }],
    originalEstimateSnapshot: { estimateId: 'estimate-a', subtotal: 5000 },
    contractValue: 5000,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides.job,
  };
  let writes = 0;
  const localCrews = new Map([['crew-a', { id: 'crew-a', active: true }], ['crew-inactive', { id: 'crew-inactive', active: false }]]);
  const localDivisions = new Map([['division-a', { id: 'division-a', active: true }]]);
  const localEmployees = new Map([['foreman-a', { id: 'foreman-a', role: 'foreman', active: true }], ['emp-a', { id: 'emp-a', role: 'crew_member', active: true }], ['emp-b', { id: 'emp-b', role: 'crew_member', active: true }], ['emp-inactive', { id: 'emp-inactive', role: 'crew_member', active: false }], ['foreman-inactive', { id: 'foreman-inactive', role: 'foreman', active: false }]]);
  const localEquipment = new Map([['equipment-a', { id: 'equipment-a' }], ['equipment-b', { id: 'equipment-b' }]]);
  const handler = createJobScheduleHandler({
    requireSession: async () => ({ businessId: 'biz-a', id: 'user-a', role: 'admin' }),
    getJobForBusiness: async () => structuredClone(persisted),
    updateJobForBusiness: async ({ job }) => { writes += 1; persisted = structuredClone(job); return { ok: true }; },
    getCrewForBusiness: async (_businessId, id) => localCrews.get(id) ?? null,
    getDivisionForBusiness: async (_businessId, id) => localDivisions.get(id) ?? null,
    getEmployeeForBusiness: async (_businessId, id) => localEmployees.get(id) ?? null,
    getEquipmentAssetForBusiness: async (_businessId, id) => localEquipment.get(id) ?? null,
    syncJobToExternalCalendars: async () => {},
    ...overrides.deps,
  });

  return {
    get persisted() { return structuredClone(persisted); },
    get writes() { return writes; },
    async patch(body) {
      const response = createResponse();
      await handler({ method: 'PATCH', query: { jobId: persisted.id }, body }, response);
      return response;
    },
  };
}

test('converted Job schedule assigns crew, employees, and equipment without changing planning fields', async () => {
  const harness = createHarness();
  const response = await harness.patch({
    startDate: '2026-09-02',
    endDate: '2026-09-04',
    scheduledStartAt: '2026-09-02T08:00:00',
    scheduledEndAt: '2026-09-04T15:30:00',
    scheduleAllDay: false,
    includeWeekends: false,
    scheduleConfirmed: true,
    scheduleNotes: 'Use the east gate',
    crewId: 'crew-a',
    assignedEmployeeIds: ['emp-a', 'emp-b'],
    assignedEquipmentIds: ['equipment-a'],
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(harness.persisted.crewId, 'crew-a');
  assert.deepEqual(harness.persisted.assignedEmployeeIds, ['emp-a', 'emp-b']);
  assert.deepEqual(harness.persisted.assignedEquipmentIds, ['equipment-a']);
  assert.equal(harness.persisted.divisionId, 'budget-division-a');
  assert.deepEqual(harness.persisted.operationalWorkAreas, [{ id: 'area-a', name: 'Install', lineItems: [] }]);
  assert.deepEqual(harness.persisted.originalEstimateSnapshot, { estimateId: 'estimate-a', subtotal: 5000 });
  assert.equal(harness.persisted.contractValue, 5000);
  assert.equal(harness.persisted.startDate, '2026-09-02');
  assert.equal(harness.persisted.endDate, '2026-09-04');
  assert.equal(harness.persisted.scheduledStartAt, '2026-09-02T08:00:00');
  assert.equal(harness.persisted.scheduledEndAt, '2026-09-04T15:30:00');
  assert.equal(harness.persisted.includeWeekends, false);
  assert.equal(harness.writes, 1);
});

test('canonical Foreman and Crew assignments persist with a deduplicated legacy union', async () => {
  const harness = createHarness();
  const response = await harness.patch({ assignedForemanId: 'foreman-a', assignedCrewEmployeeIds: ['emp-a', 'emp-b'] });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.persisted.assignedForemanId, 'foreman-a');
  assert.deepEqual(harness.persisted.assignedCrewEmployeeIds, ['emp-a', 'emp-b']);
  assert.deepEqual(harness.persisted.assignedEmployeeIds, ['foreman-a', 'emp-a', 'emp-b']);
});

test('partial Crew assignment PATCH retains the Foreman in canonical assigned employees', async () => {
  const harness = createHarness({
    job: {
      assignedForemanId: 'foreman-a',
      assignedCrewEmployeeIds: ['emp-a'],
      assignedEmployeeIds: ['foreman-a', 'emp-a'],
    },
  });
  const response = await harness.patch({ assignedCrewEmployeeIds: ['emp-b'] });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.persisted.assignedForemanId, 'foreman-a');
  assert.deepEqual(harness.persisted.assignedCrewEmployeeIds, ['emp-b']);
  assert.deepEqual(harness.persisted.assignedEmployeeIds, ['foreman-a', 'emp-b']);
});

test('partial assignment PATCH validates Foreman and Crew roles against persisted fields', async () => {
  const crewPatch = createHarness({ job: { assignedForemanId: 'foreman-a', assignedCrewEmployeeIds: ['emp-a'] } });
  const duplicateCrew = await crewPatch.patch({ assignedCrewEmployeeIds: ['foreman-a'] });
  assert.equal(duplicateCrew.statusCode, 400);
  assert.equal(duplicateCrew.body.error, 'Assigned Foreman cannot also be in Assigned Crew.');

  const foremanPatch = createHarness({ job: { assignedForemanId: null, assignedCrewEmployeeIds: ['foreman-a'] } });
  const duplicateForeman = await foremanPatch.patch({ assignedForemanId: 'foreman-a' });
  assert.equal(duplicateForeman.statusCode, 400);
  assert.equal(duplicateForeman.body.error, 'Assigned Foreman cannot also be in Assigned Crew.');
});

test('unrelated schedule PATCH preserves canonical assignments unchanged', async () => {
  const harness = createHarness({
    job: {
      assignedForemanId: 'foreman-a',
      assignedCrewEmployeeIds: ['emp-a'],
      assignedEmployeeIds: ['foreman-a', 'emp-a'],
    },
  });
  const response = await harness.patch({ scheduleNotes: 'Updated notes' });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.persisted.assignedForemanId, 'foreman-a');
  assert.deepEqual(harness.persisted.assignedCrewEmployeeIds, ['emp-a']);
  assert.deepEqual(harness.persisted.assignedEmployeeIds, ['foreman-a', 'emp-a']);
});

test('canonical assignment rejects non-Foremen, inactive Foremen, foreign employees, and duplicate roles', async () => {
  const cases = [
    [{ assignedForemanId: 'emp-a' }, 'Assigned Foreman must have the Foreman role.'],
    [{ assignedForemanId: 'foreman-inactive' }, 'Assigned Foreman must be active.'],
    [{ assignedForemanId: 'foreman-foreign' }, 'Assigned Foreman must belong to this business.'],
    [{ assignedCrewEmployeeIds: ['emp-foreign'] }, 'Assigned Crew employees must belong to this business.'],
    [{ assignedForemanId: 'foreman-a', assignedCrewEmployeeIds: ['foreman-a'] }, 'Assigned Foreman cannot also be in Assigned Crew.'],
  ];
  for (const [patch, error] of cases) {
    const harness = createHarness();
    const response = await harness.patch(patch);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, error);
    assert.equal(harness.writes, 0);
  }
});

test('adding a Foreman to a legacy schedule retains existing employee assignments', async () => {
  const harness = createHarness({ job: { assignedEmployeeIds: ['emp-a'] } });
  const response = await harness.patch({ assignedForemanId: 'foreman-a' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(harness.persisted.assignedEmployeeIds, ['foreman-a', 'emp-a']);
});

test('legacy schedules include weekends and explicit weekday schedules persist', async () => {
  const legacy = createHarness({ job: { includeWeekends: undefined } });
  assert.notEqual(legacy.persisted.includeWeekends, false);
  const response = await legacy.patch({ includeWeekends: false, startDate: '2026-09-04', endDate: '2026-09-07' });
  assert.equal(response.statusCode, 200);
  assert.equal(legacy.persisted.includeWeekends, false);
});

test('weekend-only ranges are rejected when weekends are excluded', async () => {
  const harness = createHarness();
  const response = await harness.patch({ startDate: '2026-09-05', endDate: '2026-09-06', includeWeekends: false });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'This schedule does not contain any working days.');
  assert.equal(harness.writes, 0);
});

test('includeWeekends must be a boolean', async () => {
  const harness = createHarness();
  const response = await harness.patch({ includeWeekends: 'false' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Job include-weekends flag is invalid.');
  assert.equal(harness.writes, 0);
});

test('converted Job can assign a primary crew without a division mutation', async () => {
  const harness = createHarness();
  const response = await harness.patch({ crewId: 'crew-a' });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.persisted.crewId, 'crew-a');
  assert.equal(harness.persisted.divisionId, 'budget-division-a');
});

test('converted Job can assign equipment without a division mutation', async () => {
  const harness = createHarness();
  const response = await harness.patch({ assignedEquipmentIds: ['equipment-a', 'equipment-b'] });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(harness.persisted.assignedEquipmentIds, ['equipment-a', 'equipment-b']);
  assert.equal(harness.persisted.divisionId, 'budget-division-a');
});

test('converted Job schedule can add one employee, remove employees, and persists after reload', async () => {
  const harness = createHarness();
  assert.equal((await harness.patch({ assignedEmployeeIds: ['emp-a'] })).statusCode, 200);
  assert.deepEqual(harness.persisted.assignedEmployeeIds, ['emp-a']);
  assert.equal((await harness.patch({ assignedEmployeeIds: [] })).statusCode, 200);
  assert.deepEqual(harness.persisted.assignedEmployeeIds, []);
  assert.equal(harness.persisted.divisionId, 'budget-division-a');
});

test('converted Job rejects every explicit division mutation without writing', async () => {
  for (const divisionId of [null, 'budget-division-a', 'division-foreign']) {
    const harness = createHarness();
    const response = await harness.patch({ assignedEmployeeIds: ['emp-a'], divisionId });
    assert.equal(response.statusCode, 409);
    assert.match(response.body.error, /divisionId must be changed through the Job planning workflow/);
    assert.equal(harness.writes, 0);
    assert.deepEqual(harness.persisted.assignedEmployeeIds, []);
    assert.equal(harness.persisted.divisionId, 'budget-division-a');
  }
});

test('manual Job can set and clear an operational Schedule division', async () => {
  const harness = createHarness({ job: { id: 'job-manual', sourceEstimateId: undefined, pricingBudgetId: undefined, divisionId: null } });
  const assign = await harness.patch({ divisionId: 'division-a', crewId: 'crew-a' });
  assert.equal(assign.statusCode, 200);
  assert.equal(harness.persisted.divisionId, 'division-a');
  const clear = await harness.patch({ divisionId: null });
  assert.equal(clear.statusCode, 200);
  assert.equal(harness.persisted.divisionId, null);
});

test('manual Job rejects a foreign division without changing crew or division', async () => {
  const harness = createHarness({ job: { id: 'job-manual', sourceEstimateId: undefined, divisionId: 'division-a' } });
  const response = await harness.patch({ crewId: 'crew-a', divisionId: 'division-foreign' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Assigned division must belong to this business.');
  assert.equal(harness.writes, 0);
  assert.equal(harness.persisted.crewId, null);
  assert.equal(harness.persisted.divisionId, 'division-a');
});

test('cross-tenant crew, employee, and equipment assignments are rejected atomically', async () => {
  const cases = [
    [{ crewId: 'crew-foreign', assignedEmployeeIds: ['emp-a'] }, 'Assigned crew must belong to this business.'],
    [{ crewId: 'crew-a', assignedEmployeeIds: ['emp-foreign'] }, 'Assigned employees must belong to this business.'],
    [{ crewId: 'crew-a', assignedEmployeeIds: ['emp-a'], assignedEquipmentIds: ['equipment-foreign'] }, 'Assigned equipment must belong to this business.'],
  ];
  for (const [patch, error] of cases) {
    const harness = createHarness();
    const response = await harness.patch(patch);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, error);
    assert.equal(harness.writes, 0);
    assert.equal(harness.persisted.crewId, null);
    assert.deepEqual(harness.persisted.assignedEmployeeIds, []);
    assert.deepEqual(harness.persisted.assignedEquipmentIds, []);
  }
});

test('inactive assignments are retained but cannot be newly added', async () => {
  const retained = createHarness({ job: { assignedEmployeeIds: ['emp-inactive'], crewId: 'crew-inactive' } });
  assert.equal((await retained.patch({ assignedEmployeeIds: ['emp-inactive'], crewId: 'crew-inactive', scheduleNotes: 'Still assigned' })).statusCode, 200);

  const added = createHarness();
  const employeeResponse = await added.patch({ assignedEmployeeIds: ['emp-inactive'] });
  assert.equal(employeeResponse.statusCode, 400);
  assert.equal(employeeResponse.body.error, 'Assigned employees must be active.');
  assert.equal(added.writes, 0);
  const crewResponse = await added.patch({ crewId: 'crew-inactive' });
  assert.equal(crewResponse.statusCode, 400);
  assert.equal(crewResponse.body.error, 'Assigned crew must be active.');
  assert.equal(added.writes, 0);
});

test('duplicate assignments and non-schedule fields are rejected before persistence', async () => {
  const harness = createHarness();
  const duplicate = await harness.patch({ assignedEmployeeIds: ['emp-a', 'emp-a'] });
  assert.equal(duplicate.statusCode, 400);
  assert.equal(duplicate.body.error, 'Assigned employees must be unique.');
  const protectedField = await harness.patch({ contractValue: 1 });
  assert.equal(protectedField.statusCode, 400);
  assert.equal(protectedField.body.error, 'contractValue cannot be changed through Schedule.');
  assert.equal(harness.writes, 0);
  assert.equal(harness.persisted.contractValue, 5000);
});
