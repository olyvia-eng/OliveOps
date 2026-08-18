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
    if (type === 'UpdateCommand') {
      const itemKey = recordKey(input.Key.PK, input.Key.SK);
      const item = store.get(itemKey);
      if (!item || item.status !== input.ExpressionAttributeValues[':submitted']) {
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

test('foreman can approve a submitted Form without changing its ownership', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'foreman-a', role: 'foreman', token: 'foreman-token' });
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#submission-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#submission-a', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'submission-a', formId: 'form-a', employeeId: 'employee-a', submittedAt: '2026-01-01T00:00:00.000Z', status: 'submitted' });

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
  store.set(recordKey('BUSINESS#biz-a', 'FORM_SUBMISSION#submission-a'), { PK: 'BUSINESS#biz-a', SK: 'FORM_SUBMISSION#submission-a', entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: 'submission-a', formId: 'form-a', employeeId: 'employee-a', submittedAt: '2026-01-01T00:00:00.000Z', status: 'submitted' });

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
    store.set(recordKey('BUSINESS#biz-a', `FORM_SUBMISSION#${id}`), { PK: 'BUSINESS#biz-a', SK: `FORM_SUBMISSION#${id}`, entityType: 'FORM_SUBMISSION', businessId: 'biz-a', formSubmissionId: id, formId: 'form-a', employeeId: 'employee-a', submittedAt: '2026-01-01T00:00:00.000Z', status: 'submitted' });
    const result = await request(reviewer.token, id, reviewer.status);
    assert.equal(result.statusCode, 200, reviewer.role);
    assert.equal(store.get(recordKey('BUSINESS#biz-a', `FORM_SUBMISSION#${id}`)).status, reviewer.status, reviewer.role);
  }
});