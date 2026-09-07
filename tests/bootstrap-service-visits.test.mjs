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
      { id: 'visit-a', jobId: 'job-a', serviceId: 'service-a', scheduledDate: today, crewId: 'crew-a', status: 'scheduled' },
      { id: 'visit-b', jobId: 'job-a', serviceId: 'service-a', scheduledDate: today, crewId: 'crew-missing', status: 'scheduled' },
    ],
  })({ method: 'GET' }, res);

  assert.deepEqual(res.body.todayServiceVisits[0].crew, { id: 'crew-a', name: 'North Crew' });
  assert.equal(res.body.todayServiceVisits[0].crewId, 'crew-a');
  assert.equal('labourRate' in res.body.todayServiceVisits[0].crew, false);
  assert.equal(res.body.todayServiceVisits[1].crewId, 'crew-missing');
  assert.equal('crew' in res.body.todayServiceVisits[1], false);
});