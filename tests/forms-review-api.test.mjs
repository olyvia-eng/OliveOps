import test from 'node:test';
import assert from 'node:assert/strict';
import reviewHandler from '../api/forms-review.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';

const recordKey = (pk, sk) => `${pk}|${sk}`;
const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } });

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      const itemKey = recordKey(input.Item.PK, input.Item.SK);
      if (input.ConditionExpression?.includes('attribute_exists') && !store.has(itemKey)) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
      store.set(itemKey, { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(recordKey(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    if (type === 'UpdateCommand') {
      const itemKey = recordKey(input.Key.PK, input.Key.SK);
      const item = store.get(itemKey);
      if (!item || item.status !== input.ExpressionAttributeValues[':pendingReview']) {
        throw Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' });
      }
      store.set(itemKey, { ...item, status: input.ExpressionAttributeValues[':status'] });
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedSession(store, { userId, role, token }) {
  store.set(recordKey('BUSINESS#biz-a', `USER#${userId}`), { PK: 'BUSINESS#biz-a', SK: `USER#${userId}`, entityType: 'USER', businessId: 'biz-a', userId, name: userId, email: `${userId}@example.com`, role, active: true, passwordHash: 'hash', sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' });
  await createMobileSessionForUser({ user: { id: userId, businessId: 'biz-a', name: userId, email: `${userId}@example.com`, role, businessName: 'Olive Test' }, accessToken: token, expiresInSeconds: 3600 });
}

async function request(token, id, status) {
  const res = response();
  await reviewHandler({ method: 'PATCH', query: { id }, headers: { authorization: `Bearer ${token}` }, body: { status, employeeId: 'attacker-change' } }, res);
  return res;
}

async function getRequest(token, query) {
  const res = response();
  await reviewHandler({ method: 'GET', query, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

function seedJobFormContext(store) {
  store.set(recordKey('BUSINESS#biz-a', 'JOB#job-a'), { PK: 'BUSINESS#biz-a', SK: 'JOB#job-a', entityType: 'JOB', businessId: 'biz-a', jobId: 'job-a', title: 'Front Entrance Job', actualCosts: [], assignedEmployeeIds: [] });
  store.set(recordKey('BUSINESS#biz-a', 'FORM#form-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM#form-a', entityType: 'FORM', businessId: 'biz-a', formId: 'form-a', name: 'Interlock Checklist', description: 'Inspect completed interlock.', category: 'job_site', status: 'active', assignedTo: 'job', assignmentValue: 'job-a', trigger: ['after_clock_out'] });
  store.set(recordKey('BUSINESS#biz-a', 'EMPLOYEE#employee-a'), { PK: 'BUSINESS#biz-a', SK: 'EMPLOYEE#employee-a', entityType: 'EMPLOYEE', businessId: 'biz-a', employeeId: 'employee-a', name: 'John Smith', role: 'crew_member', active: true });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#submission-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#submission-a', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'submission-a', formId: 'form-a', jobId: 'job-a', employeeId: 'employee-a', submittedAt: '2026-08-23T20:21:00.000Z', status: 'approved', divisionId: 'division-a' });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#other-job'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#other-job', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'other-job', formId: 'form-a', jobId: 'job-b', employeeId: 'employee-a', submittedAt: '2026-08-22T20:21:00.000Z', status: 'submitted' });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#other-form'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#other-form', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'other-form', formId: 'form-b', jobId: 'job-a', employeeId: 'employee-a', submittedAt: '2026-08-21T20:21:00.000Z', status: 'submitted' });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_FIELD#field-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_FIELD#field-a', entityType: 'FORM_FIELD', businessId: 'biz-a', formFieldId: 'field-a', formId: 'form-a', type: 'yes_no', label: 'Base compacted?', required: true, order: 0 });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_RESPONSE#response-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_RESPONSE#response-a', entityType: 'FORM_RESPONSE', businessId: 'biz-a', formResponseId: 'response-a', submissionId: 'submission-a', fieldId: 'field-a', value: 'Yes', employeeId: 'employee-a' });
  store.set(recordKey('BUSINESS#biz-a', 'DIVISION#division-a'), { PK: 'BUSINESS#biz-a', SK: 'DIVISION#division-a', entityType: 'DIVISION', businessId: 'biz-a', divisionId: 'division-a', name: 'Hardscape', active: true });
}

test('job-scoped review list and detail return only the exact Form and Job submissions', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'admin-a', role: 'admin', token: 'admin-token' });
  seedJobFormContext(store);

  const list = await getRequest('admin-token', { jobId: 'job-a', formId: 'form-a' });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.submissions.map((submission) => submission.id), ['submission-a']);
  assert.equal(list.body.submissions[0].employeeName, 'John Smith');

  const detail = await getRequest('admin-token', { jobId: 'job-a', formId: 'form-a', id: 'submission-a' });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.job.title, 'Front Entrance Job');
  assert.equal(detail.body.submission.divisionName, 'Hardscape');
  assert.deepEqual(detail.body.responses.map((answer) => [answer.fieldLabel, answer.value]), [['Base compacted?', 'Yes']]);

  assert.equal((await getRequest('admin-token', { jobId: 'job-a', formId: 'form-a', id: 'other-job' })).statusCode, 404);
  assert.equal((await getRequest('admin-token', { jobId: 'job-a', formId: 'form-a', id: 'other-form' })).statusCode, 404);
});

test('job-scoped submission reads require review roles and tenant-owned assigned context', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'crew-a', role: 'crew_member', token: 'crew-token' });
  await seedSession(store, { userId: 'admin-a', role: 'admin', token: 'admin-token' });
  seedJobFormContext(store);
  store.set(recordKey('BUSINESS#biz-b', 'JOB#job-b'), { PK: 'BUSINESS#biz-b', SK: 'JOB#job-b', entityType: 'JOB', businessId: 'biz-b', jobId: 'job-b', title: 'Foreign Job' });
  store.set(recordKey('BUSINESS#biz-b', 'FORM#form-b'), { PK: 'BUSINESS#biz-b', SK: 'FORM#form-b', entityType: 'FORM', businessId: 'biz-b', formId: 'form-b', assignedTo: 'job', assignmentValue: 'job-b' });

  assert.equal((await getRequest('crew-token', { jobId: 'job-a', formId: 'form-a' })).statusCode, 403);
  assert.equal((await getRequest('admin-token', { jobId: 'job-b', formId: 'form-b' })).statusCode, 404);
  assert.equal((await getRequest('admin-token', { jobId: 'job-a', formId: 'form-b' })).statusCode, 404);
});

test('foreman can approve a Form pending review without changing its ownership', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'foreman-a', role: 'foreman', token: 'foreman-token' });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#submission-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#submission-a', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'submission-a', formId: 'form-a', employeeId: 'employee-a', submittedAt: '2026-01-01T00:00:00.000Z', status: 'pending_review' });

  const res = await request('foreman-token', 'submission-a', 'approved');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.submission.status, 'approved');
  assert.equal(res.body.submission.employeeId, 'employee-a');
  assert.equal(store.get(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#submission-a')).employeeId, 'employee-a');
});

