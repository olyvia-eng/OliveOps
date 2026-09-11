import test from 'node:test';
import assert from 'node:assert/strict';
import { createBootstrapHandler } from '../api/bootstrap.js';

const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; return this; },
  json(body) { this.body = body; return this; },
});

function coreData() {
  return {
    forms: [], formFields: [], formSubmissions: [], formResponses: [], budgets: [], budgetDivisions: [], budgetDivisionPlanningItems: [], budgetGroups: [], equipmentBudgetAllocations: [], crews: [], divisions: [],
    customers: [{ id: 'customer-a', name: 'Customer A' }],
    jobs: [{ id: 'job-a', title: 'Job A', workType: 'project', assignedEmployeeIds: [], operationalWorkAreas: [] }],
    estimates: [{ id: 'estimate-a', customerId: 'customer-a' }],
    invoices: [], expenses: [], equipmentAssets: [], unbillableTimeCategories: [], materialCatalogItems: [], subcontractorCatalogItems: [], labourClasses: [], templates: [], budgetItems: [], budgetRates: [], labourBudgetPlans: [], labourHoursSalesGoals: [], revenueSalesGoals: [],
    employees: [{ id: 'employee-a', name: 'Employee A', active: true }],
    tasks: [], jobTaskHeadings: [], timeEntries: [], timeCorrections: [], trainingAssignments: [], jobSopAssociations: [],
  };
}

function handler(overrides = {}) {
  return createBootstrapHandler({
    requireSession: async () => ({ id: 'user-a', businessId: 'biz-a', role: 'owner' }),
    getBusinessProfile: async () => ({ timezone: 'America/Toronto' }),
    getEmployeeForBusiness: async () => null,
    getActiveShiftForEmployee: async () => null,
    getPendingClockOutWorkflowForEmployee: async () => null,
    getPendingClockInWorkflowForEmployee: async () => null,
    loadCoreBootstrapData: async () => coreData(),
    listServiceVisitsForSchedule: async () => [],
    ...overrides,
  });
}

