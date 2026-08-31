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
        const update = item.Update;
        if (update) {
          const existing = store.get(key(update.Key.PK, update.Key.SK));
          if (!existing || existing.uploadStatus !== 'uploaded' || existing.claimedSubmissionId) {
            throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' });
          }
        }
      }
      for (const item of input.TransactItems) if (item.Put) store.set(key(item.Put.Item.PK, item.Put.Item.SK), { ...item.Put.Item });
      for (const item of input.TransactItems) if (item.Update) {
        const existing = store.get(key(item.Update.Key.PK, item.Update.Key.SK));
        existing.claimedSubmissionId = item.Update.ExpressionAttributeValues[':submissionId'];
        existing.signedAt = item.Update.ExpressionAttributeValues[':signedAt'];
        delete existing.ttl;
        delete existing.expiresAt;
      }
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

function makeSignatureForm(store, { id = 'signature-form', required = true, requiresApproval = false } = {}) {
  seedForm(store, { id });
  store.get(key('BUSINESS#biz-a', `FORM#${id}`)).requiresApproval = requiresApproval;
  Object.assign(store.get(key('BUSINESS#biz-a', `FORM_FIELD#${id}-notes`)), {
    type: 'signature',
    label: 'Employee Signature',
    required,
  });
}

function seedSignatureFile(store, {
  fileId = 'signature-file',
  formId = 'signature-form',
  fieldId = `${formId}-notes`,
  clientSubmissionId = 'signature-submission-001',
  employeeId = 'employee-a',
  userId = 'user-a',
  uploadStatus = 'uploaded',
  claimedSubmissionId,
  checksumSha256 = 'checksum-a',
} = {}) {
  store.set(key('BUSINESS#biz-a', `FILE#${fileId}`), {
    PK: 'BUSINESS#biz-a', SK: `FILE#${fileId}`, entityType: 'form-signature', businessId: 'biz-a', fileId,
    entityId: clientSubmissionId, category: 'signature', formId, fieldId, clientSubmissionId,
    signerEmployeeId: employeeId, signerUserId: userId, uploadStatus, mimeType: 'image/png', sizeBytes: 1024,
    objectKey: `biz-a/${fileId}/signature.png`, checksumSha256, claimedSubmissionId,
  });
}

function makePhotoForm(store, { id = 'photo-form', required = true } = {}) {
  seedForm(store, { id });
  Object.assign(store.get(key('BUSINESS#biz-a', `FORM_FIELD#${id}-notes`)), {
    type: 'photo_upload',
    label: 'Photo of completed work',
    required,
  });
}

