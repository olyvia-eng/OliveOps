import test from 'node:test';
import assert from 'node:assert/strict';
import clockingHandler from '../api/clocking.js';
import employeeHandler from '../api/employee.js';
import bootstrapHandler from '../api/bootstrap.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { ddb } from '../api/_lib/db.js';
import { resolveBeforeClockInForms } from '../api/_lib/mandatoryClockIn.js';

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
    const [setExpression, addExpression] = operation.UpdateExpression.replace(/^SET\s+/i, '').split(/\s+ADD\s+/i);
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

async function seedEmployee(store, { businessId, employeeId, userId, token, active = true }) {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, 'PROFILE'), { PK: pk, SK: 'PROFILE', entityType: 'BUSINESS', businessId, name: businessId, timezone: 'America/Toronto' });
  store.set(key(pk, `USER#${userId}`), { PK: pk, SK: `USER#${userId}`, entityType: 'USER', businessId, userId, name: userId, email: `${userId}@example.com`, role: 'crew_member', active: true, sessionVersion: 0 });
  store.set(key(pk, `EMPLOYEE#${employeeId}`), { PK: pk, SK: `EMPLOYEE#${employeeId}`, entityType: 'EMPLOYEE', businessId, employeeId, id: employeeId, userId, name: employeeId, email: `${userId}@example.com`, role: 'crew_member', active });
  await createMobileSessionForUser({ user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role: 'crew_member', employeeId }, accessToken: token, expiresInSeconds: 3600 });
}

function seedForm(store, { businessId, id, trigger = ['before_clock_in'], completionRequirement = 'required', assignedTo = 'everyone', assignmentValue, signature = false }) {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, `FORM#${id}`), {
    PK: pk, SK: `FORM#${id}`, entityType: 'FORM', businessId, formId: id, name: `Form ${id}`,
    description: `${id} description`, category: 'operations', status: 'active', assignedTo, assignmentValue,
    trigger, completionRequirement,
  });
  store.set(key(pk, `FORM_FIELD#${id}-notes`), {
    PK: pk, SK: `FORM_FIELD#${id}-notes`, entityType: 'FORM_FIELD', businessId,
    formFieldId: `${id}-notes`, formId: id, type: signature ? 'signature' : 'single_line_text', label: signature ? 'Employee Signature' : 'Notes', required: true, options: [], order: 0,
  });
}

function seedSignatureFile(store, context, requirement, clientSubmissionId) {
  const fileId = `${requirement.formId}-signature-file`;
  const pk = `BUSINESS#${context.businessId}`;
  store.set(key(pk, `FILE#${fileId}`), {
    PK: pk, SK: `FILE#${fileId}`, entityType: 'form-signature', businessId: context.businessId, fileId,
    category: 'signature', uploadStatus: 'uploaded', mimeType: 'image/png', sizeBytes: 1024, checksumSha256: 'signature-checksum',
    formId: requirement.formId, fieldId: `${requirement.formId}-notes`, clientSubmissionId,
    workflowOccurrenceId: context.workflowOccurrenceId, workflowRequirementId: requirement.requirementId,
    signerEmployeeId: context.employeeId, signerUserId: 'user-a',
  });
  return fileId;
}

