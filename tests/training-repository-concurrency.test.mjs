import test from 'node:test';
import assert from 'node:assert/strict';
import { ddb } from '../api/_lib/db.js';
import {
  completeTrainingAssignmentForBusiness,
  createTrainingAssignmentForBusiness,
  createTrainingDraftForBusiness,
  publishTrainingVersionForBusiness,
} from '../api/_lib/trainingRepo.js';

const actor = { id: 'admin-a', name: 'Admin', email: 'admin@example.com' };
const employee = { id: 'emp-a', userId: 'user-a', name: 'Alex', email: 'alex@example.com' };
const draft = {
  title: 'WHMIS', instructions: 'Read the safety information.',
  checklist: [{ itemId: 'item-a', text: 'I reviewed the information.' }],
  acknowledgementStatement: 'I understand.', recurrenceType: 'annual', dueSoonDays: 30,
};

function item(record, sk) {
  return record ? { Item: { PK: 'BUSINESS#biz-a', SK: sk, entityType: 'TEST', ...record } } : {};
}

function transactionCancelled() {
  return Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' });
}

function installSequence(t, steps) {
  const original = ddb.send;
  const seen = [];
  ddb.send = async (command) => {
    seen.push(command);
    const step = steps.shift();
    assert.ok(step, `Unexpected ${command.constructor.name}`);
    assert.equal(command.constructor.name, step.command);
    if (step.error) throw step.error;
    return step.result ?? {};
  };
  t.after(() => { ddb.send = original; });
  return seen;
}

test('concurrent draft creation returns the committed winner', async (t) => {
  installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'TransactWriteCommand', error: transactionCancelled() },
    { command: 'GetCommand', result: item({ id: 'request-a', title: 'Committed winner' }, 'TRAINING#request-a') },
  ]);
  const result = await createTrainingDraftForBusiness({ businessId: 'biz-a', actor, input: draft, requestId: 'request-a' });
  assert.equal(result.title, 'Committed winner');
});

test('concurrent publish retry returns the immutable version claimed by its request', async (t) => {
  const definition = { id: 'training-a', currentVersion: 0, status: 'draft', ...draft };
  const version = { trainingId: 'training-a', version: 1, ...draft };
  installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(definition, 'TRAINING#training-a') },
    { command: 'TransactWriteCommand', error: transactionCancelled() },
    { command: 'GetCommand', result: item({ trainingId: 'training-a', requestId: 'publish-a', version: 1 }, 'TRAINING_PUBLISH_REQUEST#training-a#hash') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
  ]);
  const result = await publishTrainingVersionForBusiness({ businessId: 'biz-a', trainingId: 'training-a', actor, requestId: 'publish-a' });
  assert.equal(result.version, 1);
  assert.equal(result.title, 'WHMIS');
});

test('concurrent assignment creation returns the unique committed assignment', async (t) => {
  const definition = { id: 'training-a', currentVersion: 1, active: true };
  const version = { trainingId: 'training-a', version: 1, ...draft };
  const committed = { id: 'assignment-winner', assignmentId: 'assignment-winner', employeeId: 'emp-a', trainingId: 'training-a' };
  installSequence(t, [
    { command: 'GetCommand', result: item(definition, 'TRAINING#training-a') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
    { command: 'GetCommand', result: {} },
    { command: 'TransactWriteCommand', error: transactionCancelled() },
    { command: 'GetCommand', result: item({ assignmentId: 'assignment-winner' }, 'TRAINING_ASSIGNMENT_UNIQUE#emp-a#training-a') },
    { command: 'GetCommand', result: item(committed, 'TRAINING_ASSIGNMENT#assignment-winner') },
  ]);
  const result = await createTrainingAssignmentForBusiness({ businessId: 'biz-a', actor, employee, trainingId: 'training-a', initialDueDate: '2026-08-31', requestId: 'assignment-loser' });
  assert.equal(result.id, 'assignment-winner');
});

test('concurrent identical completion returns the original immutable completion', async (t) => {
  const assignment = { id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 1, currentDueDate: '2026-08-31' };
  const version = { trainingId: 'training-a', version: 1, ...draft };
  const completion = { id: 'completion-winner', completionId: 'completion-winner', assignmentId: 'assignment-a', employeeId: 'emp-a' };
  installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(assignment, 'TRAINING_ASSIGNMENT#assignment-a') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
    { command: 'TransactWriteCommand', error: transactionCancelled() },
    { command: 'GetCommand', result: item({ completionId: 'completion-winner' }, 'TRAINING_COMPLETION_IDEMPOTENCY#hash') },
    { command: 'GetCommand', result: item(completion, 'TRAINING_COMPLETION#completion-winner') },
  ]);
  const result = await completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'submission-a', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, timeZone: 'America/Toronto' });
  assert.equal(result.replayed, true);
  assert.equal(result.completion.id, 'completion-winner');
});

test('different completion request losing the cycle race returns a stable conflict', async (t) => {
  const assignment = { id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 1, currentDueDate: '2026-08-31' };
  const version = { trainingId: 'training-a', version: 1, ...draft };
  installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(assignment, 'TRAINING_ASSIGNMENT#assignment-a') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
    { command: 'TransactWriteCommand', error: transactionCancelled() },
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item({ ...assignment, lastCompletedCycleKey: '2026-08-31' }, 'TRAINING_ASSIGNMENT#assignment-a') },
  ]);
  await assert.rejects(
    completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'submission-b', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, timeZone: 'America/Toronto' }),
    (error) => error.statusCode === 409 && error.code === 'cycle_complete',
  );
});