function seedPhotoFile(store, {
  fileId = 'photo-file',
  formId = 'photo-form',
  fieldId = `${formId}-notes`,
  clientSubmissionId = 'photo-submission-001',
  employeeId = 'employee-a',
  userId = 'user-a',
  uploadStatus = 'uploaded',
  claimedSubmissionId,
  checksumSha256 = 'photo-checksum-a',
  mimeType = 'image/jpeg',
  sizeBytes = 1024,
  workflowOccurrenceId,
  workflowRequirementId,
} = {}) {
  store.set(key('BUSINESS#biz-a', `FILE#${fileId}`), {
    PK: 'BUSINESS#biz-a', SK: `FILE#${fileId}`, entityType: 'form-attachment', businessId: 'biz-a', fileId,
    entityId: clientSubmissionId, category: 'photo', formId, fieldId, clientSubmissionId,
    submitterEmployeeId: employeeId, submitterUserId: userId, uploadStatus, mimeType, sizeBytes,
    objectKey: `biz-a/${fileId}/photo.jpg`, checksumSha256, claimedSubmissionId,
    workflowOccurrenceId, workflowRequirementId,
  });
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

test('employee Forms lifecycle discovery follows operational job status and preserves history', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  const pk = 'BUSINESS#biz-a';
  store.set(key(pk, 'DIVISION#division-a'), { PK: pk, SK: 'DIVISION#division-a', entityType: 'DIVISION', businessId: 'biz-a', divisionId: 'division-a', name: 'Earthworks', active: true });
  store.set(key(pk, 'EQUIPMENT#equipment-a'), { PK: pk, SK: 'EQUIPMENT#equipment-a', entityType: 'EQUIPMENT', businessId: 'biz-a', equipmentId: 'equipment-a', name: 'Excavator', status: 'active' });
  const statuses = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];
  for (const status of statuses) {
    const jobId = `job-${status}`;
    store.set(key(pk, `JOB#${jobId}`), {
      PK: pk, SK: `JOB#${jobId}`, entityType: 'JOB', businessId: 'biz-a', jobId,
      title: `Job ${status}`, status, assignedEmployeeIds: ['employee-a'], assignedEquipmentIds: status === 'scheduled' ? ['equipment-a'] : [], divisionId: 'division-a', customerId: `customer-${status}`,
    });
    store.set(key(pk, `CUSTOMER#customer-${status}`), { PK: pk, SK: `CUSTOMER#customer-${status}`, entityType: 'CUSTOMER', businessId: 'biz-a', customerId: `customer-${status}`, name: `Customer ${status}` });
    seedForm(store, { id: `form-${status}`, assignedTo: 'job', assignmentValue: jobId });
  }
  seedForm(store, { id: 'equipment-form', assignedTo: 'equipment', assignmentValue: 'equipment-a' });
  seedForm(store, { id: 'division-form', assignedTo: 'division', assignmentValue: 'division-a' });
  seedForm(store, { id: 'selector-form' });
  store.set(key(pk, 'FORM_FIELD#selector-job'), { PK: pk, SK: 'FORM_FIELD#selector-job', entityType: 'FORM_FIELD', businessId: 'biz-a', formFieldId: 'selector-job', formId: 'selector-form', type: 'job_selector', label: 'Job', required: true, options: [], order: 1 });
  store.set(key(pk, 'FORM_FIELD#selector-customer'), { PK: pk, SK: 'FORM_FIELD#selector-customer', entityType: 'FORM_FIELD', businessId: 'biz-a', formFieldId: 'selector-customer', formId: 'selector-form', type: 'customer_selector', label: 'Customer', required: true, options: [], order: 2 });
  store.set(key(pk, 'FORM_SUBMISSION#historical'), {
    PK: pk, SK: 'FORM_SUBMISSION#historical', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'historical',
    formId: 'form-completed', employeeId: 'employee-a', jobId: 'job-completed', trigger: 'on_demand', status: 'submitted', submittedAt: '2026-08-18T12:00:00.000Z',
  });

  const initial = await request('token-a', { action: 'forms' });
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.body.available.filter((item) => item.id.startsWith('form-')).map((item) => item.id).sort(), ['form-in_progress', 'form-scheduled']);
  assert.equal(initial.body.available.find((item) => item.id === 'equipment-form').context.jobId, 'job-scheduled');
  assert.deepEqual(initial.body.available.filter((item) => item.id === 'division-form').map((item) => item.context.jobId).sort(), ['job-in_progress', 'job-scheduled']);
  const selector = initial.body.available.find((item) => item.id === 'selector-form');
  assert.deepEqual(selector.fields.find((field) => field.id === 'selector-job').choices.map((choice) => choice.value).sort(), ['job-in_progress', 'job-scheduled']);
  assert.deepEqual(selector.fields.find((field) => field.id === 'selector-customer').choices.map((choice) => choice.value).sort(), ['customer-in_progress', 'customer-scheduled']);
  assert.equal(initial.body.completed[0].context.jobId, 'job-completed');
  assert.equal(initial.body.completed[0].context.jobName, 'Job completed');

  store.get(key(pk, 'JOB#job-completed')).status = 'in_progress';
  store.get(key(pk, 'JOB#job-on_hold')).status = 'scheduled';
  const reopened = await request('token-a', { action: 'forms' });
  assert.deepEqual(reopened.body.available.filter((item) => item.id.startsWith('form-')).map((item) => item.id).sort(), ['form-completed', 'form-in_progress', 'form-on_hold', 'form-scheduled']);

  const closedContext = await request('token-a', { action: 'required', query: { trigger: 'before_starting_job', jobId: 'job-cancelled' } });
  assert.equal(closedContext.statusCode, 403);
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

