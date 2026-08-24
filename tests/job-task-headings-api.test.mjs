import assert from 'node:assert/strict';
import test from 'node:test';
import dataHandler from '../api/data.js';
import headingsHandler from '../api/job-task-headings.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } });

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      const itemKey = key(input.Item.PK, input.Item.SK);
      if (input.ConditionExpression?.includes('attribute_not_exists') && store.has(itemKey)) throw Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' });
      if (input.ConditionExpression?.includes('attribute_exists') && !store.has(itemKey)) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
      store.set(itemKey, { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    if (type === 'DeleteCommand') { store.delete(key(input.Key.PK, input.Key.SK)); return {}; }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedOwner(store, businessId, userId, token) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), { PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId, userId, name: userId, email: `${userId}@example.com`, role: 'owner', active: true, passwordHash: 'hash', sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' });
  await createMobileSessionForUser({ user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role: 'owner', businessName: businessId }, accessToken: token, expiresInSeconds: 3600 });
}

function seedJob(store, businessId, jobId) {
  store.set(key(`BUSINESS#${businessId}`, `JOB#${jobId}`), { PK: `BUSINESS#${businessId}`, SK: `JOB#${jobId}`, entityType: 'JOB', businessId, jobId, id: jobId, title: jobId, assignedEmployeeIds: [], status: 'in_progress' });
}

async function headingRequest(token, method, jobId, { id, action, body } = {}) {
  const res = response();
  await headingsHandler({ method, query: { jobId, ...(id ? { id } : {}), ...(action ? { action } : {}) }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

const task = (id, userId, jobId, headingId) => ({ id, title: id, description: '', assignedUserId: userId, status: 'open', priority: 'normal', headingId, relatedEntityType: 'job', relatedEntityId: jobId, createdByUserId: userId, createdAt: '2026-08-24T12:00:00.000Z', updatedAt: '2026-08-24T12:00:00.000Z' });

async function taskRequest(token, method, record, patch) {
  const res = response();
  await dataHandler({ method, query: { entity: 'tasks', ...(method === 'PATCH' ? { id: record.id } : {}) }, headers: { authorization: `Bearer ${token}` }, body: { data: patch ?? record } }, res);
  return res;
}

test('Job Task Headings support create, rename, order, delete reassignment, and task heading retention', async (t) => {
  const store = installDdb(t);
  await seedOwner(store, 'biz-a', 'owner-a', 'token-a');
  seedJob(store, 'biz-a', 'job-a');

  const excavation = (await headingRequest('token-a', 'POST', 'job-a', { body: { name: 'Excavation' } })).body.heading;
  const closeout = (await headingRequest('token-a', 'POST', 'job-a', { body: { name: 'Closeout' } })).body.heading;
  assert.notEqual(excavation.id, excavation.name);
  assert.deepEqual([excavation.sortOrder, closeout.sortOrder], [0, 1]);

  const renamed = await headingRequest('token-a', 'PATCH', 'job-a', { id: excavation.id, body: { name: 'Site Excavation' } });
  assert.equal(renamed.body.heading.name, 'Site Excavation');

  const reordered = await headingRequest('token-a', 'PUT', 'job-a', { id: excavation.id, action: 'reorder', body: { orderedIds: [closeout.id, excavation.id] } });
  assert.deepEqual(reordered.body.headings.map((heading) => [heading.id, heading.sortOrder]), [[closeout.id, 0], [excavation.id, 1]]);

  const record = task('task-a', 'owner-a', 'job-a', excavation.id);
  assert.equal((await taskRequest('token-a', 'POST', record)).statusCode, 200);
  assert.equal((await taskRequest('token-a', 'PATCH', record, { headingId: closeout.id })).statusCode, 200);
  assert.equal((await taskRequest('token-a', 'PATCH', record, { status: 'completed', completedAt: '2026-08-24T13:00:00.000Z' })).statusCode, 200);
  assert.equal(store.get(key('BUSINESS#biz-a', 'TASK#task-a')).headingId, closeout.id);

  const deleted = await headingRequest('token-a', 'DELETE', 'job-a', { id: closeout.id });
  assert.equal(deleted.body.movedTaskCount, 1);
  assert.equal(store.get(key('BUSINESS#biz-a', 'TASK#task-a')).headingId, undefined);
  assert.equal(store.has(key('BUSINESS#biz-a', `TASK#${record.id}`)), true);

  const emptyDeleted = await headingRequest('token-a', 'DELETE', 'job-a', { id: excavation.id });
  assert.equal(emptyDeleted.body.movedTaskCount, 0);
});

test('unheaded tasks remain valid and foreign Job, Heading, and tenant IDs are rejected', async (t) => {
  const store = installDdb(t);
  await seedOwner(store, 'biz-a', 'owner-a', 'token-a');
  await seedOwner(store, 'biz-b', 'owner-b', 'token-b');
  seedJob(store, 'biz-a', 'job-a');
  seedJob(store, 'biz-a', 'job-other');
  seedJob(store, 'biz-b', 'job-b');

  const headingA = (await headingRequest('token-a', 'POST', 'job-a', { body: { name: 'Job A' } })).body.heading;
  const headingOther = (await headingRequest('token-a', 'POST', 'job-other', { body: { name: 'Other Job' } })).body.heading;
  const headingB = (await headingRequest('token-b', 'POST', 'job-b', { body: { name: 'Tenant B' } })).body.heading;

  assert.equal((await taskRequest('token-a', 'POST', task('unheaded', 'owner-a', 'job-a', undefined))).statusCode, 200);
  const foreignJob = await taskRequest('token-a', 'POST', task('wrong-job', 'owner-a', 'job-a', headingOther.id));
  assert.equal(foreignJob.statusCode, 400);
  assert.match(foreignJob.body.error, /related job and business/);
  const foreignTenant = await taskRequest('token-a', 'POST', task('wrong-tenant', 'owner-a', 'job-a', headingB.id));
  assert.equal(foreignTenant.statusCode, 400);
  const inaccessibleHeading = await headingRequest('token-a', 'PATCH', 'job-a', { id: headingB.id, body: { name: 'Attack' } });
  assert.equal(inaccessibleHeading.statusCode, 404);
  const mismatchedJob = await headingRequest('token-a', 'PATCH', 'job-other', { id: headingA.id, body: { name: 'Attack' } });
  assert.equal(mismatchedJob.statusCode, 404);
});