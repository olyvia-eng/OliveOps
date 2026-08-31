import test from 'node:test';
import assert from 'node:assert/strict';

import formsHandler from '../api/forms.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({
  statusCode: 200, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; return this; },
  json(body) { this.body = body; return this; },
});

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      store.set(key(input.Item.PK, input.Item.SK), structuredClone(input.Item));
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    if (type === 'TransactWriteCommand') {
      if (store.failCloneTransaction) throw new Error('forced clone transaction failure');
      for (const item of input.TransactItems) {
        if (item.Put && store.has(key(item.Put.Item.PK, item.Put.Item.SK))) {
          throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' });
        }
      }
      for (const item of input.TransactItems) {
        if (item.Put) store.set(key(item.Put.Item.PK, item.Put.Item.SK), structuredClone(item.Put.Item));
      }
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedSession(store, { businessId = 'biz-a', userId, token, role }) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), {
    PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId, userId,
    name: userId, email: `${userId}@example.com`, role, active: true, passwordHash: 'hash', sessionVersion: 0,
  });
  await createMobileSessionForUser({
    user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role, businessName: 'Test' },
    accessToken: token,
    expiresInSeconds: 3600,
  });
}

function seedSource(store, businessId = 'biz-a') {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, 'FORM#source-form'), {
    PK: pk, SK: 'FORM#source-form', entityType: 'FORM', businessId, formId: 'source-form',
    name: 'Daily Inspection', description: 'Inspect safely.', category: 'safety', status: 'active',
    assignedTo: 'division', assignmentValue: 'division-1', trigger: ['before_clock_in', 'daily', 'on_demand'],
    completionRequirement: 'required', requiresApproval: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  });
  store.set(key(pk, 'FORM_FIELD#accepted-field'), {
    PK: pk, SK: 'FORM_FIELD#accepted-field', entityType: 'FORM_FIELD', businessId, formFieldId: 'accepted-field',
    formId: 'source-form', type: 'yes_no', label: 'Fit for work?', helpText: 'Answer honestly.', required: true,
    options: ['yes', 'no'], acceptedResponse: { value: 'yes', message: 'You must be fit for work.' }, order: 0,
  });
  store.set(key(pk, 'FORM_FIELD#signature-field'), {
    PK: pk, SK: 'FORM_FIELD#signature-field', entityType: 'FORM_FIELD', businessId, formFieldId: 'signature-field',
    formId: 'source-form', type: 'signature', label: 'Employee Signature', required: true, options: [], order: 1,
  });
  store.set(key(pk, 'FORM_SUBMISSION#historical'), {
    PK: pk, SK: 'FORM_SUBMISSION#historical', entityType: 'FORM_SUBMISSION', businessId, formSubmissionId: 'historical', formId: 'source-form',
  });
  store.set(key(pk, 'FILE#historical-signature'), {
    PK: pk, SK: 'FILE#historical-signature', entityType: 'form-signature', businessId, fileId: 'historical-signature', formId: 'source-form',
  });
}

async function request(token, body) {
  const res = response();
  await formsHandler({ method: 'POST', query: { action: 'clone' }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('Clone Form creates one independent draft definition with regenerated field IDs and no history', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'owner-a', token: 'owner-token', role: 'owner' });
  seedSource(store);

  const result = await request('owner-token', { sourceFormId: 'source-form' });
  assert.equal(result.statusCode, 201);
  assert.notEqual(result.body.form.id, 'source-form');
  assert.equal(result.body.form.name, 'Daily Inspection - Copy');
  assert.equal(result.body.form.status, 'draft');
  assert.deepEqual(result.body.form.trigger, []);
  assert.equal(result.body.form.assignedTo, 'division');
  assert.equal(result.body.form.assignmentValue, 'division-1');
  assert.equal(result.body.form.requiresApproval, true);
  assert.equal(result.body.form.completionRequirement, 'required');
  assert.equal(result.body.form.clonedFromFormId, 'source-form');
  assert.equal(result.body.form.createdByUserId, 'owner-a');
  assert.equal(new Set(result.body.fields.map((field) => field.id)).size, 2);
  assert.ok(result.body.fields.every((field) => !['accepted-field', 'signature-field'].includes(field.id)));
  assert.ok(result.body.fields.every((field) => field.formId === result.body.form.id));
  assert.equal(result.body.fields.find((field) => field.type === 'signature').required, true);
  assert.deepEqual(result.body.fields.find((field) => field.type === 'yes_no').acceptedResponse, { value: 'yes', message: 'You must be fit for work.' });

  result.body.fields[0].options.push('changed');
  result.body.fields[0].acceptedResponse.value = 'no';
  assert.deepEqual(store.get(key('BUSINESS#biz-a', 'FORM_FIELD#accepted-field')).options, ['yes', 'no']);
  assert.equal(store.get(key('BUSINESS#biz-a', 'FORM_FIELD#accepted-field')).acceptedResponse.value, 'yes');
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM_SUBMISSION').length, 1);
  assert.equal([...store.values()].filter((item) => item.entityType === 'form-signature').length, 1);
  assert.equal([...store.values()].filter((item) => item.entityType === 'AUDIT_EVENT' && item.action === 'form_cloned').length, 1);
});

test('Clone Form rejects unauthorized roles and cross-tenant source IDs', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'crew-a', token: 'crew-token', role: 'crew_member' });
  await seedSession(store, { userId: 'admin-a', token: 'admin-token', role: 'admin' });
  seedSource(store, 'biz-b');
  assert.equal((await request('crew-token', { sourceFormId: 'source-form' })).statusCode, 403);
  assert.equal((await request('admin-token', { sourceFormId: 'source-form' })).statusCode, 404);
});

test('Clone Form transaction failure creates no partial definition', async (t) => {
  const store = installDdb(t);
  await seedSession(store, { userId: 'admin-a', token: 'admin-token', role: 'admin' });
  seedSource(store);
  const before = store.size;
  store.failCloneTransaction = true;
  await assert.rejects(() => request('admin-token', { sourceFormId: 'source-form' }), /forced clone transaction failure/);
  assert.equal(store.size, before);
  assert.equal([...store.values()].filter((item) => item.entityType === 'FORM').length, 1);
});