test('employee Forms production handler fails closed for foreign tenant and context identifiers', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a', role: 'crew_member' });
  seedForm(store, { id: 'local-form' });
  seedForm(store, { id: 'foreign-form', businessId: 'biz-b' });
  store.set(key('BUSINESS#biz-b', 'JOB#job-b'), { PK: 'BUSINESS#biz-b', SK: 'JOB#job-b', entityType: 'JOB', businessId: 'biz-b', jobId: 'job-b', title: 'Foreign Job', assignedEmployeeIds: ['employee-a'] });
  store.set(key('BUSINESS#biz-b', 'DIVISION#division-b'), { PK: 'BUSINESS#biz-b', SK: 'DIVISION#division-b', entityType: 'DIVISION', businessId: 'biz-b', divisionId: 'division-b', name: 'Foreign Division', active: true });
  store.set(key('BUSINESS#biz-b', 'EQUIPMENT#equipment-b'), { PK: 'BUSINESS#biz-b', SK: 'EQUIPMENT#equipment-b', entityType: 'EQUIPMENT', businessId: 'biz-b', equipmentId: 'equipment-b', name: 'Foreign Equipment', status: 'active' });
  store.set(key('BUSINESS#biz-b', 'FORM_SUBMISSION#submission-b'), { PK: 'BUSINESS#biz-b', SK: 'FORM_SUBMISSION#submission-b', entityType: 'FORM_SUBMISSION', businessId: 'biz-b', formSubmissionId: 'submission-b', formId: 'foreign-form', employeeId: 'employee-a', status: 'submitted' });

  const foreignForm = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'foreign-form', responses: [] } });
  const foreignJob = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'local-form', jobId: 'job-b', responses: [{ fieldId: 'local-form-notes', value: 'x' }] } });
  const foreignDivision = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'local-form', divisionId: 'division-b', responses: [{ fieldId: 'local-form-notes', value: 'x' }] } });
  const foreignEquipment = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'local-form', equipmentId: 'equipment-b', responses: [{ fieldId: 'local-form-notes', value: 'x' }] } });
  const foreignSubmission = await request('token-a', { action: 'submission', query: { id: 'submission-b' } });

  assert.deepEqual(
    [foreignForm.statusCode, foreignJob.statusCode, foreignDivision.statusCode, foreignEquipment.statusCode, foreignSubmission.statusCode],
    [404, 403, 403, 403, 404]
  );
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

  assert.equal((await submit('TEST-A')).statusCode, 201);
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

test('accepted responses are exposed and enforced before pending-review submissions are written', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'safety-check' });
  store.get(key('BUSINESS#biz-a', 'FORM#safety-check')).requiresApproval = true;
  const field = store.get(key('BUSINESS#biz-a', 'FORM_FIELD#safety-check-notes'));
  Object.assign(field, { type: 'yes_no', acceptedResponse: { value: 'yes', message: 'Confirm the site is safe.' } });

  const available = await request('token-a', { action: 'forms' });
  assert.deepEqual(available.body.available[0].fields[0].acceptedResponse, { value: 'yes', message: 'Confirm the site is safe.' });

  const rejected = await request('token-a', { method: 'POST', action: 'submit', body: { data: { formId: 'safety-check', responses: [{ fieldId: 'safety-check-notes', value: 'no' }] } } });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.code, 'form_response_requirement_failed');
  assert.equal(rejected.body.fieldId, 'safety-check-notes');
  assert.match(rejected.body.error, /Confirm the site is safe/);
  assert.equal([...store.values()].some((item) => item.entityType === 'FORM_SUBMISSION'), false);

  const accepted = await request('token-a', { method: 'POST', action: 'submit', body: { data: { formId: 'safety-check', responses: [{ fieldId: 'safety-check-notes', value: 'yes' }] } } });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.body.submission.status, 'pending_review');
});

test('drawn Signature is required, claimed once, snapshotted, and idempotently replayed', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  makeSignatureForm(store, { requiresApproval: true });
  seedSignatureFile(store);
  const body = {
    formId: 'signature-form', clientSubmissionId: 'signature-submission-001',
    responses: [{ fieldId: 'signature-form-notes', value: '', fileIds: ['signature-file'] }],
  };

  assert.equal((await request('token-a', { method: 'POST', action: 'submit', body: { ...body, responses: [] } })).statusCode, 400);
  const submitted = await request('token-a', { method: 'POST', action: 'submit', body });
  assert.equal(submitted.statusCode, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.submission.status, 'pending_review');
  const response = [...store.values()].find((item) => item.entityType === 'FORM_RESPONSE');
  assert.equal(response.value, '');
  assert.deepEqual(response.fileIds, ['signature-file']);
  assert.equal(response.labelSnapshot, 'Employee Signature');
  assert.equal(response.typeSnapshot, 'signature');
  assert.equal(response.signerEmployeeId, 'employee-a');
  assert.equal(response.signerUserId, 'user-a');
  assert.equal(store.get(key('BUSINESS#biz-a', 'FILE#signature-file')).claimedSubmissionId, submitted.body.submission.id);

  const replay = await request('token-a', { method: 'POST', action: 'submit', body });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_RESPONSE').length, 1);
});

