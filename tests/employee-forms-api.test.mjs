import test from 'node:test';
import assert from 'node:assert/strict';
import employeeHandler from '../api/employee.js';
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
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    if (type === 'TransactWriteCommand') {
      for (const item of input.TransactItems) {
        const put = item.Put;
        if (put?.ConditionExpression?.includes('attribute_not_exists') && store.has(key(put.Item.PK, put.Item.SK))) throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' });
      }
      for (const item of input.TransactItems) if (item.Put) store.set(key(item.Put.Item.PK, item.Put.Item.SK), { ...item.Put.Item });
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedIdentity(store, { businessId = 'biz-a', userId, employeeId, token, role = 'crew_member' }) {
  store.set(key(`BUSINESS#${businessId}`, 'PROFILE'), { PK: `BUSINESS#${businessId}`, SK: 'PROFILE', entityType: 'BUSINESS', businessId, name: 'Olive Test', timezone: 'America/Toronto', createdAt: '2026-01-01T00:00:00.000Z' });
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), { PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId, userId, name: userId, email: `${userId}@example.com`, role, active: true, passwordHash: 'hash', sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' });
  store.set(key(`BUSINESS#${businessId}`, `EMPLOYEE#${employeeId}`), { PK: `BUSINESS#${businessId}`, SK: `EMPLOYEE#${employeeId}`, entityType: 'EMPLOYEE', businessId, employeeId, id: employeeId, userId, name: employeeId, email: `${userId}@example.com`, phone: '', role, hourlyRate: 20, active: true, createdAt: '2026-01-01T00:00:00.000Z' });
  await createMobileSessionForUser({ user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role, businessName: 'Olive Test', employeeId }, accessToken: token, expiresInSeconds: 3600 });
}