function seedJob(store, { businessId, id, status, employeeId, operationalWorkAreas }) {
  const pk = `BUSINESS#${businessId}`;
  store.set(key(pk, `JOB#${id}`), {
    PK: pk, SK: `JOB#${id}`, entityType: 'JOB', businessId, jobId: id, title: id,
    status, assignedEmployeeIds: [employeeId], assignedEquipmentIds: [],
    operationalWorkAreas,
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

async function setup(t, { businessId = 'biz-a', employeeId = 'employee-a', userId = 'user-a', token = 'token-a', forms = [], active = true } = {}) {
  const store = installDdb(t);
  await seedEmployee(store, { businessId, employeeId, userId, token, active });
  for (const form of forms) seedForm(store, { businessId, ...form });
  return { store, businessId, employeeId, token };
}

function clockInBody(employeeId, overrides = {}) {
  return {
    employeeId,
    workType: 'drive_time',
    jobIds: [],
    requestId: 'request-clock-in',
    idempotencyKey: 'clock-in-key',
    clientOccurredAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function workflowSubmission(workflow, requirement, overrides = {}) {
  return {
    formId: requirement.formId,
    trigger: 'before_clock_in',
    workflowOccurrenceId: workflow.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId,
    clientSubmissionId: `submit-${requirement.formId}`,
    responses: [{ fieldId: `${requirement.formId}-notes`, value: 'Ready for shift' }],
    ...overrides,
  };
}

test('before-clock-in resolution separates Required and Reminder forms without enforcing before-starting-job', () => {
  const employee = { id: 'employee-a', role: 'crew_member', active: true };
  const result = resolveBeforeClockInForms({
    employee,
    forms: [
      { id: 'required', name: 'Required', status: 'active', trigger: ['before_clock_in'], assignedTo: 'everyone', completionRequirement: 'required' },
      { id: 'reminder', name: 'Reminder', status: 'active', trigger: ['before_clock_in'], assignedTo: 'everyone', completionRequirement: 'reminder' },
      { id: 'job-start', name: 'Job Start', status: 'active', trigger: ['before_starting_job'], assignedTo: 'everyone', completionRequirement: 'required' },
    ],
  });
  assert.deepEqual(result.requiredForms.map((item) => item.formId), ['required']);
  assert.deepEqual(result.reminderForms.map((item) => item.formId), ['reminder']);
  assert.match(result.requiredForms[0].requirementId, /^requirement-[a-f0-9]{24}$/);
});

test('before-clock-in discovery excludes non-operational job assignments', () => {
  const employee = { id: 'employee-a', role: 'crew_member', active: true };
  const jobs = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'].map((status) => ({
    id: `job-${status}`, title: status, status, assignedEmployeeIds: [employee.id], assignedEquipmentIds: [],
  }));
  const forms = jobs.map((job) => ({
    id: `form-${job.status}`, name: job.status, status: 'active', trigger: ['before_clock_in'], assignedTo: 'job', assignmentValue: job.id, completionRequirement: 'required',
  }));

  const result = resolveBeforeClockInForms({ employee, jobs, forms });
  assert.deepEqual(result.requiredForms.map((item) => item.formId), ['form-scheduled', 'form-in_progress']);
});

test('no applicable forms preserves normal clock-in and no-pending recovery contract', async (t) => {
  const context = await setup(t);
  const noPending = await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-in' });
  assert.deepEqual(noPending.body, { ok: true, blocked: false, status: 'no_pending_clock_in', workflow: null });

  const result = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal('status' in result.body, false);
  assert.equal(result.body.timeEntry.status, 'clocked_in');
  assert.ok(context.store.get(key(`BUSINESS#${context.businessId}`, `TIME#${result.body.timeEntry.id}`)));
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}#EMPLOYEE#${context.employeeId}`, 'ACTIVE_SHIFT')).activeEntryId, result.body.timeEntry.id);
});

test('Reminder Only and before-starting-job Required forms remain non-blocking', async (t) => {
  const context = await setup(t, { forms: [
    { id: 'reminder', completionRequirement: 'reminder' },
    { id: 'job-start', trigger: ['before_starting_job'], completionRequirement: 'required' },
  ] });
  const result = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.timeEntry.status, 'clocked_in');
  assert.equal([...context.store.values()].some((item) => item.entityType === 'CLOCK_IN_WORKFLOW'), false);
});

test('Required form creates recoverable pending workflow without time entry or active shift', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const body = clockInBody(context.employeeId);
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body });

  assert.equal(initiated.statusCode, 202);
  assert.equal(initiated.body.ok, true);
  assert.equal(initiated.body.blocked, true);
  assert.equal(initiated.body.status, 'clock_in_pending_required_forms');
  assert.equal(initiated.body.requiredFormCount, 1);
  assert.equal(initiated.body.completedRequiredFormCount, 0);
  assert.equal(initiated.body.remainingRequiredFormCount, 1);
  assert.match(initiated.body.requiredForms[0].requirementId, /^requirement-[a-f0-9]{24}$/);
  assert.equal(initiated.body.clockInIntent.workType, 'drive_time');
  assert.equal([...context.store.values()].some((item) => item.entityType === 'TIME_ENTRY'), false);
  assert.equal([...context.store.values()].some((item) => item.entityType === 'ACTIVE_SHIFT'), false);

  const recovered = await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-in' });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  assert.equal(recovered.body.remainingForms[0].requirementId, initiated.body.remainingForms[0].requirementId);

  const duplicate = await clockingRequest(context.token, { action: 'clock-in', body });
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.body.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  assert.equal([...context.store.values()].filter((item) => item.entityType === 'CLOCK_IN_WORKFLOW').length, 1);
});