test('optional Signature may be empty and signature artifacts cannot cross binding dimensions', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  makeSignatureForm(store, { required: false });
  const empty = await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'signature-form', clientSubmissionId: 'signature-empty-001', responses: [] } });
  assert.equal(empty.statusCode, 201);

  for (const [fileId, override] of [
    ['wrong-form', { formId: 'another-form' }],
    ['wrong-field', { fieldId: 'another-field' }],
    ['wrong-employee', { employeeId: 'employee-b' }],
    ['incomplete', { uploadStatus: 'pending' }],
    ['claimed', { claimedSubmissionId: 'another-submission' }],
  ]) {
    const clientSubmissionId = `signature-${fileId}-001`;
    seedSignatureFile(store, { fileId, clientSubmissionId, ...override });
    const result = await request('token-a', { method: 'POST', action: 'submit', body: {
      formId: 'signature-form', clientSubmissionId,
      responses: [{ fieldId: 'signature-form-notes', fileIds: [fileId] }],
    } });
    assert.ok([400, 409].includes(result.statusCode), fileId);
  }
});

test('changing the signature under one client submission ID conflicts without another binding', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  makeSignatureForm(store);
  seedSignatureFile(store, { fileId: 'signature-a' });
  seedSignatureFile(store, { fileId: 'signature-b', checksumSha256: 'checksum-b' });
  const submit = (fileId) => request('token-a', { method: 'POST', action: 'submit', body: {
    formId: 'signature-form', clientSubmissionId: 'signature-submission-001',
    responses: [{ fieldId: 'signature-form-notes', fileIds: [fileId] }],
  } });
  assert.equal((await submit('signature-a')).statusCode, 201);
  const changed = await submit('signature-b');
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.body.error, 'submission_idempotency_conflict');
  assert.equal(store.get(key('BUSINESS#biz-a', 'FILE#signature-b')).claimedSubmissionId, undefined);
});

test('submission detail prefers immutable field snapshots and preserves legacy typed signatures', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  seedForm(store, { id: 'inspection' });
  const submitted = await request('token-a', { method: 'POST', action: 'submit', body: {
    formId: 'inspection', clientSubmissionId: 'snapshot-submission-001',
    responses: [{ fieldId: 'inspection-notes', value: 'Original answer' }],
  } });
  store.delete(key('BUSINESS#biz-a', 'FORM_FIELD#inspection-notes'));
  const detail = await request('token-a', { action: 'submission', query: { id: submitted.body.submission.id } });
  assert.equal(detail.body.answers[0].label, 'Notes');
  assert.equal(detail.body.answers[0].type, 'single_line_text');

  makeSignatureForm(store, { id: 'legacy-signature' });
  store.set(key('BUSINESS#biz-a', 'FORM_SUBMISSION#legacy-signature-submission'), {
    PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#legacy-signature-submission', entityType: 'FORM_SUBMISSION', businessId: 'biz-a',
    formSubmissionId: 'legacy-signature-submission', formId: 'legacy-signature', employeeId: 'employee-a', submittedAt: '2026-01-01T12:00:00.000Z', status: 'submitted',
  });
  store.set(key('BUSINESS#biz-a', 'FORM_RESPONSE#legacy-signature-response'), {
    PK: 'BUSINESS#biz-a', SK: 'FORM_RESPONSE#legacy-signature-response', entityType: 'FORM_RESPONSE', businessId: 'biz-a',
    formResponseId: 'legacy-signature-response', submissionId: 'legacy-signature-submission', fieldId: 'legacy-signature-notes', value: 'Ryan Smith', employeeId: 'employee-a',
  });
  const legacy = await request('token-a', { action: 'submission', query: { id: 'legacy-signature-submission' } });
  assert.equal(legacy.body.answers[0].type, 'signature');
  assert.equal(legacy.body.answers[0].value, 'Ryan Smith');
  assert.equal(legacy.body.answers[0].fileIds, undefined);
});

