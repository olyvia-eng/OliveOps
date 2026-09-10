import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import dataHandler from '../api/data.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';
import { getMissingRequiredFormsForTrigger } from '../api/_lib/formsEngine.js';
import { DEFAULT_FORM_STATUS_FILTER, filterFormsForList } from '../src/utils/formListFilters.js';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(value) { this.body = value; return this; } });

function installDdb(t) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const input = command.input;
    if (command.constructor.name === 'PutCommand') {
      const itemKey = key(input.Item.PK, input.Item.SK);
      if (input.ConditionExpression?.includes('attribute_exists') && !store.has(itemKey)) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
      store.set(itemKey, structuredClone(input.Item));
      return {};
    }
    if (command.constructor.name === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (command.constructor.name === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    return originalSend(command);
  };
  t.after(() => { ddb.send = originalSend; });
  return store;
}

async function createSession(store, { businessId, id, role, token }) {
  const pk = `BUSINESS#${businessId}`;
  const user = { id, businessId, name: id, email: `${id}@example.ca`, role, active: true, sessionVersion: 0 };
  store.set(key(pk, `USER#${id}`), { PK: pk, SK: `USER#${id}`, entityType: 'USER', userId: id, ...user });
  await createMobileSessionForUser({ user, accessToken: token, expiresInSeconds: 3600 });
}

async function call(token, method, entity, { id, data } = {}) {
  const res = response();
  await dataHandler({ method, query: { entity, ...(id ? { id } : {}) }, headers: { authorization: `Bearer ${token}` }, ...(data ? { body: { data } } : {}) }, res);
  return res;
}

const formRecord = (id, status) => ({
  id, name: `${status} form`, description: 'Lifecycle test', category: 'operations', status,
  assignedTo: 'everyone', assignmentValue: '', trigger: ['before_clock_in'],
  deliveryRule: { type: 'before_clock_in', frequency: 'every_occurrence', completionBehavior: 'blocking', schedule: null, allowManualAccess: false },
  deliveryRuleVersion: 1, completionRequirement: 'required', requiresApproval: false, division: '',
  createdByUserId: 'owner', createdAt: '2026-09-10T10:00:00.000Z', updatedAt: '2026-09-10T10:00:00.000Z',
});

test('owner/admin archive persists without deleting forms or historical submissions, unauthorized roles cannot archive, and restore returns to Draft', async (t) => {
  const store = installDdb(t);
  const businessId = 'archive-business';
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, 'PROFILE'), { PK: pk, SK: 'PROFILE', businessId, timezone: 'America/Toronto' });
  for (const session of [
    { id: 'owner', role: 'owner', token: 'owner-archive-token' },
    { id: 'admin', role: 'admin', token: 'admin-archive-token' },
    { id: 'foreman', role: 'foreman', token: 'foreman-archive-token' },
  ]) await createSession(store, { businessId, ...session });

  for (const form of [formRecord('owner-form', 'active'), formRecord('admin-form', 'active')]) {
    store.set(key(pk, `FORM#${form.id}`), { PK: pk, SK: `FORM#${form.id}`, entityType: 'FORM', businessId, formId: form.id, ...form });
  }
  const submission = { PK: pk, SK: 'FORM_SUBMISSION#historical', entityType: 'FORM_SUBMISSION', businessId, formSubmissionId: 'historical', formId: 'owner-form', employeeId: 'employee-a', status: 'submitted', submittedAt: '2026-09-09T10:00:00.000Z' };
  store.set(key(pk, submission.SK), structuredClone(submission));

  const ownerArchive = await call('owner-archive-token', 'PATCH', 'forms', { id: 'owner-form', data: { status: 'archived', updatedAt: '2026-09-10T11:00:00.000Z' } });
  assert.equal(ownerArchive.statusCode, 200);
  assert.equal(store.get(key(pk, 'FORM#owner-form')).status, 'archived');
  assert.deepEqual(store.get(key(pk, submission.SK)), submission);

  const history = await call('owner-archive-token', 'GET', 'form-submissions');
  assert.equal(history.statusCode, 200);
  assert.equal(history.body.items.some((item) => item.id === 'historical'), true);

  const restored = await call('owner-archive-token', 'PATCH', 'forms', { id: 'owner-form', data: { status: 'draft', updatedAt: '2026-09-10T12:00:00.000Z' } });
  assert.equal(restored.statusCode, 200);
  assert.equal(store.get(key(pk, 'FORM#owner-form')).status, 'draft');

  const adminArchive = await call('admin-archive-token', 'PATCH', 'forms', { id: 'admin-form', data: { status: 'archived' } });
  assert.equal(adminArchive.statusCode, 200);
  assert.equal(store.get(key(pk, 'FORM#admin-form')).status, 'archived');

  const unauthorized = await call('foreman-archive-token', 'PATCH', 'forms', { id: 'owner-form', data: { status: 'archived' } });
  assert.equal(unauthorized.statusCode, 403);
  assert.equal(store.get(key(pk, 'FORM#owner-form')).status, 'draft');
});

test('Forms list defaults to Active and Draft while Archived and All remain explicit', () => {
  const forms = [formRecord('active', 'active'), formRecord('draft', 'draft'), formRecord('archived', 'archived')];
  assert.equal(DEFAULT_FORM_STATUS_FILTER, 'operational');
  assert.deepEqual(filterFormsForList(forms).map((form) => form.id), ['active', 'draft']);
  assert.deepEqual(filterFormsForList(forms, { status: 'archived' }).map((form) => form.id), ['archived']);
  assert.deepEqual(filterFormsForList(forms, { status: 'all' }).map((form) => form.id), ['active', 'draft', 'archived']);
});

test('future required-form discovery excludes archived definitions', () => {
  const active = formRecord('active', 'active');
  const archived = formRecord('archived', 'archived');
  const missing = getMissingRequiredFormsForTrigger({ forms: [active, archived], trigger: 'before_clock_in', employee: { id: 'employee-a', role: 'crew_member', active: true }, instant: new Date('2026-09-10T12:00:00.000Z'), timeZone: 'America/Toronto' });
  assert.deepEqual(missing.map((form) => form.id), ['active']);
});

test('Forms UI waits for persisted archive, reports success, returns to the filtered list, and restores explicitly', async () => {
  const source = await readFile(new URL('../src/pages/operations/FormsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const archived = await updateForm\(selectedForm\.id, \{ status: 'archived' \}\)/);
  assert.match(source, /if \(!archived\) return;[\s\S]*setActiveTab\('forms'\);[\s\S]*archived\. It will not be assigned to future workflows/);
  assert.match(source, /useState<FormListStatusFilter>\(DEFAULT_FORM_STATUS_FILTER\)/);
  for (const option of ['Active &amp; Draft', 'Active', 'Draft', 'Archived', 'All']) assert.match(source, new RegExp(`>${option}<`));
  assert.match(source, /<fieldset disabled=\{archivedSelectedForm\}/);
  assert.match(source, /Restore as Draft/);
  assert.match(source, /updateForm\(selectedForm\.id, \{ status: 'draft' \}\)/);
  assert.doesNotMatch(source, /deleteSelectedForm|deleteForm\(selectedForm\.id\)/);
});