test('Required workflow persists one complete immutable form snapshot across every recovery response', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  const requirement = initiated.body.requiredForms[0];
  const snapshot = requirement.form;

  assert.deepEqual(requirement, {
    requirementId: requirement.requirementId,
    formId: 'required',
    title: 'Form required',
    description: 'required description',
    category: 'operations',
    trigger: 'before_clock_in',
    order: 0,
    context: {
      jobId: undefined,
      jobName: undefined,
      equipmentId: undefined,
      equipmentName: undefined,
      divisionId: undefined,
      divisionName: undefined,
    },
    completionRequirement: 'required',
    form: snapshot,
    completed: false,
  });
  assert.deepEqual(snapshot, {
    id: 'required',
    name: 'Form required',
    description: 'required description',
    category: 'operations',
    trigger: 'before_clock_in',
    required: true,
    completionRequirement: 'required',
    requiresApproval: false,
    enforcement: 'blocking',
    context: requirement.context,
    fields: [{
      id: 'required-notes',
      type: 'single_line_text',
      label: 'Notes',
      helpText: '',
      required: true,
      defaultValue: '',
      placeholder: '',
      options: [],
      acceptedResponse: undefined,
      order: 0,
      choices: undefined,
    }],
    submissionState: { completed: false },
  });

  const sourceForm = context.store.get(key(`BUSINESS#${context.businessId}`, 'FORM#required'));
  sourceForm.name = 'Changed after workflow creation';
  sourceForm.status = 'inactive';
  const sourceField = context.store.get(key(`BUSINESS#${context.businessId}`, 'FORM_FIELD#required-notes'));
  sourceField.label = 'Changed field label';
  sourceField.required = false;

  const recovered = await clockingRequest(context.token, { method: 'GET', action: 'pending-clock-in' });
  assert.deepEqual(recovered.body.requiredForms[0].form, snapshot);
  assert.deepEqual(recovered.body.remainingForms[0].form, snapshot);

  const bootstrapResponse = response();
  await bootstrapHandler({ method: 'GET', query: {}, headers: { authorization: `Bearer ${context.token}` } }, bootstrapResponse);
  assert.deepEqual(bootstrapResponse.body.pendingClockInWorkflow.requiredForms[0].form, snapshot);
  assert.deepEqual(bootstrapResponse.body.pendingClockInWorkflow.remainingForms[0].form, snapshot);

  const outstanding = await clockingRequest(context.token, {
    action: 'clock-in-finalize',
    body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId },
  });
  assert.equal(outstanding.statusCode, 409);
  assert.deepEqual(outstanding.body.requiredForms[0].form, snapshot);
  assert.deepEqual(outstanding.body.remainingForms[0].form, snapshot);

  const submitted = await formRequest(context.token, workflowSubmission(initiated.body, requirement));
  assert.equal(submitted.statusCode, 201);
});

test('Required submission rejects missing, wrong occurrence, and wrong requirement correlation', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  const requirement = initiated.body.requiredForms[0];

  const missingOccurrence = await formRequest(context.token, {
    formId: requirement.formId, trigger: 'before_clock_in', workflowRequirementId: requirement.requirementId,
    responses: [{ fieldId: 'required-notes', value: 'Ready' }],
  });
  assert.equal(missingOccurrence.statusCode, 409);
  assert.equal(missingOccurrence.body.code, 'workflow_occurrence_required');

  const missingRequirement = await formRequest(context.token, {
    formId: requirement.formId, trigger: 'before_clock_in', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    responses: [{ fieldId: 'required-notes', value: 'Ready' }],
  });
  assert.equal(missingRequirement.statusCode, 400);
  assert.equal(missingRequirement.body.code, 'workflow_requirement_required');

  const wrongOccurrence = await formRequest(context.token, workflowSubmission(initiated.body, requirement, { workflowOccurrenceId: 'clock-in-foreign' }));
  assert.equal(wrongOccurrence.statusCode, 404);
  assert.equal(wrongOccurrence.body.code, 'clock_in_workflow_not_found');

  const wrongRequirement = await formRequest(context.token, workflowSubmission(initiated.body, requirement, { workflowRequirementId: 'requirement-wrong', clientSubmissionId: 'wrong-requirement' }));
  assert.equal(wrongRequirement.statusCode, 404);
  assert.equal(wrongRequirement.body.code, 'workflow_requirement_not_found');
});

