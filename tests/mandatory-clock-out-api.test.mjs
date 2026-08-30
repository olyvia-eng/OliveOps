import test from 'node:test';
import assert from 'node:assert/strict';
import clockingHandler from '../api/clocking.js';
import employeeHandler from '../api/employee.js';
import bootstrapHandler from '../api/bootstrap.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';
import { resolveAfterClockOutForms } from '../api/_lib/mandatoryClockOut.js';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; return this; },
  json(body) { this.body = body; return this; },
});

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  const read = (itemKey) => store.get(key(itemKey.PK, itemKey.SK));
  const field = (token, names = {}) => names[token] ?? token.replace(/^#/, '');

  const conditionPasses = (operation, existing) => {
    const condition = operation.ConditionExpression ?? '';
    const names = operation.ExpressionAttributeNames ?? {};
    const values = operation.ExpressionAttributeValues ?? {};
    if (condition.includes('attribute_not_exists(PK)') && existing) return false;
    if (condition.includes('attribute_exists(PK)') && !existing) return false;

    for (const match of condition.matchAll(/(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)/g)) {
      if (!existing || existing[field(match[1], names)] !== values[match[2]]) return false;
    }
    for (const match of condition.replaceAll(/NOT contains\([^)]*\)/g, '').matchAll(/contains\((#[A-Za-z0-9_]+),\s*(:[A-Za-z0-9_]+)\)/g)) {
      const collection = existing?.[field(match[1], names)];
      if (!collection || !new Set(collection).has(values[match[2]])) return false;
    }
    for (const match of condition.matchAll(/NOT contains\((#[A-Za-z0-9_]+),\s*(:[A-Za-z0-9_]+)\)/g)) {
      const collection = existing?.[field(match[1], names)];
      if (collection && new Set(collection).has(values[match[2]])) return false;
    }
    return true;
  };

  const applyUpdate = (operation, existing) => {
    const names = operation.ExpressionAttributeNames ?? {};
    const values = operation.ExpressionAttributeValues ?? {};
    const expression = operation.UpdateExpression;
    const [setExpression, addExpression] = expression.replace(/^SET\s+/i, '').split(/\s+ADD\s+/i);
    const next = { ...existing };
    for (const assignment of setExpression.split(',').map((part) => part.trim()).filter(Boolean)) {
      const [left, right] = assignment.split('=').map((part) => part.trim());
      next[field(left, names)] = values[right];
    }
    for (const addition of (addExpression ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
      const [left, right] = addition.split(/\s+/);
      const fieldName = field(left, names);
      const value = values[right];
      if (value instanceof Set) next[fieldName] = new Set([...(next[fieldName] ?? []), ...value]);
      else next[fieldName] = Number(next[fieldName] ?? 0) + Number(value);
    }
    return next;
  };

  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: read(input.Key) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && (!prefix || item.SK.startsWith(prefix))) };
    }
    if (type === 'TransactWriteCommand') {
      const operations = input.TransactItems ?? [];
      const failures = operations.map((item) => {
        const operation = item.Put ?? item.Update ?? item.Delete ?? item.ConditionCheck;
        const existing = item.Put ? read(item.Put.Item) : read(operation.Key);
        return conditionPasses(operation, existing) ? { Code: 'None' } : { Code: 'ConditionalCheckFailed' };
      });
      if (failures.some((failure) => failure.Code !== 'None')) {
        throw Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException', CancellationReasons: failures });
      }
      for (const item of operations) {
        if (item.Put) store.set(key(item.Put.Item.PK, item.Put.Item.SK), { ...item.Put.Item });
        if (item.Delete) store.delete(key(item.Delete.Key.PK, item.Delete.Key.SK));
        if (item.Update) store.set(key(item.Update.Key.PK, item.Update.Key.SK), applyUpdate(item.Update, read(item.Update.Key)));
      }
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedEmployee(store, { businessId, employeeId, userId, token }) {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, 'PROFILE'), { PK: pk, SK: 'PROFILE', entityType: 'BUSINESS', businessId, name: businessId, timezone: 'America/Toronto' });
  store.set(key(pk, `USER#${userId}`), { PK: pk, SK: `USER#${userId}`, entityType: 'USER', businessId, userId, name: userId, email: `${userId}@example.com`, role: 'crew_member', active: true, sessionVersion: 0 });
  store.set(key(pk, `EMPLOYEE#${employeeId}`), { PK: pk, SK: `EMPLOYEE#${employeeId}`, entityType: 'EMPLOYEE', businessId, employeeId, id: employeeId, userId, name: employeeId, email: `${userId}@example.com`, role: 'crew_member', active: true });
  await createMobileSessionForUser({ user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role: 'crew_member', employeeId }, accessToken: token, expiresInSeconds: 3600 });
}

function seedActiveShift(store, { businessId, employeeId, entryId, jobIds = [] }) {
  const clockIn = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  store.set(key(`BUSINESS#${businessId}`, `TIME#${entryId}`), {
    PK: `BUSINESS#${businessId}`, SK: `TIME#${entryId}`, entityType: 'TIME_ENTRY', businessId,
    entryId, employeeId, workType: 'non_billable', jobIds, clockIn, breakMinutes: 0, notes: '', status: 'clocked_in',
  });
  store.set(key(`BUSINESS#${businessId}#EMPLOYEE#${employeeId}`, 'ACTIVE_SHIFT'), {
    PK: `BUSINESS#${businessId}#EMPLOYEE#${employeeId}`, SK: 'ACTIVE_SHIFT', entityType: 'ACTIVE_SHIFT',
    businessId, employeeId, activeEntryId: entryId, status: 'active', startedAt: clockIn,
  });
}

function seedForm(store, { businessId, id, completionRequirement = 'required', assignedTo = 'everyone', assignmentValue, requiresApproval = false, acceptedResponse }) {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, `FORM#${id}`), {
    PK: pk, SK: `FORM#${id}`, entityType: 'FORM', businessId, formId: id, name: `Form ${id}`,
    description: `${id} description`, category: 'operations', status: 'active', assignedTo, assignmentValue,
    trigger: ['after_clock_out'], completionRequirement, requiresApproval,
  });
  store.set(key(pk, `FORM_FIELD#${id}-notes`), {
    PK: pk, SK: `FORM_FIELD#${id}-notes`, entityType: 'FORM_FIELD', businessId,
    formFieldId: `${id}-notes`, formId: id, type: acceptedResponse ? 'yes_no' : 'single_line_text', label: 'Notes', required: true, options: [], acceptedResponse, order: 0,
  });
}

