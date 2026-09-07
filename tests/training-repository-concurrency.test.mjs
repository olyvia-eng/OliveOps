import test from 'node:test';
import assert from 'node:assert/strict';
import { ddb } from '../api/_lib/db.js';
import {
  completeTrainingAssignmentForBusiness,
  createTrainingAssignmentForBusiness,
  createTrainingDraftForBusiness,
  deleteTrainingForBusiness,
  publishTrainingVersionForBusiness,
} from '../api/_lib/trainingRepo.js';

const actor = { id: 'admin-a', name: 'Admin', email: 'admin@example.com' };
const employee = { id: 'emp-a', userId: 'user-a', name: 'Alex', email: 'alex@example.com' };
const draft = {
  title: 'WHMIS', instructions: '',
  trainingSections: [{ sectionId: 'section-a', title: 'Safety Information', description: 'Read the safety information.', sortOrder: 0, checklistItems: [{ itemId: 'item-a', text: 'I reviewed the information.', required: true, sortOrder: 0 }] }],
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

test('publishing snapshots the complete ordered Training Section structure', async (t) => {
  const expectedSections = [
    ...structuredClone(draft.trainingSections),
    { sectionId: 'section-info', title: 'Test header', description: 'Informational content only.', sortOrder: 1, checklistItems: [] },
  ];
  const definition = { id: 'training-a', currentVersion: 0, status: 'draft', ...draft, trainingSections: expectedSections };
  const seen = installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(definition, 'TRAINING#training-a') },
    { command: 'TransactWriteCommand' },
  ]);
  const version = await publishTrainingVersionForBusiness({ businessId: 'biz-a', trainingId: 'training-a', actor, requestId: 'publish-rich-text' });
  assert.deepEqual(version.trainingSections, expectedSections);
  assert.deepEqual(seen[2].input.TransactItems[0].Put.Item.trainingSections, expectedSections);
  definition.trainingSections[0].title = 'Changed after publish';
  assert.equal(version.trainingSections[0].title, 'Safety Information');
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
  const result = await completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'submission-a', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, signatureName: 'Alex', timeZone: 'America/Toronto' });
  assert.equal(result.replayed, true);
  assert.equal(result.completion.id, 'completion-winner');
});

test('completion snapshots the exact assigned Training Section content', async (t) => {
  const assignment = { id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 1, currentDueDate: '2026-08-31' };
  const version = { trainingId: 'training-a', version: 1, ...draft, trainingSections: [
    ...draft.trainingSections,
    { sectionId: 'section-info', title: 'Additional Information', description: 'Read this section.', sortOrder: 1, checklistItems: [] },
  ] };
  const seen = installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(assignment, 'TRAINING_ASSIGNMENT#assignment-a') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
    { command: 'TransactWriteCommand' },
  ]);
  const result = await completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'submission-sections', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, signatureName: '  alex  ', timeZone: 'America/Toronto' });
  assert.deepEqual(result.completion.trainingSections, version.trainingSections);
  assert.equal(result.completion.employeeName, 'Alex');
  assert.equal(result.completion.signatureName, 'alex');
  assert.equal(result.completion.signedAt, result.completion.completedAt);
  assert.equal(result.completion.acknowledgementVersion, 1);
  assert.deepEqual(seen[3].input.TransactItems[0].Put.Item.trainingSections, version.trainingSections);
  assert.equal(seen[3].input.TransactItems[0].Put.Item.signatureName, 'alex');
});

test('completion rejects blank or another employee signature name', async (t) => {
  const assignment = { id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 1, currentDueDate: '2026-08-31' };
  const version = { trainingId: 'training-a', version: 1, ...draft };
  installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(assignment, 'TRAINING_ASSIGNMENT#assignment-a') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
  ]);
  await assert.rejects(
    completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'blank-signature', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, signatureName: '   ', timeZone: 'America/Toronto' }),
    (error) => error.statusCode === 400 && /signature is required/i.test(error.message),
  );
});

test('completion rejects signing as another employee', async (t) => {
  const assignment = { id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 1, currentDueDate: '2026-08-31' };
  const version = { trainingId: 'training-a', version: 1, ...draft };
  installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(assignment, 'TRAINING_ASSIGNMENT#assignment-a') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
  ]);
  await assert.rejects(
    completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'wrong-signature', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, signatureName: 'Jordan Smith', timeZone: 'America/Toronto' }),
    (error) => error.statusCode === 400 && /employee profile/i.test(error.message),
  );
});