test('submission atomically completes requirement, replays idempotently, and finalization uses current server time', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiationTimestamp = new Date(Date.now() - 5 * 60_000).toISOString();
  const initiated = await clockingRequest(context.token, {
    action: 'clock-in', body: clockInBody(context.employeeId, { clientOccurredAt: initiationTimestamp }),
  });
  const requirement = initiated.body.requiredForms[0];
  const submissionBody = workflowSubmission(initiated.body, requirement);

  const submitted = await formRequest(context.token, submissionBody);
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.body.submission.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  const workflowRecord = context.store.get(key(`BUSINESS#${context.businessId}`, `CLOCK_IN_WORKFLOW#${initiated.body.workflowOccurrenceId}`));
  assert.equal(workflowRecord.completedRequirementCount, 1);
  assert.equal(new Set(workflowRecord.completedRequirementIds).has(requirement.requirementId), true);

  const replayed = await formRequest(context.token, submissionBody);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}`, `CLOCK_IN_WORKFLOW#${initiated.body.workflowOccurrenceId}`)).completedRequirementCount, 1);

  const finalized = await clockingRequest(context.token, { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(finalized.statusCode, 200);
  assert.equal(finalized.body.status, 'clock_in_completed');
  assert.notEqual(finalized.body.timeEntry.clockIn, initiationTimestamp);
  assert.ok(Date.parse(finalized.body.timeEntry.clockIn) > Date.parse(initiationTimestamp));
  assert.equal(finalized.body.timeEntry.status, 'clocked_in');

  const duplicateFinalize = await clockingRequest(context.token, { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(duplicateFinalize.statusCode, 200);
  assert.equal(duplicateFinalize.body.status, 'clock_in_already_finalized');
  assert.equal(duplicateFinalize.body.timeEntry.id, finalized.body.timeEntry.id);
  assert.equal([...context.store.values()].filter((item) => item.entityType === 'TIME_ENTRY').length, 1);
});

test('required before-clock-in Signature claims its artifact before workflow finalization', async (t) => {
  const context = await setup(t, { forms: [{ id: 'signature-required', signature: true }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  const requirement = initiated.body.requiredForms[0];
  const clientSubmissionId = 'before-clock-in-signature-001';
  const fileId = seedSignatureFile(context.store, { ...context, workflowOccurrenceId: initiated.body.workflowOccurrenceId }, requirement, clientSubmissionId);
  const submitted = await formRequest(context.token, {
    formId: requirement.formId, trigger: 'before_clock_in', workflowOccurrenceId: initiated.body.workflowOccurrenceId,
    workflowRequirementId: requirement.requirementId, clientSubmissionId,
    responses: [{ fieldId: 'signature-required-notes', fileIds: [fileId] }],
  });
  assert.equal(submitted.statusCode, 201);
  assert.equal(context.store.get(key(`BUSINESS#${context.businessId}`, `FILE#${fileId}`)).claimedSubmissionId, submitted.body.submission.id);
  assert.equal((await clockingRequest(context.token, { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } })).statusCode, 200);
});

test('mandatory before-clock-in finalization exposes persisted Work Area fields through bootstrap', async (t) => {
  const context = await setup(t, { forms: [{ id: 'work-area-required' }] });
  seedJob(context.store, {
    businessId: context.businessId,
    id: 'job-a',
    status: 'scheduled',
    employeeId: context.employeeId,
    operationalWorkAreas: [{ id: 'area-excavation', name: 'Excavation', status: 'in_progress', sortOrder: 0 }],
  });
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId, {
    workType: 'job', jobIds: ['job-a'], workAreaId: 'area-excavation', clockingContractVersion: 2,
  }) });
  const requirement = initiated.body.requiredForms[0];
  assert.equal((await formRequest(context.token, workflowSubmission(initiated.body, requirement))).statusCode, 201);
  const finalized = await clockingRequest(context.token, { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(finalized.statusCode, 200);
  assert.equal(finalized.body.timeEntry.workAreaId, 'area-excavation');
  assert.equal(finalized.body.timeEntry.workAreaNameSnapshot, 'Excavation');

  const bootstrapResponse = response();
  await bootstrapHandler({ method: 'GET', query: {}, headers: { authorization: `Bearer ${context.token}` } }, bootstrapResponse);
  const entry = bootstrapResponse.body.timeEntries.find((item) => item.id === finalized.body.timeEntry.id);
  assert.equal(entry.workAreaId, 'area-excavation');
  assert.equal(entry.workAreaNameSnapshot, 'Excavation');
});

test('persisted before-clock-in workflow remains completable after its job closes', async (t) => {
  const context = await setup(t, { forms: [{ id: 'job-required', assignedTo: 'job', assignmentValue: 'job-a' }] });
  const pk = `BUSINESS#${context.businessId}`;
  seedJob(context.store, { businessId: context.businessId, id: 'job-a', status: 'scheduled', employeeId: context.employeeId });
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId, { jobIds: ['job-a'] }) });
  assert.equal(initiated.statusCode, 202);
  const requirement = initiated.body.requiredForms[0];
  context.store.get(key(pk, 'JOB#job-a')).status = 'completed';

  const submitted = await formRequest(context.token, workflowSubmission(initiated.body, requirement));
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.body.submission.jobId, 'job-a');
});