test('review endpoint denies crew, invalid transitions, and cross-tenant IDs', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'crew-a', role: 'crew_member', token: 'crew-token' });
  await seedSession(store, { userId: 'admin-a', role: 'admin', token: 'admin-token' });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#reviewed-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#reviewed-a', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'reviewed-a', formId: 'form-a', employeeId: 'employee-a', submittedAt: '2026-01-01T00:00:00.000Z', status: 'approved' });
  store.set(recordKey('BUSINESS#biz-b', 'FORM_SUBMISSION#other-b'), { PK: 'BUSINESS#biz-b', SK: 'FORM_SUBMISSION#other-b', entityType: 'FORM_SUBMISSION', businessId: 'biz-b', formSubmissionId: 'other-b', status: 'submitted' });

  assert.equal((await request('crew-token', 'reviewed-a', 'rejected')).statusCode, 403);
  assert.equal((await request('admin-token', 'reviewed-a', 'rejected')).statusCode, 409);
  assert.equal((await request('admin-token', 'other-b', 'approved')).statusCode, 404);
  assert.equal((await request('admin-token', 'reviewed-a', 'draft')).statusCode, 400);
});

test('competing review transitions cannot overwrite the first decision', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'admin-a', role: 'admin', token: 'admin-token' });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#submission-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#submission-a', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'submission-a', formId: 'form-a', employeeId: 'employee-a', submittedAt: '2026-01-01T00:00:00.000Z', status: 'pending_review' });

  const [approved, rejected] = await Promise.all([
    request('admin-token', 'submission-a', 'approved'),
    request('admin-token', 'submission-a', 'rejected'),
  ]);

  assert.deepEqual([approved.statusCode, rejected.statusCode].sort(), [200, 409]);
  assert.equal(store.get(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#submission-a')).status, approved.statusCode === 200 ? 'approved' : 'rejected');
});

test('owner, admin, and foreman can persist approve or reject decisions', async (t) => {
  const store = installDdb(t);
  const reviewers = [
    { userId: 'owner-a', role: 'owner', token: 'owner-token', status: 'approved' },
    { userId: 'admin-a', role: 'admin', token: 'admin-token', status: 'rejected' },
    { userId: 'foreman-a', role: 'foreman', token: 'foreman-token', status: 'approved' },
  ];
  for (const reviewer of reviewers) await seedSession(store, reviewer);
  for (const [index, reviewer] of reviewers.entries()) {
    const id = `submission-${index}`;
    store.set(recordKey('BUSINESS#biz-a', `FORM_SUBMISSION#${id}`), { PK: 'BUSINESS#biz-a', SK: `FORM_SUBMISSION#${id}`, entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: id, formId: 'form-a', employeeId: 'employee-a', submittedAt: '2026-01-01T00:00:00.000Z', status: 'pending_review' });
    const result = await request(reviewer.token, id, reviewer.status);
    assert.equal(result.statusCode, 200, reviewer.role);
    assert.equal(store.get(recordKey('BUSINESS#biz-a', `FORM_SUBMISSION#${id}`)).status, reviewer.status, reviewer.role);
  }
});