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
      if (store.failNextTransaction) {
        store.failNextTransaction = false;
        throw new Error('forced transaction failure');
      }
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

function seedForm(store, { id, businessId = 'biz-a', assignedTo = 'everyone', assignmentValue, trigger = ['on_demand'], status = 'active' }) {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, `FORM#${id}`), { PK: pk, SK: `FORM#${id}`, entityType: 'FORM', businessId, formId: id, name: id, description: 'Test form', category: 'operations', status, assignedTo, assignmentValue, trigger, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  store.set(key(pk, `FORM_FIELD#${id}-notes`), { PK: pk, SK: `FORM_FIELD#${id}-notes`, entityType: 'FORM_FIELD', businessId, formFieldId: `${id}-notes`, formId: id, type: 'single_line_text', label: 'Notes', required: true, options: [], order: 0 });
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

test('employee Forms API rejects invalid sessions and inactive form submissions', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'inactive', status: 'draft' });

  assert.equal((await request('invalid-token', { action: 'forms' })).statusCode, 401);
  const inactive = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'inactive', responses: [{ fieldId: 'inactive-notes', value: 'x' }] } });
  assert.equal(inactive.statusCode, 409);
});

test('simultaneous recurring submissions create only one completion record', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'daily', trigger: ['daily'] });
  const payload = { method: 'POST', action: 'submit', body: { formId: 'daily', trigger: 'daily', responses: [{ fieldId: 'daily-notes', value: 'Done' }] } };

  const results = await Promise.all([request('token-a', payload), request('token-a', payload)]);
  assert.deepEqual(results.map((item) => item.statusCode).sort(), [201, 409]);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_SUBMISSION').length, 1);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_RESPONSE').length, 1);
});

test('employee required endpoint surfaces every advisory workflow and recurrence trigger', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  store.set(key('BUSINESS#biz-a', 'JOB#job-a'), { PK: 'BUSINESS#biz-a', SK: 'JOB#job-a', entityType: 'JOB', businessId: 'biz-a', jobId: 'job-a', title: 'Main Street', assignedEmployeeIds: ['employee-a'], assignedEquipmentIds: [] });
  const triggers = ['before_clock_in', 'after_clock_out', 'before_starting_job', 'after_completing_job', 'after_leaving_job', 'job_completed', 'daily', 'weekly', 'monthly'];
  for (const trigger of triggers) seedForm(store, { id: `form-${trigger}`, trigger: [trigger] });

  for (const trigger of triggers) {
    const query = ['before_starting_job', 'after_completing_job', 'after_leaving_job', 'job_completed'].includes(trigger) ? { trigger, jobId: 'job-a' } : { trigger };
    const required = await request('token-a', { action: 'required', query });
    assert.equal(required.statusCode, 200, trigger);
    assert.deepEqual(required.body.forms.map((item) => item.id), [`form-${trigger}`], trigger);
    assert.equal(required.body.forms[0].completionRequirement, 'reminder');
    assert.equal(required.body.forms[0].enforcement, 'advisory');
  }
});

test('new clientSubmissionId is stored atomically, echoed, and replayed without duplicate answers', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'incident' });
  const payload = { formId: 'incident', trigger: 'on_demand', clientSubmissionId: '018f47ac-7c42-7b35-9c79-0f4e871ca202', responses: [{ value: ' Same answer ', fieldId: 'incident-notes' }] };

  const first = await request('token-a', { method: 'POST', action: 'submit', body: payload });
  const retry = await request('token-a', { method: 'POST', action: 'submit', body: { ...payload, responses: [{ fieldId: 'incident-notes', value: 'Same answer' }] } });

  assert.equal(first.statusCode, 201);
  assert.equal(first.body.submission.clientSubmissionId, payload.clientSubmissionId);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.replayed, true);
  assert.deepEqual(retry.body.submission, first.body.submission);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_SUBMISSION').length, 1);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_RESPONSE').length, 1);
  const claim = [...store.values()].find((item) => item.entityType === 'FORM_SUBMISSION_IDEMPOTENCY');
  assert.equal(claim.clientSubmissionId, payload.clientSubmissionId);
  assert.equal(claim.employeeId, 'employee-a');
  assert.equal(typeof claim.payloadFingerprint, 'string');
  assert.equal(typeof claim.ttl, 'number');
  assert.equal('responses' in claim, false);

  const completed = await request('token-a', { action: 'forms' });
  assert.equal(completed.body.completed[0].clientSubmissionId, payload.clientSubmissionId);
  const detail = await request('token-a', { action: 'submission', query: { id: first.body.submission.id } });
  assert.equal(detail.body.submission.clientSubmissionId, payload.clientSubmissionId);
});

test('concurrent identical client submissions both resolve to one original submission', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'incident' });
  const call = { method: 'POST', action: 'submit', body: { formId: 'incident', clientSubmissionId: 'submission-concurrent-001', responses: [{ fieldId: 'incident-notes', value: 'One incident' }] } };

  const results = await Promise.all([request('token-a', call), request('token-a', call)]);
  assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 201]);
  assert.equal(results[0].body.submission.id, results[1].body.submission.id);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_SUBMISSION').length, 1);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_RESPONSE').length, 1);
});