test('multiple Required forms are independent and old submissions satisfy no new occurrence', async (t) => {
  const context = await setup(t, { forms: [{ id: 'first' }, { id: 'second' }, { id: 'reminder', completionRequirement: 'reminder' }] });
  context.store.set(key(`BUSINESS#${context.businessId}`, 'FORM_SUBMISSION#old-first'), {
    PK: `BUSINESS#${context.businessId}`, SK: 'FORM_SUBMISSION#old-first', entityType: 'FORM_SUBMISSION', businessId: context.businessId,
    formSubmissionId: 'old-first', formId: 'first', employeeId: context.employeeId, trigger: 'before_clock_in',
    workflowOccurrenceId: 'previous-occurrence', workflowRequirementId: 'previous-requirement', status: 'submitted',
  });
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  assert.equal(initiated.body.requiredFormCount, 2);
  assert.equal(initiated.body.completedRequiredFormCount, 0);
  assert.equal(initiated.body.reminderForms.length, 1);
  const [first, second] = initiated.body.requiredForms;
  assert.equal(first.form.id, 'first');
  assert.deepEqual(first.form.fields.map((field) => field.id), ['first-notes']);
  assert.equal(second.form.id, 'second');
  assert.deepEqual(second.form.fields.map((field) => field.id), ['second-notes']);
  assert.notDeepEqual(first.form, second.form);

  const blocked = await clockingRequest(context.token, { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.code, 'required_forms_outstanding');
  assert.equal(blocked.body.remainingRequiredFormCount, 2);

  assert.equal((await formRequest(context.token, workflowSubmission(initiated.body, first))).statusCode, 201);
  const stillBlocked = await clockingRequest(context.token, { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(stillBlocked.statusCode, 409);
  assert.deepEqual(stillBlocked.body.remainingForms.map((item) => item.formId), ['second']);

  const wrongFormRequirement = await formRequest(context.token, workflowSubmission(initiated.body, second, {
    workflowRequirementId: first.requirementId, clientSubmissionId: 'wrong-form-requirement',
  }));
  assert.equal(wrongFormRequirement.statusCode, 404);
  assert.equal(wrongFormRequirement.body.code, 'workflow_requirement_not_found');

  assert.equal((await formRequest(context.token, workflowSubmission(initiated.body, second))).statusCode, 201);
  assert.equal((await clockingRequest(context.token, { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } })).statusCode, 200);
});

test('bootstrap exposes direct recovery properties for both mandatory workflow directions', async (t) => {
  const context = await setup(t, { forms: [{ id: 'required' }] });
  const initiated = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  const res = response();
  await bootstrapHandler({ method: 'GET', query: {}, headers: { authorization: `Bearer ${context.token}` } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.capabilities.requiredBeforeClockInForms, true);
  assert.equal(res.body.capabilities.requiredAfterClockOutForms, true);
  assert.equal(res.body.pendingClockInWorkflow.workflowOccurrenceId, initiated.body.workflowOccurrenceId);
  assert.equal(res.body.pendingClockOutWorkflow, null);
});

test('cross-tenant and wrong-employee workflow access fail closed', async (t) => {
  const store = installDdb(t);
  await seedEmployee(store, { businessId: 'biz-a', employeeId: 'employee-a', userId: 'user-a', token: 'token-a' });
  seedForm(store, { businessId: 'biz-a', id: 'required' });
  await seedEmployee(store, { businessId: 'biz-b', employeeId: 'employee-b', userId: 'user-b', token: 'token-b' });
  seedForm(store, { businessId: 'biz-b', id: 'required' });
  await seedEmployee(store, { businessId: 'biz-a', employeeId: 'employee-c', userId: 'user-c', token: 'token-c' });

  const initiated = await clockingRequest('token-a', { action: 'clock-in', body: clockInBody('employee-a') });
  const requirement = initiated.body.requiredForms[0];
  const foreignFinalize = await clockingRequest('token-b', { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(foreignFinalize.statusCode, 404);
  assert.equal(foreignFinalize.body.code, 'clock_in_workflow_not_found');
  const wrongEmployeeFinalize = await clockingRequest('token-c', { action: 'clock-in-finalize', body: { workflowOccurrenceId: initiated.body.workflowOccurrenceId } });
  assert.equal(wrongEmployeeFinalize.statusCode, 403);
  assert.equal(wrongEmployeeFinalize.body.code, 'clock_in_workflow_forbidden');
  const wrongEmployeeSubmission = await formRequest('token-c', workflowSubmission(initiated.body, requirement, { clientSubmissionId: 'employee-c-submit' }));
  assert.equal(wrongEmployeeSubmission.statusCode, 404);
  assert.equal(wrongEmployeeSubmission.body.code, 'clock_in_workflow_not_found');
});

test('inactive employee and conflicting pending clock-out prevent workflow creation', async (t) => {
  const inactive = await setup(t, { active: false, forms: [{ id: 'required' }] });
  const inactiveResult = await clockingRequest(inactive.token, { action: 'clock-in', body: clockInBody(inactive.employeeId) });
  assert.equal(inactiveResult.statusCode, 400);
  assert.equal(inactiveResult.body.error, 'Employee is invalid.');
  assert.equal([...inactive.store.values()].some((item) => item.entityType === 'CLOCK_IN_WORKFLOW'), false);

  const context = await setup(t, { businessId: 'biz-conflict', employeeId: 'employee-conflict', userId: 'user-conflict', token: 'token-conflict', forms: [{ id: 'required' }] });
  const occurrenceId = 'clock-out-pending';
  context.store.set(key('BUSINESS#biz-conflict', 'CLOCK_OUT_PENDING#EMPLOYEE#employee-conflict'), {
    PK: 'BUSINESS#biz-conflict', SK: 'CLOCK_OUT_PENDING#EMPLOYEE#employee-conflict', entityType: 'CLOCK_OUT_PENDING',
    businessId: 'biz-conflict', employeeId: 'employee-conflict', workflowOccurrenceId: occurrenceId,
  });
  context.store.set(key('BUSINESS#biz-conflict', `CLOCK_OUT_WORKFLOW#${occurrenceId}`), {
    PK: 'BUSINESS#biz-conflict', SK: `CLOCK_OUT_WORKFLOW#${occurrenceId}`, entityType: 'CLOCK_OUT_WORKFLOW',
    businessId: 'biz-conflict', employeeId: 'employee-conflict', workflowOccurrenceId: occurrenceId,
    timeEntryId: 'old-entry', intendedClockOutAt: new Date().toISOString(), status: 'pending_required_forms', requiredForms: [],
  });
  const conflict = await clockingRequest(context.token, { action: 'clock-in', body: clockInBody(context.employeeId) });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, 'pending_clock_out_requires_finalization');
  assert.equal(conflict.body.pendingClockOutWorkflow.workflowOccurrenceId, occurrenceId);
  assert.equal([...context.store.values()].some((item) => item.entityType === 'CLOCK_IN_WORKFLOW'), false);
});
