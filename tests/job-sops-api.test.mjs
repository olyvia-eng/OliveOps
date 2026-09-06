import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobSopsHandler } from '../api/job-sops.js';

const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } });
const published = (id, currentVersion = 1) => ({ id, title: `SOP ${id}`, category: 'Safety', shortDescription: 'Procedure', status: 'published', active: true, currentVersion, contentMode: 'structured' });

function handlerFor({ session, job = { id: 'job-a' }, authorized = true, associations = [], definitions = {}, versions = {}, added = [], removed = [] }) {
  return createJobSopsHandler({
    requireSession: async () => session,
    getJobForBusiness: async (businessId, jobId) => businessId === session.businessId && jobId === job.id ? job : null,
    listCrewsForBusiness: async () => [],
    authorizeRecordAccess: () => authorized,
    getJobSopAssociationForBusiness: async (_businessId, _jobId, sopId) => associations.find((item) => item.sopId === sopId) ?? null,
    listJobSopAssociationsForBusiness: async () => associations,
    listSopDefinitionsForBusiness: async () => Object.values(definitions),
    getSopDefinitionForBusiness: async (_businessId, sopId) => definitions[sopId] ?? null,
    getSopVersionForBusiness: async (_businessId, sopId, version) => versions[`${sopId}:${version}`] ?? null,
    addJobSopAssociationForBusiness: async (input) => { added.push(input); return input; },
    removeJobSopAssociationForBusiness: async (input) => { removed.push(input); return { ok: true }; },
  });
}

test('an employee authorized for the Job can list current published SOP versions', async () => {
  const definitions = { 'sop-a': published('sop-a', 2) };
  const versions = { 'sop-a:2': { sopId: 'sop-a', version: 2, title: 'Current lockout' } };
  const handler = handlerFor({
    session: { id: 'user-a', businessId: 'biz-a', role: 'employee', employeeId: 'employee-a' },
    associations: [{ jobId: 'job-a', sopId: 'sop-a', addedAt: '2026-01-01T00:00:00.000Z', addedBy: 'admin-a' }],
    definitions,
    versions,
  });
  const res = response();
  await handler({ method: 'GET', query: { jobId: 'job-a' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sops[0].version, 2);
  assert.equal(res.body.sops[0].association.addedBy, 'admin-a');

  const detailRes = response();
  await handler({ method: 'GET', query: { action: 'detail', jobId: 'job-a', sopId: 'sop-a' } }, detailRes);
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.body.sop.version, 2);
});

test('archived, draft, deleted, and missing-version SOPs are omitted from Job reads', async () => {
  const definitions = {
    archived: { ...published('archived'), active: false },
    draft: { ...published('draft'), status: 'draft', currentVersion: 0 },
    missing: published('missing'),
  };
  const handler = handlerFor({
    session: { id: 'owner-a', businessId: 'biz-a', role: 'owner' },
    associations: ['archived', 'draft', 'deleted', 'missing'].map((sopId) => ({ jobId: 'job-a', sopId })),
    definitions,
  });
  const res = response();
  await handler({ method: 'GET', query: { jobId: 'job-a' } }, res);
  assert.deepEqual(res.body.sops, []);
});

test('an association resolves a newly published current version without being rewritten', async () => {
  const definitions = { 'sop-a': published('sop-a', 1) };
  const versions = {
    'sop-a:1': { sopId: 'sop-a', version: 1, title: 'Original procedure' },
    'sop-a:2': { sopId: 'sop-a', version: 2, title: 'Revised procedure' },
  };
  const associations = [{ jobId: 'job-a', sopId: 'sop-a', addedAt: '2026-01-01T00:00:00.000Z' }];
  const handler = handlerFor({ session: { id: 'owner-a', businessId: 'biz-a', role: 'owner' }, associations, definitions, versions });

  const first = response();
  await handler({ method: 'GET', query: { jobId: 'job-a' } }, first);
  assert.equal(first.body.sops[0].version, 1);

  definitions['sop-a'].currentVersion = 2;
  const second = response();
  await handler({ method: 'GET', query: { jobId: 'job-a' } }, second);
  assert.equal(second.body.sops[0].version, 2);
  assert.equal(second.body.sops[0].title, 'Revised procedure');
  assert.equal(associations[0].addedAt, '2026-01-01T00:00:00.000Z');
});

test('employee mutation is forbidden and inaccessible or foreign Jobs are hidden', async () => {
  const session = { id: 'user-a', businessId: 'biz-a', role: 'employee', employeeId: 'employee-a' };
  const forbidden = handlerFor({ session });
  const mutationRes = response();
  await forbidden({ method: 'POST', query: { jobId: 'job-a' }, body: { sopIds: ['sop-a'] } }, mutationRes);
  assert.equal(mutationRes.statusCode, 403);

  const hidden = handlerFor({ session, authorized: false });
  const hiddenRes = response();
  await hidden({ method: 'GET', query: { jobId: 'job-a' } }, hiddenRes);
  assert.equal(hiddenRes.statusCode, 404);

  const foreignRes = response();
  await forbidden({ method: 'GET', query: { jobId: 'job-b' } }, foreignRes);
  assert.equal(foreignRes.statusCode, 404);
});

test('manager multi-add validates every SOP before creating associations and is duplicate-safe downstream', async () => {
  const added = [];
  const session = { id: 'foreman-a', name: 'Foreman', businessId: 'biz-a', role: 'foreman' };
  const definitions = { 'sop-a': published('sop-a'), 'sop-b': published('sop-b') };
  const handler = handlerFor({ session, definitions, added });
  const res = response();
  await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { sopIds: ['sop-a', 'sop-a', 'sop-b'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(added.map((item) => item.sopId), ['sop-a', 'sop-b']);
  assert.ok(added.every((item) => item.businessId === 'biz-a' && item.jobId === 'job-a'));

  const invalid = handlerFor({ session, definitions: { ...definitions, draft: { ...published('draft'), status: 'draft' } }, added });
  const invalidRes = response();
  await invalid({ method: 'POST', query: { jobId: 'job-a' }, body: { sopIds: ['sop-a', 'draft'] } }, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(added.length, 2);
});

test('manager can search eligible SOPs and remove only the Job association', async () => {
  const removed = [];
  const session = { id: 'admin-a', businessId: 'biz-a', role: 'admin' };
  const definitions = { 'sop-a': published('sop-a'), draft: { ...published('draft'), status: 'draft' } };
  const handler = handlerFor({ session, definitions, associations: [{ jobId: 'job-a', sopId: 'sop-a' }], removed });
  const availableRes = response();
  await handler({ method: 'GET', query: { jobId: 'job-a', action: 'available' } }, availableRes);
  assert.deepEqual(availableRes.body.sops.map((item) => [item.sopId, item.associated]), [['sop-a', true]]);

  const removeRes = response();
  await handler({ method: 'DELETE', query: { jobId: 'job-a', sopId: 'sop-a' } }, removeRes);
  assert.equal(removeRes.statusCode, 200);
  assert.deepEqual(removed[0], { businessId: 'biz-a', jobId: 'job-a', sopId: 'sop-a' });
});