async function clockingRequest(token, { method = 'POST', action, body = {}, query = {} }) {
  const res = response();
  await clockingHandler({ method, query: { action, ...query }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

async function formRequest(token, body) {
  const res = response();
  await employeeHandler({ method: 'POST', query: { action: 'submit' }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

async function setup(t, { businessId = 'biz-a', employeeId = 'employee-a', userId = 'user-a', token = 'token-a', forms = [] } = {}) {
  const store = installDdb(t);
  await seedEmployee(store, { businessId, employeeId, userId, token });
  seedActiveShift(store, { businessId, employeeId, entryId: 'entry-a' });
  for (const form of forms) seedForm(store, { businessId, ...form });
  return { store, businessId, employeeId, token, entryId: 'entry-a' };
}

function clockOutBody(entryId, overrides = {}) {
  return {
    entryId,
    requestId: 'request-clock-out',
    idempotencyKey: 'clock-out-key',
    clientOccurredAt: new Date().toISOString(),
    breakMinutes: 10,
    notes: 'Shift complete',
    ...overrides,
  };
}

test('after-clock-out resolution separates requirements and preserves applicable context order', () => {
  const employee = { id: 'employee-a', role: 'crew_member', active: true };
  const divisions = [{ id: 'division-a', name: 'Landscape' }];
  const crews = [{ id: 'crew-a', active: true, memberIds: ['employee-a'], defaultDivisionId: 'division-a' }];
  const jobs = [{ id: 'job-a', title: 'Maple Site', divisionId: 'division-a', assignedEmployeeIds: ['employee-a'], assignedEquipmentIds: ['truck-a'] }];
  const equipment = [{ id: 'truck-a', name: 'Crew Truck - 101' }];
  const form = (id, assignedTo, assignmentValue, completionRequirement = 'required') => ({
    id, name: id, status: 'active', trigger: ['after_clock_out'], assignedTo, assignmentValue, completionRequirement,
  });

  const result = resolveAfterClockOutForms({
    employee, divisions, crews, jobs, equipment,
    forms: [
      form('everyone', 'everyone'),
      form('job', 'job', 'job-a'),
      form('division', 'division', 'division-a'),
      form('equipment', 'equipment', 'truck-a'),
      form('reminder', 'everyone', undefined, 'reminder'),
      form('other-job', 'job', 'job-b'),
      { ...form('inactive', 'everyone'), status: 'draft' },
    ],
  });

  assert.deepEqual(result.requiredForms.map((item) => item.formId), ['everyone', 'job', 'division', 'equipment']);
  assert.deepEqual(result.requiredForms.map((item) => item.order), [0, 1, 2, 3]);
  assert.equal(result.requiredForms.find((item) => item.formId === 'job').context.jobId, 'job-a');
  assert.equal(result.requiredForms.find((item) => item.formId === 'equipment').context.equipmentId, 'truck-a');
  assert.deepEqual(result.reminderForms.map((item) => item.formId), ['reminder']);
});

test('after-clock-out discovery excludes non-operational job assignments', () => {
  const employee = { id: 'employee-a', role: 'crew_member', active: true };
  const jobs = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'].map((status) => ({
    id: `job-${status}`, title: status, status, assignedEmployeeIds: [employee.id], assignedEquipmentIds: [],
  }));
  const forms = jobs.map((job) => ({
    id: `form-${job.status}`, name: job.status, status: 'active', trigger: ['after_clock_out'], assignedTo: 'job', assignmentValue: job.id, completionRequirement: 'required',
  }));

  const result = resolveAfterClockOutForms({ employee, jobs, forms });
  assert.deepEqual(result.requiredForms.map((item) => item.formId), ['form-scheduled', 'form-in_progress']);
});

test('clock-out with no applicable forms preserves the existing immediate response', async (t) => {
  const context = await setup(t);
  const result = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.timeEntry.status, 'clocked_out');
  assert.equal('status' in result.body, false);
  assert.equal([...context.store.values()].some((item) => item.entityType === 'CLOCK_OUT_WORKFLOW'), false);
});

test('reminder-only after-clock-out forms do not block or create a workflow', async (t) => {
  const context = await setup(t, { forms: [{ id: 'reminder', completionRequirement: 'reminder' }] });
  const result = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.timeEntry.status, 'clocked_out');
  assert.equal([...context.store.values()].some((item) => item.entityType === 'CLOCK_OUT_WORKFLOW'), false);
});

test('required forms create one recoverable idempotent workflow and block direct finalization', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const body = clockOutBody(context.entryId);
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body });

  assert.equal(initiated.statusCode, 202);
  assert.equal(initiated.body.status, 'clock_out_pending_required_forms');
  assert.equal(initiated.body.requiredFormCount, 1);
  assert.equal(initiated.body.remainingForms[0].formId, 'required');
  assert.equal(initiated.body.intendedClockOutAt, body.clientOccurredAt);
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}`, `TIME#${context.entryId}`)).status, 'clocked_in');

  const duplicate = await clockingRequest(context.token, { action: 'clock-out', body });
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.body.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  assert.equal([...context.store.values()].filter((item) => item.entityType === 'CLOCK_OUT_WORKFLOW').length, 1);

  const recovered = await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-out' });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  assert.equal(recovered.body.remainingRequiredFormCount, 1);

  const bootstrapResponse = response();
  await bootstrapHandler({ method: 'GET', query: {}, headers: { authorization: `Bearer ${context.token}` } }, bootstrapResponse);
  assert.equal(bootstrapResponse.statusCode, 200);
  assert.equal(bootstrapResponse.body.capabilities.requiredAfterClockOutForms, true);
  assert.equal(bootstrapResponse.body.pendingClockOutWorkflow.workflowOccurrenceId, initiated.body.workflowOccurrenceId);

  const blocked = await clockingRequest(context.token, { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.code, 'required_forms_outstanding');

  const uncorrelatedSubmission = await formRequest(context.token, {
    formId: 'required', trigger: 'after_clock_out', responses: [{ fieldId: 'required-notes', value: 'Missing occurrence' }],
  });
  assert.equal(uncorrelatedSubmission.statusCode, 409);
  assert.equal(uncorrelatedSubmission.body.code, 'workflow_occurrence_required');
});

