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

async function seedEmployee(store, { businessId, employeeId, userId, token, role = 'crew_member' }) {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, 'PROFILE'), { PK: pk, SK: 'PROFILE', entityType: 'BUSINESS', businessId, name: businessId, timezone: 'America/Toronto' });
  store.set(key(pk, `USER#${userId}`), { PK: pk, SK: `USER#${userId}`, entityType: 'USER', businessId, userId, name: userId, email: `${userId}@example.com`, role, active: true, sessionVersion: 0 });
  store.set(key(pk, `EMPLOYEE#${employeeId}`), { PK: pk, SK: `EMPLOYEE#${employeeId}`, entityType: 'EMPLOYEE', businessId, employeeId, id: employeeId, userId, name: employeeId, email: `${userId}@example.com`, role, active: true });
  await createMobileSessionForUser({ user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role, employeeId }, accessToken: token, expiresInSeconds: 3600 });
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

function seedForm(store, { businessId, id, completionRequirement = 'required', assignedTo = 'everyone', assignmentValue, requiresApproval = false, acceptedResponse, signature = false }) {
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
  if (signature) store.set(key(pk, `FORM_FIELD#${id}-signature`), {
    PK: pk, SK: `FORM_FIELD#${id}-signature`, entityType: 'FORM_FIELD', businessId,
    formFieldId: `${id}-signature`, formId: id, type: 'signature', label: 'Employee Signature', required: true, options: [], order: 1,
  });
}

function seedSignatureFile(store, context, requirement, clientSubmissionId) {
  const fileId = `${requirement.formId}-signature-file`;
  const pk = `BUSINESS#${context.businessId}`;
  store.set(key(pk, `FILE#${fileId}`), {
    PK: pk, SK: `FILE#${fileId}`, entityType: 'form-signature', businessId: context.businessId, fileId,
    category: 'signature', uploadStatus: 'uploaded', mimeType: 'image/png', sizeBytes: 1024, checksumSha256: 'signature-checksum',
    formId: requirement.formId, fieldId: `${requirement.formId}-signature`, clientSubmissionId,
    workflowOccurrenceId: context.workflowOccurrenceId, workflowRequirementId: requirement.requirementId,
    signerEmployeeId: context.employeeId, signerUserId: 'user-a',
  });
  return fileId;
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

async function setup(t, { businessId = 'biz-a', employeeId = 'employee-a', userId = 'user-a', token = 'token-a', role = 'crew_member', forms = [] } = {}) {
  const store = installDdb(t);
  await seedEmployee(store, { businessId, employeeId, userId, token, role });
  seedActiveShift(store, { businessId, employeeId, entryId: 'entry-a' });
  for (const form of forms) seedForm(store, { businessId, ...form });
  return { store, businessId, employeeId, token, entryId: 'entry-a' };
}

async function setupCorruptPendingWorkflow(t, overrides = {}) {
  const context = await setup(t, { role: 'admin', forms: [{ id: 'required' }], ...overrides });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  assert.equal(initiated.statusCode, 202);
  return { ...context, workflowOccurrenceId: initiated.body.workflowOccurrenceId, requirement: initiated.body.requiredForms[0] };
}

const resolveRequiredFormBlock = (token, employeeId, workflowOccurrenceId, reason = 'Historical mobile submission was not persisted') => clockingRequest(token, {
  action: 'resolve-required-form-block',
  body: { employeeId, workflowOccurrenceId, reason },
});

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

function seedHistoricalSubmission(store, context, workflow, requirement, overrides = {}) {
  const submissionId = overrides.formSubmissionId ?? `historical-${context.businessId}`;
  const businessId = overrides.businessId ?? context.businessId;
  store.set(key(`BUSINESS#${businessId}`, `FORM_SUBMISSION#${submissionId}`), {
    PK: `BUSINESS#${businessId}`,
    SK: `FORM_SUBMISSION#${submissionId}`,
    entityType: 'FORM_SUBMISSION',
    businessId,
    formSubmissionId: submissionId,
    formId: requirement.formId,
    employeeId: context.employeeId,
    trigger: 'after_clock_out',
    workflowOccurrenceId: workflow.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId,
    status: 'submitted',
    ...overrides,
  });
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
  assert.deepEqual(result.body.reminderForms.map((item) => item.formId), ['reminder']);
  assert.equal([...context.store.values()].some((item) => item.entityType === 'CLOCK_OUT_WORKFLOW'), false);
});