test('Photo Upload requires exactly one completed photo, claims it, and replays idempotently', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  makePhotoForm(store);
  seedPhotoFile(store);
  const body = {
    formId: 'photo-form', clientSubmissionId: 'photo-submission-001',
    responses: [{ fieldId: 'photo-form-notes', value: '', fileIds: ['photo-file'] }],
  };

  assert.equal((await request('token-a', { method: 'POST', action: 'submit', body: { ...body, responses: [] } })).statusCode, 400);
  assert.equal((await request('token-a', { method: 'POST', action: 'submit', body: { ...body, responses: [{ ...body.responses[0], fileIds: ['photo-file', 'other'] }] } })).statusCode, 400);
  const submitted = await request('token-a', { method: 'POST', action: 'submit', body });
  assert.equal(submitted.statusCode, 201);
  const response = [...store.values()].find((item) => item.entityType === 'FORM_RESPONSE');
  assert.deepEqual(response.fileIds, ['photo-file']);
  assert.equal(response.value, '');
  assert.equal(response.typeSnapshot, 'photo_upload');
  assert.equal(store.get(key('BUSINESS#biz-a', 'FILE#photo-file')).claimedSubmissionId, submitted.body.submission.id);

  const replay = await request('token-a', { method: 'POST', action: 'submit', body });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_RESPONSE').length, 1);
});

test('optional Photo Upload may be omitted but invalid or mismatched staged photos fail closed', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  makePhotoForm(store, { required: false });
  assert.equal((await request('token-a', { method: 'POST', action: 'submit', body: { formId: 'photo-form', clientSubmissionId: 'photo-empty-001', responses: [] } })).statusCode, 201);

  const cases = [
    ['fabricated', null],
    ['wrong-form', { formId: 'another-form' }],
    ['wrong-field', { fieldId: 'another-field' }],
    ['wrong-employee', { employeeId: 'employee-b' }],
    ['wrong-user', { userId: 'user-b' }],
    ['wrong-workflow', { workflowOccurrenceId: 'workflow-other' }],
    ['wrong-requirement', { workflowRequirementId: 'requirement-other' }],
    ['incomplete', { uploadStatus: 'pending' }],
    ['claimed', { claimedSubmissionId: 'another-submission' }],
    ['invalid-mime', { mimeType: 'image/heic' }],
    ['oversized', { sizeBytes: 8 * 1024 * 1024 + 1 }],
  ];
  for (const [fileId, override] of cases) {
    const clientSubmissionId = `photo-${fileId}-001`;
    if (override) seedPhotoFile(store, { fileId, clientSubmissionId, ...override });
    const result = await request('token-a', { method: 'POST', action: 'submit', body: {
      formId: 'photo-form', clientSubmissionId,
      responses: [{ fieldId: 'photo-form-notes', fileIds: [fileId] }],
    } });
    assert.ok([400, 409].includes(result.statusCode), fileId);
  }
});

test('changing a Photo Upload file under one client submission ID conflicts without claiming the replacement', async (t) => {
  const store = installDdb(t);
  await seedIdentity(store, { userId: 'user-a', employeeId: 'employee-a', token: 'token-a' });
  makePhotoForm(store);
  seedPhotoFile(store, { fileId: 'photo-a' });
  seedPhotoFile(store, { fileId: 'photo-b', checksumSha256: 'photo-checksum-b' });
  const submit = (fileId) => request('token-a', { method: 'POST', action: 'submit', body: {
    formId: 'photo-form', clientSubmissionId: 'photo-submission-001',
    responses: [{ fieldId: 'photo-form-notes', fileIds: [fileId] }],
  } });
  const initial = await submit('photo-a');
  assert.equal(initial.statusCode, 201, JSON.stringify(initial.body));
  const changed = await submit('photo-b');
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.body.error, 'submission_idempotency_conflict');
  assert.equal(store.get(key('BUSINESS#biz-a', 'FILE#photo-b')).claimedSubmissionId, undefined);
});