test('same scoped key with changed answer or authorized context returns stable conflict without mutation', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  store.set(key('BUSINESS#biz-a', 'JOB#job-a'), { PK: 'BUSINESS#biz-a', SK: 'JOB#job-a', entityType: 'JOB', businessId: 'biz-a', jobId: 'job-a', title: 'A', assignedEmployeeIds: ['employee-a'], assignedEquipmentIds: [] });
  store.set(key('BUSINESS#biz-a', 'JOB#job-b'), { PK: 'BUSINESS#biz-a', SK: 'JOB#job-b', entityType: 'JOB', businessId: 'biz-a', jobId: 'job-b', title: 'B', assignedEmployeeIds: ['employee-a'], assignedEquipmentIds: [] });
  seedForm(store, { id: 'incident' });
  const clientSubmissionId = 'submission-conflict-001';
  const first = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'incident', jobId: 'job-a', clientSubmissionId, responses: [{ fieldId: 'incident-notes', value: 'Original' }] } });
  const changedAnswer = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'incident', jobId: 'job-a', clientSubmissionId, responses: [{ fieldId: 'incident-notes', value: 'Changed' }] } });
  const changedContext = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'incident', jobId: 'job-b', clientSubmissionId, responses: [{ fieldId: 'incident-notes', value: 'Original' }] } });

  assert.equal(first.statusCode, 201);
  assert.deepEqual([changedAnswer.statusCode, changedContext.statusCode], [409, 409]);
  assert.equal(changedAnswer.body.error, 'submission_idempotency_conflict');
  assert.equal(changedContext.body.error, 'submission_idempotency_conflict');
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_SUBMISSION').length, 1);
  assert.equal([...store.values()].find((item) => item.entityType === 'FORM_RESPONSE').value, 'Original');
});

test('raw clientSubmissionId is independently scoped across employees and businesses', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  await seedIdentity(store, { userId: 'user-b', employeeId: 'employee-b', token: 'token-b' });
  await seedIdentity(store, { businessId: 'biz-b', userId: 'user-c', employeeId: 'employee-c', token: 'token-c' });
  seedForm(store, { id: 'incident' });
  seedForm(store, { id: 'incident', businessId: 'biz-b' });
  const clientSubmissionId = 'shared-client-key-001';
  const body = { formId: 'incident', clientSubmissionId, responses: [{ fieldId: 'incident-notes', value: 'Scoped' }] };

  const results = await Promise.all([
    request('token-a', { method: 'POST', action: 'submit', body }),
    request('token-b', { method: 'POST', action: 'submit', body }),
    request('token-c', { method: 'POST', action: 'submit', body }),
  ]);
  assert.deepEqual(results.map((item) => item.statusCode), [201, 201, 201]);
  assert.equal(new Set(results.map((item) => item.body.submission.id)).size, 3);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_SUBMISSION_IDEMPOTENCY').length, 3);
  const foreignDetail = await request('token-a', { action: 'submission', query: { id: results[1].body.submission.id } });
  assert.equal(foreignDetail.statusCode, 404);
});

test('different client keys create separate on-demand submissions while recurring completion remains unique', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'incident' });
  seedForm(store, { id: 'daily', trigger: ['daily'] });
  const submit = (formId, clientSubmissionId) => request('token-a', { method: 'POST', action: 'submit', body: { formId, clientSubmissionId, responses: [{ fieldId: `${formId}-notes`, value: 'Done' }] } });

  const incidentA = await submit('incident', 'incident-logical-key-a');
  const incidentB = await submit('incident', 'incident-logical-key-b');
  assert.equal(incidentA.statusCode, 201);
  assert.equal(incidentB.statusCode, 201);
  assert.notEqual(incidentA.body.submission.id, incidentB.body.submission.id);

  const dailyA = await submit('daily', 'daily-logical-key-a001');
  const dailyB = await submit('daily', 'daily-logical-key-b001');
  assert.equal(dailyA.statusCode, 201);
  assert.equal(dailyB.statusCode, 409);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_SUBMISSION' && item.formId === 'daily').length, 1);
});

test('invalid client keys are rejected, legacy submissions serialize null, and failed transactions do not poison a key', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'incident' });
  const submit = (clientSubmissionId) => request('token-a', { method: 'POST', action: 'submit', body: { formId: 'incident', clientSubmissionId, responses: [{ fieldId: 'incident-notes', value: 'Retryable' }] } });

  assert.equal((await submit('short')).statusCode, 400);
  assert.equal((await submit(`bad key ${'x'.repeat(8)}`)).body.error, 'invalid_client_submission_id');
  assert.equal((await submit(`x${'a'.repeat(128)}`)).statusCode, 400);

  store.set(key('BUSINESS#biz-a', 'FORM_SUBMISSION#legacy'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#legacy', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'legacy', formId: 'incident', employeeId: 'employee-a', submittedAt: '2026-08-18T12:00:00.000Z', status: 'submitted' });
  const completed = await request('token-a', { action: 'forms' });
  assert.equal(completed.body.completed.find((item) => item.submissionId === 'legacy').clientSubmissionId, null);

  store.failNextTransaction = true;
  await assert.rejects(() => submit('transaction-retry-key-001'), /forced transaction failure/);
  assert.equal([...store.values()].some((item) => item.entityType === 'FORM_SUBMISSION_IDEMPOTENCY' && item.clientSubmissionId === 'transaction-retry-key-001'), false);
  const retry = await submit('transaction-retry-key-001');
  assert.equal(retry.statusCode, 201);
});