test('required forms close the entry first and create one recoverable idempotent workflow', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const body = clockOutBody(context.entryId);
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body });

  assert.equal(initiated.statusCode, 202);
  assert.equal(initiated.body.status, 'clock_out_pending_required_forms');
  assert.equal(initiated.body.requiredFormCount, 1);
  assert.equal(initiated.body.remainingForms[0].formId, 'required');
  assert.equal(initiated.body.intendedClockOutAt, body.clientOccurredAt);
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}`, `TIME#${context.entryId}`)).status, 'clocked_out');
  assert.equal(context.store.has(key(`ACTIVE_SHIFT#${context.businessId}#${context.employeeId}`, 'ACTIVE')), false);

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

test('after-clock-out accepted response and required Signature complete pending-review workflow together', async (t) => {
  const context = await setup(t, { forms: [{
    id: 'signed-safety', requiresApproval: true, signature: true,
    acceptedResponse: { value: 'yes', message: 'Confirm fitness.' },
  }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  const requirement = initiated.body.requiredForms[0];
  const clientSubmissionId = 'after-clock-out-signature-001';
  const fileId = seedSignatureFile(context.store, { ...context, workflowOccurrenceId: initiated.body.workflowOccurrenceId }, requirement, clientSubmissionId);
  const submitted = await formRequest(context.token, {
    formId: requirement.formId, trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId, clientSubmissionId,
    responses: [
      { fieldId: 'signed-safety-notes', value: 'yes' },
      { fieldId: 'signed-safety-signature', fileIds: [fileId] },
    ],
  });
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.body.submission.status, 'pending_review');
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}`, `FILE#${fileId}`)).claimedSubmissionId, submitted.body.submission.id);
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
  assert.equal(submitted.body.clocking.status, 'clock_out_completed');
  assert.equal(submitted.body.clocking.timeEntry.clockOut, intendedClockOutAt);
  const replayed = await formRequest(context.token, submissionBody);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.body.replayed, true);

  const recovered = await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-out' });
  assert.equal(recovered.body.status, 'no_pending_clock_out');
  assert.equal(recovered.body.workflow, null);

  const finalized = await clockingRequest(context.token, { action: 'clock-out-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(finalized.statusCode, 200);
  assert.equal(finalized.body.status, 'clock_out_already_finalized');
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

test('workflow completion counters cannot finalize without durable submission evidence', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  const workflow = context.store.get(key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_WORKFLOW#${initiated.body.workflowOccurrenceId}`));
  const requirement = workflow.requiredForms[0];
  workflow.completedRequirementCount = 1;
  workflow.completedRequirementIds = new Set([requirement.requirementId]);

  const finalized = await clockingRequest(context.token, {
    action: 'clock-out-finalize',
    body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId },
  });
  assert.equal(finalized.statusCode, 409);
  assert.equal(finalized.body.code, 'required_form_submission_evidence_missing');
  assert.equal(workflow.status, 'pending_required_forms');
});

test('failed submission write leaves no evidence and clock-out cannot finalize', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  const requirement = initiated.body.requiredForms[0];
  const installedSend = ddb.send;
  ddb.send = async (command) => {
    if (command?.constructor?.name === 'TransactWriteCommand'
      && command.input?.TransactItems?.some((item) => item.Put?.Item?.entityType === 'FORM_SUBMISSION')) {
      throw new Error('Simulated submission persistence failure');
    }
    return installedSend(command);
  };
  t.after(() => { ddb.send = installedSend; });

  await assert.rejects(() => formRequest(context.token, {
    formId: requirement.formId,
    trigger: 'after_clock_out',
    workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId,
    clientSubmissionId: 'failed-write',
    responses: [{ fieldId: 'required-notes', value: 'Completed' }],
  }), /Simulated submission persistence failure/);

  const workflow = context.store.get(key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_WORKFLOW#${initiated.body.workflowOccurrenceId}`));
  assert.equal(workflow.completedRequirementCount, 0);
  assert.equal([...context.store.values()].some((item) => item.entityType === 'FORM_SUBMISSION'), false);
  const finalized = await clockingRequest(context.token, {
    action: 'clock-out-finalize',
    body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId },
  });
  assert.equal(finalized.statusCode, 409);
  assert.equal(finalized.body.code, 'required_forms_outstanding');
});

test('persisted after-clock-out snapshot remains completable after its live form is deleted and job goes on hold', async (t) => {
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
  context.store.delete(key(pk, 'FORM#job-required'));
  context.store.delete(key(pk, 'FORM_FIELD#job-required-notes'));

  const submitted = await formRequest(context.token, {
    formId: requirement.formId, trigger: 'after_clock_out', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId, clientSubmissionId: 'closed-job-submit', responses: [{ fieldId: 'job-required-notes', value: 'Done' }],
  });
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.body.submission.jobId, 'job-a');
});

for (const scenario of [
  { name: 'submitted evidence clears a stale pointer', status: 'submitted', clears: true },
  { name: 'pending-review evidence clears a stale pointer during bootstrap', status: 'pending_review', surface: 'bootstrap', clears: true },
  { name: 'approved evidence clears a stale pointer', status: 'approved', clears: true },
  { name: 'missing evidence preserves a genuine pending workflow', omitSubmission: true, clears: false },
  { name: 'rejected evidence preserves a genuine pending workflow', status: 'rejected', clears: false },
  { name: 'a different occurrence cannot satisfy the workflow', workflowOccurrenceId: 'other-occurrence', clears: false },
  { name: 'a different requirement cannot satisfy the workflow', workflowRequirementId: 'other-requirement', clears: false },
  { name: 'legacy evidence missing occurrence correlation cannot satisfy the workflow', workflowOccurrenceId: null, clears: false },
  { name: 'legacy evidence missing requirement correlation cannot satisfy the workflow', workflowRequirementId: null, clears: false },
  { name: 'a different employee cannot satisfy the workflow', employeeId: 'other-employee', clears: false },
  { name: 'a different tenant cannot satisfy the workflow', businessId: 'other-business', clears: false },
  { name: 'an open Time Entry cannot be reconciled as completed', timeEntryStatus: 'clocked_in', clears: false },
]) {
  test(`stale clock-out reconciliation: ${scenario.name}`, async (t) => {
    const context = await setup(t, { forms: [{ id: 'required' }] });
    const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
    const requirement = initiated.body.requiredForms[0];
    if (!scenario.omitSubmission) {
      seedHistoricalSubmission(context.store, context, initiated.body, requirement, {
        ...(scenario.status ? { status: scenario.status } : {}),
        ...(Object.prototype.hasOwnProperty.call(scenario, 'workflowOccurrenceId') ? { workflowOccurrenceId: scenario.workflowOccurrenceId } : {}),
        ...(Object.prototype.hasOwnProperty.call(scenario, 'workflowRequirementId') ? { workflowRequirementId: scenario.workflowRequirementId } : {}),
        ...(scenario.employeeId ? { employeeId: scenario.employeeId } : {}),
        ...(scenario.businessId ? { businessId: scenario.businessId } : {}),
      });
    }
    if (scenario.timeEntryStatus) {
      context.store.get(key(`BUSINESS#${context.businessId}`, `TIME#${context.entryId}`)).status = scenario.timeEntryStatus;
    }

    const recovered = scenario.surface === 'bootstrap'
      ? response()
      : await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-out' });
    if (scenario.surface === 'bootstrap') {
      await bootstrapHandler({ method: 'GET', query: {}, headers: { authorization: `Bearer ${context.token}` } }, recovered);
    }
    if (scenario.clears) {
      if (scenario.surface === 'bootstrap') assert.equal(recovered.body.pendingClockOutWorkflow, null);
      else {
        assert.equal(recovered.body.status, 'no_pending_clock_out');
        assert.equal(recovered.body.workflow, null);
      }
      assert.equal(context.store.has(key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_PENDING#EMPLOYEE#${context.employeeId}`)), false);
    } else {
      assert.equal(recovered.body.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
      assert.equal(recovered.body.remainingRequiredFormCount, 1);
    }
  });
}

test('finalized workflow with exact durable evidence repairs only its matching stale pointer', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  const requirement = initiated.body.requiredForms[0];
  seedHistoricalSubmission(context.store, context, initiated.body, requirement);
  const workflow = context.store.get(key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_WORKFLOW#${initiated.body.workflowOccurrenceId}`));
  workflow.status = 'finalized';
  workflow.completedRequirementCount = 1;
  workflow.completedRequirementIds = new Set([requirement.requirementId]);

  const recovered = await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-out' });
  assert.equal(recovered.body.status, 'no_pending_clock_out');
  assert.equal(context.store.has(key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_PENDING#EMPLOYEE#${context.employeeId}`)), false);
  assert.equal(workflow.status, 'finalized');
});

test('admin bootstrap returns mandatory submission after its source form is deleted', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-out', body: clockOutBody(context.entryId) });
  const requirement = initiated.body.requiredForms[0];
  const submitted = await formRequest(context.token, {
    formId: requirement.formId,
    trigger: 'after_clock_out',
    workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId,
    clientSubmissionId: 'historical-admin-query',
    responses: [{ fieldId: 'required-notes', value: 'Completed' }],
  });
  assert.equal(submitted.statusCode, 201);
  context.store.delete(key(`BUSINESS#${context.businessId}`, 'FORM#required'));
  context.store.delete(key(`BUSINESS#${context.businessId}`, 'FORM_FIELD#required-notes'));

  const bootstrapResponse = response();
  await bootstrapHandler({ method: 'GET', query: {}, headers: { authorization: `Bearer ${context.token}` } }, bootstrapResponse);
  const historical = bootstrapResponse.body.formSubmissions.find((item) => item.id === submitted.body.submission.id);
  assert.equal(historical.employeeId, context.employeeId);
  assert.equal(historical.formId, requirement.formId);
  assert.equal(historical.trigger, 'after_clock_out');
  assert.equal(historical.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  assert.equal(historical.workflowRequirementId, requirement.requirementId);
});

for (const role of ['owner', 'admin']) {
  test(`${role} can resolve one exact corrupted pending workflow`, async (t) => {
    const context = await setupCorruptPendingWorkflow(t, { role });
    const resolved = await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId);
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.body.status, 'clock_out_administratively_resolved');
    assert.equal(resolved.body.workflow.status, 'administratively_resolved');
  });
}

test('crew member and foreman cannot administratively resolve a workflow', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  for (const role of ['crew_member', 'foreman']) {
    const token = `token-${role}`;
    await seedEmployee(context.store, {
      businessId: context.businessId, employeeId: `employee-${role}`, userId: `user-${role}`, token, role,
    });
    const denied = await resolveRequiredFormBlock(token, context.employeeId, context.workflowOccurrenceId);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.code, 'clock_out_admin_resolution_forbidden');
  }
});

test('cross-tenant administrative resolution is rejected', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  await seedEmployee(context.store, { businessId: 'biz-b', employeeId: 'employee-b', userId: 'admin-b', token: 'token-b', role: 'admin' });
  const rejected = await resolveRequiredFormBlock('token-b', context.employeeId, context.workflowOccurrenceId);
  assert.equal(rejected.statusCode, 404);
  assert.equal(rejected.body.code, 'clock_out_workflow_not_found');
});

test('wrong workflow occurrence is rejected', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  const rejected = await resolveRequiredFormBlock(context.token, context.employeeId, 'wrong-occurrence');
  assert.equal(rejected.statusCode, 404);
  assert.equal(rejected.body.code, 'clock_out_workflow_not_found');
});