test('completion is blocked until every checklist item across every section is checked', async (t) => {
  const assignment = { id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 1, currentDueDate: '2026-08-31' };
  const version = { trainingId: 'training-a', version: 1, ...draft, trainingSections: [
    draft.trainingSections[0],
    { sectionId: 'section-b', title: 'Operation', description: '', sortOrder: 1, checklistItems: [{ itemId: 'item-b', text: 'Wear seatbelt', required: true, sortOrder: 0 }] },
  ] };
  installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item(assignment, 'TRAINING_ASSIGNMENT#assignment-a') },
    { command: 'GetCommand', result: item(version, 'TRAINING_VERSION#training-a#00000001') },
  ]);
  await assert.rejects(
    completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'partial-sections', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, signatureName: 'Alex', timeZone: 'America/Toronto' }),
    (error) => error.statusCode === 400 && /Every required checklist item/.test(error.message),
  );
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
    completeTrainingAssignmentForBusiness({ businessId: 'biz-a', employee, assignmentId: 'assignment-a', submissionId: 'submission-b', checklistResponses: [{ itemId: 'item-a', checked: true }], acknowledged: true, signatureName: 'Alex', timeZone: 'America/Toronto' }),
    (error) => error.statusCode === 409 && error.code === 'cycle_complete',
  );
});

test('permanent Training deletion removes all owned employee records and retains an audit event', async (t) => {
  const seen = installSequence(t, [
    { command: 'GetCommand', result: item({ id: 'training-a', title: 'WHMIS' }, 'TRAINING#training-a') },
    { command: 'QueryCommand', result: { Items: [{ PK: 'BUSINESS#biz-a', SK: 'TRAINING_VERSION#training-a#00000001' }] } },
    { command: 'QueryCommand', result: { Items: [{ PK: 'BUSINESS#biz-a', SK: 'TRAINING_PUBLISH_REQUEST#training-a#hash' }] } },
    { command: 'QueryCommand', result: { Items: [
      { PK: 'BUSINESS#biz-a', SK: 'TRAINING_ASSIGNMENT#assignment-a', id: 'assignment-a', trainingId: 'training-a' },
      { PK: 'BUSINESS#biz-a', SK: 'TRAINING_ASSIGNMENT#assignment-b', id: 'assignment-b', trainingId: 'training-b' },
    ] } },
    { command: 'QueryCommand', result: { Items: [
      { PK: 'BUSINESS#biz-a', SK: 'TRAINING_COMPLETION#completion-a', trainingId: 'training-a' },
      { PK: 'BUSINESS#biz-a', SK: 'TRAINING_COMPLETION#completion-b', trainingId: 'training-b' },
    ] } },
    { command: 'QueryCommand', result: { Items: [{ PK: 'BUSINESS#biz-a', SK: 'FILE#training-a', entityType: 'training', entityId: 'training-a' }] } },
    { command: 'QueryCommand', result: { Items: [{ PK: 'BUSINESS#biz-a', SK: 'TRAINING_ASSIGNMENT_UNIQUE#emp-a#training-a', trainingId: 'training-a' }] } },
    { command: 'QueryCommand', result: { Items: [{ PK: 'BUSINESS#biz-a', SK: 'TRAINING_COMPLETION_IDEMPOTENCY#hash', assignmentId: 'assignment-a' }] } },
    { command: 'TransactWriteCommand' },
    { command: 'TransactWriteCommand' },
  ]);

  const result = await deleteTrainingForBusiness({ businessId: 'biz-a', trainingId: 'training-a', actor });
  assert.equal(result.deletedRecordCount, 8);
  const deletes = seen[8].input.TransactItems.map((entry) => entry.Delete.Key.SK);
  assert.deepEqual(deletes, [
    'TRAINING_VERSION#training-a#00000001',
    'TRAINING_PUBLISH_REQUEST#training-a#hash',
    'TRAINING_ASSIGNMENT#assignment-a',
    'TRAINING_ASSIGNMENT_UNIQUE#emp-a#training-a',
    'TRAINING_COMPLETION#completion-a',
    'TRAINING_COMPLETION_IDEMPOTENCY#hash',
    'FILE#training-a',
  ]);
  assert.equal(seen[9].input.TransactItems[0].Delete.Key.SK, 'TRAINING#training-a');
  assert.equal(seen[9].input.TransactItems[1].Put.Item.action, 'training_deleted');
});