test('clock-out uses immutable accepted-response and approval rules without approval blocking finalization', async (t) => {
  const context = await setup(t, { forms: [{ id: 'safety', requiresApproval: true, acceptedResponse: { value: 'yes', message: 'Confirm the site is safe.' } }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  const requirement = initiated.body.requiredForms[0];
  assert.equal(requirement.form.requiresApproval, true);
  assert.deepEqual(requirement.form.fields[0].acceptedResponse, { value: 'yes', message: 'Confirm the site is safe.' });

  const sourceForm = context.store.get(key(`BUSINESS#${context.businessId}`, 'FORM#safety'));
  const sourceField = context.store.get(key(`BUSINESS#${context.businessId}`, 'FORM_FIELD#safety-notes'));
  sourceForm.requiresApproval = false;
  sourceField.acceptedResponse = { value: 'no', message: 'Changed later.' };

  const rejected = await formRequest(context.token, {
    formId: 'safety', trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId, responses: [{ fieldId: 'safety-notes', value: 'no' }],
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.code, 'form_response_requirement_failed');

  const accepted = await formRequest(context.token, {
    formId: 'safety', trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId, responses: [{ fieldId: 'safety-notes', value: 'yes' }],
  });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.body.submission.status, 'pending_review');
  assert.equal((await clockingRequest(context.token, { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } })).statusCode, 200);
});

test('canonical submission completes one requirement and finalization preserves the original timestamp idempotently', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const intendedClockOutAt = new Date().toISOString();
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId, { clientOccurredAt: intendedClockOutAt }) });
  const requirement = initiated.body.remainingForms[0];
  const submissionBody = {
    formId: requirement.formId,
    trigger: 'after_clock_out',
    workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId,
    clientSubmissionId: 'required-form-submit-1',
    responses: [{ fieldId: 'required-notes', value: 'Completed safely' }],
  };

  const submitted = await formRequest(context.token, submissionBody);
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.body.submission.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  const replayed = await formRequest(context.token, submissionBody);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.body.replayed, true);

  const recovered = await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-out' });
  assert.equal(recovered.body.completedRequiredFormCount, 1);
  assert.equal(recovered.body.remainingRequiredFormCount, 0);

  const finalized = await clockingRequest(context.token, { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(finalized.statusCode, 200);
  assert.equal(finalized.body.status, 'clock_out_completed');
  assert.equal(finalized.body.timeEntry.clockOut, intendedClockOutAt);
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}`, `TIME#${context.entryId}`)).clockOut, intendedClockOutAt);

  const duplicateFinalize = await clockingRequest(context.token, { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(duplicateFinalize.statusCode, 200);
  assert.equal(duplicateFinalize.body.status, 'clock_out_already_finalized');
  assert.equal([...context.store.values()].filter((item) => item.entityType === 'TIME_ENTRY').length, 1);

  const replayAfterFinalize = await formRequest(context.token, submissionBody);
  assert.equal(replayAfterFinalize.statusCode, 200);
  assert.equal(replayAfterFinalize.body.replayed, true);
});

test('persisted after-clock-out workflow remains completable after its job goes on hold', async (t) => {
  const context = await setup(t, { forms: [{ id: 'job-required', assignedTo: 'job', assignmentValue: 'job-a' }] });
  const pk = `BUSINESS#${context.businessId}`;
  context.store.get(key(pk, `TIME#${context.entryId}`)).jobIds = ['job-a'];
  context.store.set(key(pk, 'JOB#job-a'), {
    PK: pk, SK: 'JOB#job-a', entityType: 'JOB', businessId: context.businessId, jobId: 'job-a', title: 'Job A',
    status: 'in_progress', assignedEmployeeIds: [context.employeeId], assignedEquipmentIds: [],
  });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  assert.equal(initiated.statusCode, 202);
  const requirement = initiated.body.requiredForms[0];
  context.store.get(key(pk, 'JOB#job-a')).status = 'on_hold';

  const submitted = await formRequest(context.token, {
    formId: requirement.formId, trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId, clientSubmissionId: 'closed-job-submit', responses: [{ fieldId: 'job-required-notes', value: 'Done' }],
  });
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.body.submission.jobId, 'job-a');
});