test('already administratively resolved workflow is idempotent', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  assert.equal((await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId)).statusCode, 200);
  const duplicate = await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId, 'Duplicate request');
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.status, 'clock_out_already_administratively_resolved');
  assert.equal([...context.store.values()].filter((item) => item.action === 'mandatory_clock_out_administratively_resolved').length, 1);
});

test('administrative resolution cannot clear a different pending pointer', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  const pointerKey = key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_PENDING#EMPLOYEE#${context.employeeId}`);
  context.store.get(pointerKey).workflowOccurrenceId = 'different-occurrence';
  const rejected = await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId);
  assert.equal(rejected.statusCode, 409);
  assert.equal(context.store.get(pointerKey).workflowOccurrenceId, 'different-occurrence');
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_WORKFLOW#${context.workflowOccurrenceId}`)).status, 'pending_required_forms');
});

test('open associated Time Entry prevents unsafe administrative resolution', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  context.store.get(key(`BUSINESS#${context.businessId}`, `TIME#${context.entryId}`)).status = 'clocked_in';
  const rejected = await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId);
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.body.code, 'clock_out_admin_resolution_conflict');
});

test('administrative resolution persists workflow and audit metadata', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  const reason = 'Confirmed historical mobile persistence failure with operations manager';
  await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId, reason);
  const workflow = context.store.get(key(`BUSINESS#${context.businessId}`, `CLOCK_OUT_WORKFLOW#${context.workflowOccurrenceId}`));
  assert.equal(workflow.resolutionType, 'admin_override_missing_submission');
  assert.equal(workflow.resolvedBy, 'user-a');
  assert.equal(workflow.resolutionReason, reason);
  assert.ok(workflow.resolvedAt);
  assert.equal(workflow.originalWorkflowOccurrenceId, context.workflowOccurrenceId);
  assert.deepEqual(workflow.originalRequirementIds, [context.requirement.requirementId]);
  assert.equal(workflow.requiredForms[0].requirementId, context.requirement.requirementId);
  const audit = [...context.store.values()].find((item) => item.action === 'mandatory_clock_out_administratively_resolved');
  assert.equal(audit.actorUserId, 'user-a');
  assert.equal(audit.metadata.resolutionType, 'admin_override_missing_submission');
  assert.equal(audit.metadata.reason, reason);
  assert.deepEqual(audit.metadata.originalRequirementIds, [context.requirement.requirementId]);
});

test('administrative resolution creates no form submission', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId);
  assert.equal([...context.store.values()].some((item) => item.entityType === 'FORM_SUBMISSION'), false);
});

test('bootstrap after administrative resolution has no pending mandatory clock-out workflow', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId);
  const bootstrapResponse = response();
  await bootstrapHandler({ method: 'GET', query: {}, headers: { authorization: `Bearer ${context.token}` } }, bootstrapResponse);
  assert.equal(bootstrapResponse.statusCode, 200);
  assert.equal(bootstrapResponse.body.pendingClockOutWorkflow, null);
});

test('employee can clock in normally after administrative resolution', async (t) => {
  const context = await setupCorruptPendingWorkflow(t);
  await resolveRequiredFormBlock(context.token, context.employeeId, context.workflowOccurrenceId);
  const clockedIn = await clockingRequest(context.token, {
    action: 'clock-in',
    body: {
      employeeId: context.employeeId,
      workType: 'non_billable',
      unbillableCategoryId: 'training',
      requestId: 'post-resolution-clock-in',
      idempotencyKey: 'post-resolution-clock-in',
    },
  });
  assert.notEqual(clockedIn.body.code, 'pending_clock_out_requires_finalization');
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
