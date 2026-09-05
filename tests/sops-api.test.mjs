import test from 'node:test';
import assert from 'node:assert/strict';
import { createSopsHandler } from '../api/sops.js';

function response() {
  return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
}

function harness({
  session = { id: 'user-a', businessId: 'biz-a', employeeId: 'emp-a', role: 'crew_member', name: 'Alex', email: 'alex@example.com' },
  employee = { id: 'emp-a', userId: 'user-a', active: true }, definitions = [], versions = {},
} = {}) {
  const calls = [];
  const handler = createSopsHandler({
    requireSession: async () => session,
    getEmployeeForBusiness: async (businessId, employeeId) => { calls.push(['employee', businessId, employeeId]); return employee; },
    listSopDefinitionsForBusiness: async (businessId) => { calls.push(['list', businessId]); return definitions; },
    getSopDefinitionForBusiness: async (businessId, sopId) => { calls.push(['definition', businessId, sopId]); return definitions.find((item) => item.id === sopId) ?? null; },
    getSopVersionForBusiness: async (businessId, sopId, version) => { calls.push(['version', businessId, sopId, version]); return versions[`${sopId}:${version}`] ?? null; },
    listSopVersionsForBusiness: async (businessId, sopId) => { calls.push(['versions', businessId, sopId]); return Object.values(versions).filter((item) => item.sopId === sopId); },
    createSopDraftForBusiness: async (input) => { calls.push(['create', input]); return { id: 'sop-new' }; },
    updateSopDraftForBusiness: async (input) => { calls.push(['update', input]); return { id: input.sopId }; },
    publishSopVersionForBusiness: async (input) => { calls.push(['publish', input]); return { sopId: input.sopId, version: 2 }; },
    duplicateSopForBusiness: async (input) => { calls.push(['duplicate', input]); return { id: 'sop-copy' }; },
    archiveSopForBusiness: async (input) => { calls.push(['archive', input]); return { id: input.sopId, active: false }; },
    reactivateSopForBusiness: async (input) => { calls.push(['reactivate', input]); return { id: input.sopId, active: true }; },
  });
  return { handler, calls };
}

async function call(handler, method, action, { body = {}, query = {} } = {}) {
  const res = response();
  await handler({ method, query: { action, ...query }, body }, res);
  return res;
}

test('admin list and mutations derive tenant and actor from the session', async () => {
  const session = { id: 'admin-a', businessId: 'biz-a', role: 'admin', name: 'Admin', email: 'admin@example.com' };
  const { handler, calls } = harness({ session });
  assert.equal((await call(handler, 'GET', 'list', { query: { businessId: 'biz-b' } })).statusCode, 200);
  assert.equal((await call(handler, 'POST', 'publish', { body: { businessId: 'biz-b', sopId: 'sop-a', requestId: 'publish-a' } })).statusCode, 200);
  assert.deepEqual(calls.find(([name]) => name === 'list'), ['list', 'biz-a']);
  const publish = calls.find(([name]) => name === 'publish')[1];
  assert.equal(publish.businessId, 'biz-a');
  assert.equal(publish.actor.id, 'admin-a');
});

test('non-admin users cannot access SOP administration', async () => {
  const { handler } = harness();
  assert.equal((await call(handler, 'GET', 'list')).statusCode, 403);
  assert.equal((await call(handler, 'POST', 'archive', { body: { sopId: 'sop-a' } })).statusCode, 403);
});

test('employee list exposes only active published current versions', async () => {
  const definitions = [
    { id: 'published', status: 'published', active: true, currentVersion: 2 },
    { id: 'draft', status: 'draft', active: false, currentVersion: 0 },
    { id: 'archived', status: 'published', active: false, currentVersion: 1 },
  ];
  const versions = { 'published:2': { sopId: 'published', version: 2, title: 'Published SOP' } };
  const result = await call(harness({ definitions, versions }).handler, 'GET', 'my-list');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.sops, [versions['published:2']]);
});

test('employee detail fails closed for draft, archived, and cross-tenant records', async () => {
  for (const definition of [
    { id: 'sop-a', status: 'draft', active: false, currentVersion: 0 },
    { id: 'sop-a', status: 'published', active: false, currentVersion: 1 },
  ]) {
    const result = await call(harness({ definitions: [definition] }).handler, 'GET', 'my-detail', { query: { sopId: 'sop-a', businessId: 'biz-b' } });
    assert.equal(result.statusCode, 404);
  }
});

test('employee endpoints require an active employee linked to the session user', async () => {
  assert.equal((await call(harness({ employee: { id: 'emp-a', userId: 'user-a', active: false } }).handler, 'GET', 'my-list')).statusCode, 403);
  assert.equal((await call(harness({ employee: { id: 'emp-a', userId: 'other-user', active: true } }).handler, 'GET', 'my-list')).statusCode, 403);
});