test('multiple required forms are independent while reminder forms remain advisory', async (t) => {
  const context = await setup(t, { forms: [
    { id: 'first' },
    { id: 'second' },
    { id: 'reminder', completionRequirement: 'reminder' },
  ] });
  context.store.set(key(`BUSINESS#${context.businessId}`, 'FORM_SUBMISSION#old-first'), {
    PK: `BUSINESS#${context.businessId}`, SK: 'FORM_SUBMISSION#old-first', entityType: 'FORM_SUBMISSION',
    businessId: context.businessId, formSubmissionId: 'old-first', formId: 'first', employeeId: context.employeeId,
    trigger: 'after_clock_out', workflowOccurrenceId: 'previous-occurrence', workflowRequirementId: 'old-requirement', status: 'submitted',
  });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });

  assert.equal(initiated.body.requiredFormCount, 2);
  assert.equal(initiated.body.completedRequiredFormCount, 0);
  assert.equal(initiated.body.reminderForms.length, 1);
  const [first, second] = initiated.body.requiredForms;
  const firstSubmission = await formRequest(context.token, {
    formId: first.formId, trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: first.requirementId, clientSubmissionId: 'first-submit', responses: [{ fieldId: `${first.formId}-notes`, value: 'First done' }],
  });
  assert.equal(firstSubmission.statusCode, 201);

  const stillBlocked = await clockingRequest(context.token, { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(stillBlocked.statusCode, 409);
  assert.equal(stillBlocked.body.completedRequiredFormCount, 1);
  assert.deepEqual(stillBlocked.body.remainingForms.map((form) => form.formId), ['second']);

  const wrongRequirement = await formRequest(context.token, {
    formId: second.formId, trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: first.requirementId, responses: [{ fieldId: `${second.formId}-notes`, value: 'Wrong link' }],
  });
  assert.equal(wrongRequirement.statusCode, 404);
  assert.equal(wrongRequirement.body.code, 'workflow_requirement_not_found');

  const secondSubmission = await formRequest(context.token, {
    formId: second.formId, trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: second.requirementId, responses: [{ fieldId: `${second.formId}-notes`, value: 'Second done' }],
  });
  assert.equal(secondSubmission.statusCode, 201);
  assert.equal((await clockingRequest(context.token, { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } })).statusCode, 200);
});

