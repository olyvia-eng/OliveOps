import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobLabourSummaryHandler } from '../api/job-labour-summary.js';

const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } });

test('Job labour endpoint scopes Job and all aggregation inputs to the authenticated business', async () => {
  const calls = [];
  const handler = createJobLabourSummaryHandler({
    requireSession: async () => ({ businessId: 'biz-a', role: 'admin' }),
    getJobForBusiness: async (businessId, jobId) => {
      calls.push(['job', businessId, jobId]);
      return businessId === 'biz-a' && jobId === 'job-a' ? { id: 'job-a', operationalWorkAreas: [], scheduleConfirmed: false } : null;
    },
    listEmployeesForBusiness: async (businessId) => { calls.push(['employees', businessId]); return []; },
    listLabourClassesForBusiness: async (businessId) => { calls.push(['classes', businessId]); return []; },
    listTimeEntriesForBusiness: async (businessId) => { calls.push(['entries', businessId]); return [{ id: 'foreign', employeeId: 'foreign', jobId: 'foreign-job', workType: 'job', status: 'clocked_out', clockIn: '2026-08-24T08:00:00Z', clockOut: '2026-08-24T09:00:00Z' }]; },
    listTimeCorrectionsForBusiness: async (businessId) => { calls.push(['corrections', businessId]); return []; },
  });
  const res = response();
  await handler({ method: 'GET', query: { jobId: 'job-a' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.actual.hours, 0);
  assert.equal(calls.every((call) => call[1] === 'biz-a'), true);

  const foreign = response();
  await handler({ method: 'GET', query: { jobId: 'foreign-job' } }, foreign);
  assert.equal(foreign.statusCode, 404);
});

test('Job labour endpoint rejects unsupported methods and missing Job identity', async () => {
  const handler = createJobLabourSummaryHandler({ requireSession: async () => ({ businessId: 'biz-a', role: 'admin' }) });
  const method = response();
  await handler({ method: 'POST', query: {} }, method);
  assert.equal(method.statusCode, 405);
  const missing = response();
  await handler({ method: 'GET', query: {} }, missing);
  assert.equal(missing.statusCode, 400);
});