function seedForm(store, { id, assignedTo = 'everyone', assignmentValue, trigger = ['on_demand'], status = 'active' }) {
  store.set(key('BUSINESS#biz-a', `FORM#${id}`), { PK: 'BUSINESS#biz-a', SK: `FORM#${id}`, entityType: 'FORM', businessId: 'biz-a', formId: id, name: id, description: 'Test form', category: 'operations', status, assignedTo, assignmentValue, trigger, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  store.set(key('BUSINESS#biz-a', `FORM_FIELD#${id}-notes`), { PK: 'BUSINESS#biz-a', SK: `FORM_FIELD#${id}-notes`, entityType: 'FORM_FIELD', businessId: 'biz-a', formFieldId: `${id}-notes`, formId: id, type: 'single_line_text', label: 'Notes', required: true, options: [], order: 0 });
}

async function request(token, { method = 'GET', action, query = {}, body }) {
  const res = response();
  await employeeHandler({ method, query: { action, ...query }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('employee Forms API returns renderable assigned packages without generic field access', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'incident' });
  seedForm(store, { id: 'other-employee', assignedTo: 'employee', assignmentValue: 'employee-b' });
  seedForm(store, { id: 'daily-check', trigger: ['daily'] });

  const res = await request('token-a', { action: 'forms' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timezone, 'America/Toronto');
  assert.deepEqual(res.body.available.map((item) => item.id), ['incident']);
  assert.deepEqual(res.body.toDo.map((item) => item.id), ['daily-check']);
  assert.equal(res.body.available[0].fields[0].id, 'incident-notes');
  assert.equal('assignedTo' in res.body.available[0], false);

  const required = await request('token-a', { action: 'required', query: { trigger: 'daily' } });
  assert.equal(required.statusCode, 200);
  assert.deepEqual(required.body.forms.map((item) => item.id), ['daily-check']);
});

test('employee Forms API scopes division and equipment assignments through an authorized job', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  store.set(key('BUSINESS#biz-a', 'DIVISION#division-a'), { PK: 'BUSINESS#biz-a', SK: 'DIVISION#division-a', entityType: 'DIVISION', businessId: 'biz-a', divisionId: 'division-a', name: 'Earthworks', active: true });
  store.set(key('BUSINESS#biz-a', 'CREW#crew-a'), { PK: 'BUSINESS#biz-a', SK: 'CREW#crew-a', entityType: 'CREW', businessId: 'biz-a', crewId: 'crew-a', name: 'Crew A', leadEmployeeId: 'employee-a', memberIds: [], defaultDivisionId: 'division-a', active: true });
  store.set(key('BUSINESS#biz-a', 'JOB#job-a'), { PK: 'BUSINESS#biz-a', SK: 'JOB#job-a', entityType: 'JOB', businessId: 'biz-a', jobId: 'job-a', title: 'Main Street', crewId: 'crew-a', divisionId: 'division-a', assignedEmployeeIds: [], assignedEquipmentIds: ['equipment-a'] });
  store.set(key('BUSINESS#biz-a', 'EQUIPMENT#equipment-a'), { PK: 'BUSINESS#biz-a', SK: 'EQUIPMENT#equipment-a', entityType: 'EQUIPMENT', businessId: 'biz-a', equipmentId: 'equipment-a', name: 'Excavator 12', status: 'active' });
  seedForm(store, { id: 'division-form', assignedTo: 'division', assignmentValue: 'division-a' });
  seedForm(store, { id: 'equipment-form', assignedTo: 'equipment', assignmentValue: 'equipment-a' });

  const res = await request('token-a', { action: 'forms', query: { jobId: 'job-a' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.available.map((item) => item.id).sort(), ['division-form', 'equipment-form']);
  const equipment = res.body.available.find((item) => item.id === 'equipment-form');
  assert.deepEqual(equipment.context, { jobId: 'job-a', jobName: 'Main Street', equipmentId: 'equipment-a', equipmentName: 'Excavator 12', divisionId: 'division-a', divisionName: 'Earthworks' });

  const forbidden = await request('token-a', { action: 'required', query: { trigger: 'before_starting_job', jobId: 'foreign-job' } });
  assert.equal(forbidden.statusCode, 403);
});

test('employee submission ignores spoofed ownership and atomically persists header plus answers', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'incident' });

  const res = await request('token-a', {
    method: 'POST', action: 'submit',
    body: { data: { formId: 'incident', trigger: 'on_demand', employeeId: 'employee-b', status: 'approved', submittedByUserId: 'user-b', responses: [{ fieldId: 'incident-notes', value: 'Safe answer' }] } },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.submission.employeeId, 'employee-a');
  assert.equal(res.body.submission.status, 'submitted');
  assert.equal(res.body.submission.submittedByUserId, 'user-a');
  assert.equal(res.body.submission.responsesCreated, 1);

  const submission = store.get(key('BUSINESS#biz-a', `FORM_SUBMISSION#${res.body.submission.id}`));
  assert.equal(submission.employeeId, 'employee-a');
  const storedResponses = [...store.values()].filter((item) => item.entityType === 'FORM_RESPONSE');
  assert.equal(storedResponses.length, 1);
  assert.equal(storedResponses[0].value, 'Safe answer');
  assert.equal(storedResponses[0].employeeId, 'employee-a');
});

test('employee submission rejects unassigned forms, foreign fields, and another employee submission detail', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  await seedIdentity(store, { userId: 'user-b', employeeId: 'employee-b', token: 'token-b' });
  seedForm(store, { id: 'private', assignedTo: 'employee', assignmentValue: 'employee-b' });
  seedForm(store, { id: 'incident' });

  const unassigned = await request('token-a', { method: 'POST', action: 'submit', body: { data: { formId: 'private', responses: [{ fieldId: 'private-notes', value: 'x' }] } } });
  assert.equal(unassigned.statusCode, 403);

  const foreignField = await request('token-a', { method: 'POST', action: 'submit', body: { data: { formId: 'incident', responses: [{ fieldId: 'private-notes', value: 'x' }] } } });
  assert.equal(foreignField.statusCode, 400);

  store.set(key('BUSINESS#biz-a', 'FORM_SUBMISSION#owned-by-b'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#owned-by-b', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'owned-by-b', formId: 'private', employeeId: 'employee-b', submittedAt: '2026-08-18T12:00:00.000Z', status: 'submitted' });
  const detail = await request('token-a', { action: 'submission', query: { id: 'owned-by-b' } });
  assert.equal(detail.statusCode, 404);
});