test('workflow and submission correlation are tenant scoped and manipulated IDs are rejected', async (t) => {
  const store = installDdb(t);
  await seedEmployee(store, { businessId: 'biz-a', employeeId: 'employee-a', userId: 'user-a', token: 'token-a' });
  seedActiveShift(store, { businessId: 'biz-a', employeeId: 'employee-a', entryId: 'entry-a' });
  seedForm(store, { businessId: 'biz-a', id: 'required' });
  await seedEmployee(store, { businessId: 'biz-b', employeeId: 'employee-b', userId: 'user-b', token: 'token-b' });
  seedForm(store, { businessId: 'biz-b', id: 'required' });

  const initiated = await clockingRequest('token-a', { action: 'clock-out', body: clockOutBody('entry-a') });
  const requirement = initiated.body.requiredForms[0];
  const foreignFinalize = await clockingRequest('token-b', { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(foreignFinalize.statusCode, 404);
  assert.equal(foreignFinalize.body.code, 'clock_out_workflow_not_found');

  const foreignSubmission = await formRequest('token-b', {
    formId: 'required', trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId, responses: [{ fieldId: 'required-notes', value: 'Foreign' }],
  });
  assert.equal(foreignSubmission.statusCode, 404);
  assert.equal(foreignSubmission.body.code, 'clock_out_workflow_not_found');
});
