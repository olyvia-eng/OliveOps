import test from 'node:test';
import assert from 'node:assert/strict';
import employeeHandler from '../api/employee.js';
import reviewHandler from '../api/forms-review.js';
import {
  createFormFieldForBusiness,
  createFormForBusiness,
  createMobileSessionForUser,
  getFormSubmissionForBusiness,
  listFormFieldsForBusiness,
  listFormResponsesForBusiness,
  listFormsForBusiness,
  updateFormFieldForBusiness,
  updateFormForBusiness,
} from '../api/_lib/authRepo.js';
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
      const exists = store.has(itemKey);
      if (input.ConditionExpression?.includes('attribute_not_exists') && exists) throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
      if (input.ConditionExpression?.includes('attribute_exists') && !exists) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
      store.set(itemKey, { ...input.Item });
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
        if (item.Put && store.has(key(item.Put.Item.PK, item.Put.Item.SK))) throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' });
      }
      for (const item of input.TransactItems) if (item.Put) store.set(key(item.Put.Item.PK, item.Put.Item.SK), { ...item.Put.Item });
      return {};
    }
    if (type === 'UpdateCommand') {
      const itemKey = key(input.Key.PK, input.Key.SK);
      const item = store.get(itemKey);
      if (!item || item.status !== input.ExpressionAttributeValues[':submitted']) throw Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' });
      store.set(itemKey, { ...item, status: input.ExpressionAttributeValues[':status'] });
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function call(handler, token, { method = 'GET', query = {}, body } = {}) {
  const res = response();
  await handler({ method, query, body, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

test('connected Form lifecycle persists builder changes, employee answers, and review state', async (t) => {
  const store = installDdb(t);
  const businessId = 'biz-release';
  const businessPk = `BUSINESS#${businessId}`;
  store.set(key(businessPk, 'PROFILE'), { PK: businessPk, SK: 'PROFILE', businessId, timezone: 'America/Toronto' });
  for (const user of [
    { id: 'employee-user', role: 'crew_member', employeeId: 'employee-a', token: 'employee-token' },
    { id: 'admin-user', role: 'admin', token: 'admin-token' },
  ]) {
    store.set(key(businessPk, `USER#${user.id}`), { PK: businessPk, SK: `USER#${user.id}`, businessId, userId: user.id, name: user.id, email: `${user.id}@example.com`, role: user.role, active: true, sessionVersion: 0 });
    await createMobileSessionForUser({ user: { id: user.id, businessId, name: user.id, email: `${user.id}@example.com`, role: user.role, businessName: 'Release Test', employeeId: user.employeeId }, accessToken: user.token, expiresInSeconds: 3600 });
  }
  store.set(key(businessPk, 'EMPLOYEE#employee-a'), { PK: businessPk, SK: 'EMPLOYEE#employee-a', businessId, employeeId: 'employee-a', userId: 'employee-user', name: 'Alex', email: 'employee-user@example.com', role: 'crew_member', active: true });

  const createdAt = '2026-08-18T10:00:00.000Z';
  const form = { id: 'daily-report', name: 'Draft report', description: '', category: 'operations', status: 'draft', assignedTo: 'everyone', assignmentValue: '', trigger: ['on_demand'], createdAt, updatedAt: createdAt };
  await createFormForBusiness({ businessId, form });
  await createFormFieldForBusiness({ businessId, formField: { id: 'notes', formId: form.id, type: 'single_line_text', label: 'Old label', helpText: '', required: true, placeholder: '', options: [], order: 0 } });
  assert.equal((await listFormsForBusiness(businessId))[0].completionRequirement, 'reminder');

  const savedForm = { ...form, name: 'Daily Field Report', description: 'Record progress.', category: 'job_site', status: 'active', trigger: ['after_leaving_job', 'daily', 'on_demand'], completionRequirement: 'required', updatedAt: '2026-08-18T10:05:00.000Z' };
  await updateFormForBusiness({ businessId, form: savedForm });
  await updateFormFieldForBusiness({ businessId, formField: { id: 'notes', formId: form.id, type: 'single_line_text', label: 'Work completed', helpText: 'Be specific', required: true, placeholder: 'Summary', options: [], order: 1 } });
  await createFormFieldForBusiness({ businessId, formField: { id: 'notes-copy', formId: form.id, type: 'single_line_text', label: 'Work completed (Copy)', helpText: '', required: false, placeholder: '', options: [], order: 0 } });

  const reloadedForms = await listFormsForBusiness(businessId);
  assert.deepEqual(reloadedForms.map((item) => item.name), ['Daily Field Report']);
  assert.deepEqual(reloadedForms[0].trigger, ['after_leaving_job', 'daily', 'on_demand']);
  assert.equal(reloadedForms[0].completionRequirement, 'required');
  assert.deepEqual((await listFormFieldsForBusiness(businessId)).sort((a, b) => a.order - b.order).map((item) => item.id), ['notes-copy', 'notes']);

  const workspace = await call(employeeHandler, 'employee-token', { query: { action: 'forms' } });
  assert.equal(workspace.statusCode, 200);
  const available = workspace.body.available.find((item) => item.id === form.id);
  assert.equal(available.name, 'Daily Field Report');
  assert.equal(available.completionRequirement, 'required');
  assert.equal(available.enforcement, 'advisory');
  assert.deepEqual(available.fields.map((field) => field.id), ['notes-copy', 'notes']);
  assert.deepEqual(Object.keys(available.fields[1]).filter((key) => available.fields[1][key] !== undefined).sort(), ['defaultValue', 'helpText', 'id', 'label', 'options', 'order', 'placeholder', 'required', 'type'].sort());

  const submitted = await call(employeeHandler, 'employee-token', { method: 'POST', query: { action: 'submit' }, body: { formId: form.id, trigger: 'on_demand', responses: [{ fieldId: 'notes', value: 'Installed drainage.' }] } });
  assert.equal(submitted.statusCode, 201);
  assert.equal((await listFormResponsesForBusiness(businessId)).length, 1);

  const detail = await call(employeeHandler, 'employee-token', { query: { action: 'submission', id: submitted.body.submission.id } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.answers[0].value, 'Installed drainage.');

  const reviewed = await call(reviewHandler, 'admin-token', { method: 'PATCH', query: { id: submitted.body.submission.id }, body: { status: 'approved' } });
  assert.equal(reviewed.statusCode, 200);
  assert.equal((await getFormSubmissionForBusiness(businessId, submitted.body.submission.id)).status, 'approved');

  const refreshed = await call(employeeHandler, 'employee-token', { query: { action: 'forms' } });
  assert.equal(refreshed.body.completed.find((item) => item.submissionId === submitted.body.submission.id).status, 'approved');
});