test('bootstrap succeeds with no Service Visits and preserves its response shape', async () => {
  const res = response();
  await handler()({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.serviceVisits, []);
  assert.equal(res.body.customers[0].id, 'customer-a');
  assert.equal(res.body.jobs[0].id, 'job-a');
  assert.equal(res.body.estimates[0].id, 'estimate-a');
  assert.equal(res.body.employees[0].id, 'employee-a');
});

test('mobile Project Jobs use canonical assignments and business-local schedule dates', async () => {
  const data = coreData();
  data.customers[0].address = '10 Customer Road';
  data.jobs = [
    { id: 'foreman-today', title: 'Foreman Today', jobNumber: 'J-100', customerId: 'customer-a', status: 'scheduled', startDate: '2026-09-10', endDate: '2026-09-10', assignedForemanId: 'employee-a', assignedCrewEmployeeIds: [], assignedEmployeeIds: [], operationalWorkAreas: [] },
    { id: 'crew-today', title: 'Crew Today', customerId: 'customer-a', status: 'scheduled', startDate: '2026-09-10', assignedForemanId: null, assignedCrewEmployeeIds: ['employee-a'], assignedEmployeeIds: [], operationalWorkAreas: [] },
    { id: 'yesterday', title: 'Yesterday', customerId: 'customer-a', status: 'in_progress', startDate: '2026-09-09', endDate: '2026-09-09', assignedCrewEmployeeIds: ['employee-a'], assignedEmployeeIds: [], propertyAddressSnapshot: '20 Job Lane', operationalWorkAreas: [] },
    { id: 'multi-day', title: 'Multi Day', customerId: 'customer-a', status: 'in_progress', startDate: '2026-09-08', endDate: '2026-09-11', assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
    { id: 'weekend-excluded', title: 'No Weekend', status: 'scheduled', startDate: '2026-09-10', endDate: '2026-09-14', includeWeekends: false, assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
    { id: 'unauthorized', title: 'Private Job', status: 'scheduled', startDate: '2026-09-10', assignedEmployeeIds: ['employee-b'], operationalWorkAreas: [] },
    { id: 'completed', title: 'Completed Job', status: 'completed', startDate: '2026-09-10', assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
    { id: 'cancelled', title: 'Cancelled Job', status: 'cancelled', startDate: '2026-09-10', assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
  ];
  let loadedBusinessId = '';
  const res = response();
  await handler({
    requireSession: async () => ({ id: 'user-a', businessId: 'biz-a', role: 'crew_member', employeeId: 'employee-a' }),
    getBusinessProfile: async () => ({ timezone: 'America/Los_Angeles' }),
    getEmployeeForBusiness: async () => data.employees[0],
    loadCoreBootstrapData: async (businessId) => { loadedBusinessId = businessId; return data; },
    now: () => new Date('2026-09-11T00:30:00.000Z'),
  })({ method: 'GET' }, res);

  assert.equal(loadedBusinessId, 'biz-a');
  assert.deepEqual(res.body.jobs.map((job) => job.id), ['foreman-today', 'crew-today', 'yesterday', 'multi-day', 'weekend-excluded']);
  assert.equal(res.body.jobs[0].scheduledToday, true);
  assert.deepEqual(res.body.jobs[0].assignedEmployeeIds, ['employee-a']);
  assert.equal(res.body.jobs[0].customerName, 'Customer A');
  assert.equal(res.body.jobs[0].propertyAddress, '10 Customer Road');
  assert.equal(res.body.jobs[1].scheduledToday, true);
  assert.deepEqual(res.body.jobs[1].assignedEmployeeIds, ['employee-a']);
  assert.equal(res.body.jobs[2].scheduledToday, false);
  assert.equal(res.body.jobs[2].propertyAddress, '20 Job Lane');
  assert.equal(res.body.jobs[3].scheduledToday, true);
  assert.equal(res.body.jobs[4].scheduledToday, true);
});

test('business timezone can exclude a UTC-next-day Project Job and excludes weekends', async () => {
  const data = coreData();
  data.jobs = [
    { id: 'utc-next-day', title: 'UTC Next Day', status: 'scheduled', startDate: '2026-09-11', assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
    { id: 'local-friday', title: 'Local Friday', status: 'scheduled', startDate: '2026-09-10', assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
    { id: 'weekend', title: 'Weekend', status: 'scheduled', startDate: '2026-09-12', endDate: '2026-09-13', includeWeekends: false, assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
  ];
  const res = response();
  await handler({
    requireSession: async () => ({ id: 'user-a', businessId: 'biz-a', role: 'crew_member', employeeId: 'employee-a' }),
    getBusinessProfile: async () => ({ timezone: 'America/Los_Angeles' }),
    getEmployeeForBusiness: async () => data.employees[0],
    loadCoreBootstrapData: async () => data,
    now: () => new Date('2026-09-11T00:30:00.000Z'),
  })({ method: 'GET' }, res);

  assert.equal(res.body.jobs.find((job) => job.id === 'utc-next-day').scheduledToday, false);
  assert.equal(res.body.jobs.find((job) => job.id === 'local-friday').scheduledToday, true);
  assert.equal(res.body.jobs.find((job) => job.id === 'weekend').scheduledToday, false);
});

test('Foreman bootstrap marks only actually assigned Jobs as scheduled today', async () => {
  const data = coreData();
  data.jobs = [
    { id: 'assigned', title: 'Assigned', status: 'scheduled', startDate: '2026-09-10', assignedForemanId: 'employee-a', assignedCrewEmployeeIds: [], assignedEmployeeIds: ['employee-a'], operationalWorkAreas: [] },
    { id: 'authorized-only', title: 'Authorized Only', status: 'scheduled', startDate: '2026-09-10', assignedEmployeeIds: ['employee-b'], operationalWorkAreas: [] },
  ];
  const res = response();
  await handler({
    requireSession: async () => ({ id: 'user-a', businessId: 'biz-a', role: 'foreman', employeeId: 'employee-a' }),
    loadCoreBootstrapData: async () => data,
    now: () => new Date('2026-09-10T12:00:00.000Z'),
  })({ method: 'GET' }, res);

  assert.deepEqual(res.body.jobs.map((job) => [job.id, job.scheduledToday]), [
    ['assigned', true],
    ['authorized-only', false],
  ]);
});

test('bootstrap degrades only Service Visits when schedule retrieval throws', async () => {
  const logged = [];
  const res = response();
  await handler({
    listServiceVisitsForSchedule: async () => { throw Object.assign(new Error('Requested resource not found'), { name: 'ResourceNotFoundException' }); },
    logServiceVisitError: (error) => logged.push(error),
  })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.serviceVisits, []);
  assert.equal(res.body.customers[0].id, 'customer-a');
  assert.equal(res.body.jobs[0].id, 'job-a');
  assert.equal(res.body.estimates[0].id, 'estimate-a');
  assert.equal(res.body.employees[0].id, 'employee-a');
  assert.equal(logged[0].name, 'ResourceNotFoundException');
});

test('a core repository failure still fails bootstrap', async () => {
  const res = response();
  await handler({ loadCoreBootstrapData: async () => { throw new Error('Customers unavailable'); } })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'Could not load business data' });
});

test('Today and Upcoming Visit summaries include only canonical tenant Crew metadata', async () => {
  const data = coreData();
  data.crews = [{ id: 'crew-a', name: 'North Crew', active: true, labourRate: 999 }];
  data.jobs = [{ id: 'job-a', title: 'Job A', workType: 'service', customerId: 'customer-a', services: [{ id: 'service-a', name: 'Weekly mowing' }] }];
  const res = response();
  await handler({
    loadCoreBootstrapData: async () => data,
    listServiceVisitsForSchedule: async (_businessId, today) => [
      { id: 'visit-a', jobId: 'job-a', serviceId: 'service-a', scheduledDate: today, crewId: 'crew-a', assignedEmployeeIds: ['employee-a'], assignedEquipmentIds: ['equipment-a'], status: 'scheduled' },
      { id: 'visit-b', jobId: 'job-a', serviceId: 'service-a', scheduledDate: today, crewId: 'crew-missing', status: 'scheduled' },
    ],
  })({ method: 'GET' }, res);

  assert.deepEqual(res.body.todayServiceVisits[0].crew, { id: 'crew-a', name: 'North Crew' });
  assert.equal(res.body.todayServiceVisits[0].crewId, 'crew-a');
  assert.deepEqual(res.body.todayServiceVisits[0].assignedEmployeeIds, ['employee-a']);
  assert.deepEqual(res.body.todayServiceVisits[0].assignedEquipmentIds, ['equipment-a']);
  assert.equal('labourRate' in res.body.todayServiceVisits[0].crew, false);
  assert.equal(res.body.todayServiceVisits[1].crewId, 'crew-missing');
  assert.equal('crew' in res.body.todayServiceVisits[1], false);
});

test('active clock data does not expose Visit labels after the employee assignment is removed', async () => {
  const data = coreData();
  data.jobs = [{ id: 'job-a', title: 'Private Site', workType: 'service', customerId: 'customer-a', services: [{ id: 'service-a', name: 'Private Service' }] }];
  const res = response();
  await handler({
    requireSession: async () => ({ id: 'user-a', businessId: 'biz-a', role: 'crew_member', employeeId: 'employee-a' }),
    loadCoreBootstrapData: async () => data,
    getEmployeeForBusiness: async () => data.employees[0],
    getActiveShiftForEmployee: async () => ({ activeEntryId: 'entry-a' }),
    getTimeEntryForBusiness: async () => ({ id: 'entry-a', employeeId: 'employee-a', serviceVisitId: 'visit-a', clockIn: '2026-09-08T08:00:00.000Z', status: 'clocked_in' }),
    getPendingClockOutWorkflowForEmployee: async () => null,
    getPendingClockInWorkflowForEmployee: async () => null,
    listServiceVisitsForSchedule: async (_businessId, today) => [{ id: 'visit-a', jobId: 'job-a', serviceId: 'service-a', scheduledDate: today, assignedEmployeeIds: ['employee-other'], assignedEquipmentIds: [], status: 'in_progress' }],
  })({ method: 'GET' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.activeTimeEntry.id, 'entry-a');
  assert.equal('jobName' in res.body.activeTimeEntry, false);
  assert.equal('serviceName' in res.body.activeTimeEntry, false);
  assert.deepEqual(res.body.todayServiceVisits, []);
});