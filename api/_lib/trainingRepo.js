import { createHash, randomUUID } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { getBusinessPeriodKeys, normalizeBusinessTimeZone } from './businessTime.js';
import { nextDueDateForCompletion, trainingPresentationStatus, validateTrainingForPublish } from './trainingModel.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const definitionSk = (trainingId) => `TRAINING#${trainingId}`;
const versionSk = (trainingId, version) => `TRAINING_VERSION#${trainingId}#${String(version).padStart(8, '0')}`;
const assignmentSk = (assignmentId) => `TRAINING_ASSIGNMENT#${assignmentId}`;
const assignmentUniqueSk = (employeeId, trainingId) => `TRAINING_ASSIGNMENT_UNIQUE#${employeeId}#${trainingId}`;
const completionSk = (completionId) => `TRAINING_COMPLETION#${completionId}`;
const auditSk = (eventId) => `AUDIT#${eventId}`;
const idempotencySk = (employeeId, assignmentId, submissionId) => `TRAINING_COMPLETION_IDEMPOTENCY#${createHash('sha256').update(`${employeeId}\0${assignmentId}\0${submissionId}`).digest('hex')}`;
const publishRequestSk = (trainingId, requestId) => `TRAINING_PUBLISH_REQUEST#${trainingId}#${createHash('sha256').update(requestId).digest('hex')}`;
const nowIso = () => new Date().toISOString();
const MAX_TRANSACTION_ITEMS = 100;

function withoutKeys(item) {
  if (!item) return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...record } = item;
  return record;
}

function auditItem({ businessId, action, actor, metadata, createdAt = nowIso() }) {
  const eventId = randomUUID();
  return {
    PK: businessPk(businessId), SK: auditSk(eventId), entityType: 'AUDIT_EVENT', id: eventId, eventId,
    businessId, action, actorUserId: actor.id, actorName: actor.name, actorEmail: actor.email,
    affectedEntryCount: 1, metadata, createdAt,
  };
}

async function queryPrefix(businessId, prefix) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': prefix },
  }));
  return (result.Items ?? []).map(withoutKeys);
}

async function queryRawPrefix(businessId, prefix) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': prefix },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function deleteKeysInBatches(keys) {
  for (let index = 0; index < keys.length; index += MAX_TRANSACTION_ITEMS) {
    await ddb.send(new TransactWriteCommand({
      TransactItems: keys.slice(index, index + MAX_TRANSACTION_ITEMS).map((Key) => ({ Delete: { TableName: tableName, Key } })),
    }));
  }
}

async function getItem(businessId, sk) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: sk } }));
  return withoutKeys(result.Item);
}

export const getTrainingDefinitionForBusiness = (businessId, trainingId) => getItem(businessId, definitionSk(trainingId));
export const getTrainingVersionForBusiness = (businessId, trainingId, version) => getItem(businessId, versionSk(trainingId, version));
export const getTrainingAssignmentForBusiness = (businessId, assignmentId) => getItem(businessId, assignmentSk(assignmentId));
export const getTrainingCompletionForBusiness = (businessId, completionId) => getItem(businessId, completionSk(completionId));
export const listTrainingDefinitionsForBusiness = (businessId) => queryPrefix(businessId, 'TRAINING#');
export const listTrainingVersionsForBusiness = (businessId, trainingId) => queryPrefix(businessId, `TRAINING_VERSION#${trainingId}#`);
export const listTrainingAssignmentsForBusiness = (businessId) => queryPrefix(businessId, 'TRAINING_ASSIGNMENT#');
export const listTrainingCompletionsForBusiness = (businessId) => queryPrefix(businessId, 'TRAINING_COMPLETION#');

export async function createTrainingDraftForBusiness({ businessId, actor, input, requestId }) {
  const trainingId = typeof requestId === 'string' && requestId.trim() ? requestId.trim() : randomUUID();
  const existing = await getTrainingDefinitionForBusiness(businessId, trainingId);
  if (existing) return existing;
  const createdAt = nowIso();
  const draft = validateTrainingForPublish(input).draft;
  const record = { id: trainingId, businessId, ...draft, status: 'draft', currentVersion: 0, createdAt, createdBy: actor.id, updatedAt: createdAt, updatedBy: actor.id };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: definitionSk(trainingId), entityType: 'TRAINING_DEFINITION', ...record }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_created', actor, metadata: { trainingId }, createdAt }) } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const winner = await getTrainingDefinitionForBusiness(businessId, trainingId);
    if (!winner) throw error;
    return winner;
  }
  return record;
}

export async function updateTrainingDraftForBusiness({ businessId, trainingId, actor, input }) {
  const current = await getTrainingDefinitionForBusiness(businessId, trainingId);
  if (!current) return null;
  if (current.status !== 'draft') throw Object.assign(new Error('Published training must be edited through a new draft.'), { statusCode: 409 });
  const updatedAt = nowIso();
  const draft = validateTrainingForPublish({ ...current, ...input }).draft;
  const record = { ...current, ...draft, updatedAt, updatedBy: actor.id };
  await ddb.send(new PutCommand({ TableName: tableName, Item: { PK: businessPk(businessId), SK: definitionSk(trainingId), entityType: 'TRAINING_DEFINITION', ...record }, ConditionExpression: '#status = :draft', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':draft': 'draft' } }));
  return record;
}

export async function publishTrainingVersionForBusiness({ businessId, trainingId, actor, requestId, document }) {
  if (typeof requestId !== 'string' || !requestId.trim()) throw Object.assign(new Error('A publish request ID is required.'), { statusCode: 400 });
  const priorRequest = await getItem(businessId, publishRequestSk(trainingId, requestId));
  if (priorRequest?.version) return getTrainingVersionForBusiness(businessId, trainingId, priorRequest.version);
  const definition = await getTrainingDefinitionForBusiness(businessId, trainingId);
  if (!definition) return null;
  const validation = validateTrainingForPublish({ ...definition, ...(definition.contentMode === 'document' ? { document } : {}) });
  if (!validation.ok) throw Object.assign(new Error('Training is not ready to publish.'), { statusCode: 400, fields: validation.errors });
  const version = Number(definition.currentVersion ?? 0) + 1;
  const createdAt = nowIso();
  const snapshot = {
    trainingId, businessId, version, contentMode: validation.draft.contentMode, title: validation.draft.title, category: validation.draft.category, shortDescription: validation.draft.shortDescription,
    instructions: validation.draft.instructions, checklist: validation.draft.checklist,
    acknowledgementStatement: validation.draft.acknowledgementStatement, attachmentFileId: validation.draft.attachmentFileId,
    recurrenceType: validation.draft.recurrenceType, recurrenceMonths: validation.draft.recurrenceMonths,
    dueSoonDays: validation.draft.dueSoonDays, document: validation.draft.document ? { ...validation.draft.document, version } : null, createdAt, createdBy: actor.id,
  };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: versionSk(trainingId, version), entityType: 'TRAINING_VERSION', ...snapshot }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: definitionSk(trainingId) }, UpdateExpression: 'SET currentVersion = :version, #status = :published, active = :active, updatedAt = :now, updatedBy = :actor', ConditionExpression: 'currentVersion = :previous', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':version': version, ':published': 'published', ':active': true, ':now': createdAt, ':actor': actor.id, ':previous': version - 1 } } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: publishRequestSk(trainingId, requestId), entityType: 'TRAINING_PUBLISH_REQUEST', businessId, trainingId, requestId, version, createdAt }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_version_published', actor, metadata: { trainingId, version }, createdAt }) } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const winner = await getItem(businessId, publishRequestSk(trainingId, requestId));
    if (!winner?.version) throw error;
    return getTrainingVersionForBusiness(businessId, trainingId, winner.version);
  }
  return snapshot;
}

export async function startTrainingDraftForBusiness({ businessId, trainingId, actor }) {
  const current = await getTrainingDefinitionForBusiness(businessId, trainingId);
  if (!current) return null;
  const updatedAt = nowIso();
  const record = { ...current, status: 'draft', updatedAt, updatedBy: actor.id };
  await ddb.send(new PutCommand({ TableName: tableName, Item: { PK: businessPk(businessId), SK: definitionSk(trainingId), entityType: 'TRAINING_DEFINITION', ...record } }));
  return record;
}

export async function setTrainingActiveForBusiness({ businessId, trainingId, active, actor }) {
  const updatedAt = nowIso();
  const result = await ddb.send(new UpdateCommand({
    TableName: tableName, Key: { PK: businessPk(businessId), SK: definitionSk(trainingId) },
    UpdateExpression: 'SET active = :active, updatedAt = :now, updatedBy = :actor',
    ConditionExpression: 'attribute_exists(PK)', ExpressionAttributeValues: { ':active': Boolean(active), ':now': updatedAt, ':actor': actor.id }, ReturnValues: 'ALL_NEW',
  }));
  return withoutKeys(result.Attributes);
}

export async function deleteTrainingForBusiness({ businessId, trainingId, actor }) {
  const definition = await getTrainingDefinitionForBusiness(businessId, trainingId);
  if (!definition) return null;
  const [versions, publishRequests, assignments, completions, files] = await Promise.all([
    queryRawPrefix(businessId, `TRAINING_VERSION#${trainingId}#`),
    queryRawPrefix(businessId, `TRAINING_PUBLISH_REQUEST#${trainingId}#`),
    queryRawPrefix(businessId, 'TRAINING_ASSIGNMENT#'),
    queryRawPrefix(businessId, 'TRAINING_COMPLETION#'),
    queryRawPrefix(businessId, 'FILE#'),
  ]);
  const ownedAssignments = assignments.filter((item) => item.trainingId === trainingId);
  const assignmentIds = new Set(ownedAssignments.map((item) => item.assignmentId ?? item.id));
  const [assignmentMarkers, completionMarkers] = await Promise.all([
    queryRawPrefix(businessId, 'TRAINING_ASSIGNMENT_UNIQUE#'),
    queryRawPrefix(businessId, 'TRAINING_COMPLETION_IDEMPOTENCY#'),
  ]);
  const ownedFiles = files.filter((item) => item.entityType === 'training' && item.entityId === trainingId);
  const records = [
    ...versions,
    ...publishRequests,
    ...ownedAssignments,
    ...assignmentMarkers.filter((item) => item.trainingId === trainingId),
    ...completions.filter((item) => item.trainingId === trainingId),
    ...completionMarkers.filter((item) => assignmentIds.has(item.assignmentId)),
    ...ownedFiles,
  ];
  const childKeys = [...new Map(records.map((item) => [item.SK, { PK: businessPk(businessId), SK: item.SK }])).values()];
  await deleteKeysInBatches(childKeys);
  const deletedAt = nowIso();
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: definitionSk(trainingId) }, ConditionExpression: 'attribute_exists(PK)' } },
    { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_deleted', actor, metadata: { trainingId, title: definition.title, deletedRecordCount: childKeys.length + 1 }, createdAt: deletedAt }) } },
  ] }));
  return { ok: true, deletedRecordCount: childKeys.length + 1, deletedFileKeys: ownedFiles.map((item) => item.objectKey ?? item.key).filter(Boolean) };
}

export async function createTrainingAssignmentForBusiness({ businessId, actor, employee, trainingId, initialDueDate, requestId }) {
  const definition = await getTrainingDefinitionForBusiness(businessId, trainingId);
  if (!definition?.active || !definition.currentVersion) throw Object.assign(new Error('Only active published training can be assigned.'), { statusCode: 409 });
  const version = await getTrainingVersionForBusiness(businessId, trainingId, definition.currentVersion);
  if (!version) throw Object.assign(new Error('Published training version was not found.'), { statusCode: 409 });
  const marker = await getItem(businessId, assignmentUniqueSk(employee.id, trainingId));
  if (marker?.assignmentId) return getTrainingAssignmentForBusiness(businessId, marker.assignmentId);
  const assignedAt = nowIso();
  const assignmentId = typeof requestId === 'string' && requestId.trim() ? requestId.trim() : randomUUID();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(initialDueDate ?? '') ? initialDueDate : assignedAt.slice(0, 10);
  const record = {
    id: assignmentId, assignmentId, businessId, trainingId, trainingTitle: version.title, assignedVersion: version.version,
    employeeId: employee.id, employeeName: employee.name, assignedAt, assignedBy: actor.id, initialDueDate: dueDate,
    currentDueDate: dueDate, recurrenceType: version.recurrenceType, recurrenceMonths: version.recurrenceMonths,
    dueSoonDays: version.dueSoonDays, latestCompletionId: null, latestCompletedAt: null, nextDueDate: null,
  };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: assignmentSk(assignmentId), entityType: 'TRAINING_ASSIGNMENT', ...record }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: assignmentUniqueSk(employee.id, trainingId), entityType: 'TRAINING_ASSIGNMENT_UNIQUE', assignmentId, employeeId: employee.id, trainingId, businessId, createdAt: assignedAt }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_assignment_created', actor, metadata: { trainingId, assignmentId, employeeId: employee.id, assignedVersion: version.version }, createdAt: assignedAt }) } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const existingMarker = await getItem(businessId, assignmentUniqueSk(employee.id, trainingId));
    if (!existingMarker?.assignmentId) throw error;
    return getTrainingAssignmentForBusiness(businessId, existingMarker.assignmentId);
  }
  return record;
}

export async function revokeTrainingAssignmentForBusiness({ businessId, assignmentId, actor }) {
  const assignment = await getTrainingAssignmentForBusiness(businessId, assignmentId);
  if (!assignment) return null;
  if (assignment.revokedAt) return assignment;
  const revokedAt = nowIso();
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: assignmentSk(assignmentId) }, UpdateExpression: 'SET revokedAt = :now, revokedBy = :actor', ConditionExpression: 'attribute_not_exists(revokedAt)', ExpressionAttributeValues: { ':now': revokedAt, ':actor': actor.id } } },
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: assignmentUniqueSk(assignment.employeeId, assignment.trainingId) }, ConditionExpression: 'assignmentId = :assignmentId', ExpressionAttributeValues: { ':assignmentId': assignmentId } } },
    { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_assignment_revoked', actor, metadata: { assignmentId, employeeId: assignment.employeeId, trainingId: assignment.trainingId }, createdAt: revokedAt }) } },
  ] }));
  return { ...assignment, revokedAt, revokedBy: actor.id };
}

export async function requireTrainingVersionForAssignment({ businessId, assignmentId, version, actor, dueDate }) {
  const assignment = await getTrainingAssignmentForBusiness(businessId, assignmentId);
  if (!assignment || assignment.revokedAt) return null;
  const snapshot = await getTrainingVersionForBusiness(businessId, assignment.trainingId, version);
  if (!snapshot) throw Object.assign(new Error('Published training version was not found.'), { statusCode: 404 });
  const changedAt = nowIso();
  const nextDueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate ?? '') ? dueDate : changedAt.slice(0, 10);
  if (assignment.assignedVersion === version && assignment.currentDueDate === nextDueDate) return assignment;
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: assignmentSk(assignmentId) }, UpdateExpression: 'SET assignedVersion = :version, trainingTitle = :title, recurrenceType = :recurrenceType, recurrenceMonths = :recurrenceMonths, dueSoonDays = :dueSoonDays, currentDueDate = :dueDate, nextDueDate = :dueDate, updatedAt = :now REMOVE lastCompletedCycleKey', ConditionExpression: 'attribute_not_exists(revokedAt)', ExpressionAttributeValues: { ':version': version, ':title': snapshot.title, ':recurrenceType': snapshot.recurrenceType, ':recurrenceMonths': snapshot.recurrenceMonths, ':dueSoonDays': snapshot.dueSoonDays, ':dueDate': nextDueDate, ':now': changedAt } } },
    { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_version_required', actor, metadata: { assignmentId, employeeId: assignment.employeeId, trainingId: assignment.trainingId, version, dueDate: nextDueDate }, createdAt: changedAt }) } },
  ] }));
  return { ...assignment, assignedVersion: version, trainingTitle: snapshot.title, recurrenceType: snapshot.recurrenceType, recurrenceMonths: snapshot.recurrenceMonths, dueSoonDays: snapshot.dueSoonDays, currentDueDate: nextDueDate, nextDueDate, lastCompletedCycleKey: undefined, updatedAt: changedAt };
}

export async function changeTrainingAssignmentDueDate({ businessId, assignmentId, dueDate, actor }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate ?? '')) throw Object.assign(new Error('A valid due date is required.'), { statusCode: 400 });
  const assignment = await getTrainingAssignmentForBusiness(businessId, assignmentId);
  if (!assignment || assignment.revokedAt) return null;
  const changedAt = nowIso();
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: assignmentSk(assignmentId) }, UpdateExpression: 'SET currentDueDate = :dueDate, nextDueDate = :dueDate, updatedAt = :now', ConditionExpression: 'attribute_not_exists(revokedAt)', ExpressionAttributeValues: { ':dueDate': dueDate, ':now': changedAt } } },
    { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_due_date_changed', actor, metadata: { assignmentId, employeeId: assignment.employeeId, trainingId: assignment.trainingId, previousDueDate: assignment.currentDueDate, dueDate }, createdAt: changedAt }) } },
  ] }));
  return { ...assignment, currentDueDate: dueDate, nextDueDate: dueDate, updatedAt: changedAt };
}

export function presentTrainingAssignments(assignments, { now = new Date(), timeZone }) {
  return assignments.map((assignment) => ({ ...assignment, presentationStatus: trainingPresentationStatus({ assignment, now, timeZone }) }));
}

export async function completeTrainingAssignmentForBusiness({ businessId, employee, assignmentId, submissionId, checklistResponses, acknowledged, timeZone }) {
  if (typeof submissionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(submissionId)) throw Object.assign(new Error('A valid submission ID is required.'), { statusCode: 400 });
  const replay = await getItem(businessId, idempotencySk(employee.id, assignmentId, submissionId));
  if (replay?.completionId) return { completion: await getTrainingCompletionForBusiness(businessId, replay.completionId), replayed: true };
  const assignment = await getTrainingAssignmentForBusiness(businessId, assignmentId);
  if (!assignment || assignment.employeeId !== employee.id) throw Object.assign(new Error('Training assignment was not found.'), { statusCode: 404 });
  if (assignment.revokedAt) throw Object.assign(new Error('This training assignment has been revoked. Refresh your Hub.'), { statusCode: 409, code: 'stale_assignment' });
  const version = await getTrainingVersionForBusiness(businessId, assignment.trainingId, assignment.assignedVersion);
  if (!version) throw Object.assign(new Error('The assigned training version is unavailable.'), { statusCode: 409, code: 'stale_assignment' });
  if (acknowledged !== true) throw Object.assign(new Error('Training acknowledgement is required.'), { statusCode: 400 });
  const responses = Array.isArray(checklistResponses) ? checklistResponses : [];
  const responseById = new Map(responses.map((response) => [response?.itemId, response]));
  const requiredIds = new Set(version.checklist.map((item) => item.itemId));
  if (responses.length !== requiredIds.size || responses.some((response) => !requiredIds.has(response?.itemId)) || version.checklist.some((item) => responseById.get(item.itemId)?.checked !== true)) {
    throw Object.assign(new Error('Every required checklist item must be completed.'), { statusCode: 400 });
  }
  const completedAt = nowIso();
  const completedDate = getBusinessPeriodKeys(completedAt, normalizeBusinessTimeZone(timeZone)).daily;
  const cycleKey = assignment.currentDueDate ?? assignment.initialDueDate ?? completedDate;
  if (assignment.lastCompletedCycleKey === cycleKey) throw Object.assign(new Error('This training cycle is already complete.'), { statusCode: 409, code: 'cycle_complete' });
  const nextDueDate = nextDueDateForCompletion({ completedAt, recurrenceType: version.recurrenceType, recurrenceMonths: version.recurrenceMonths, timeZone });
  const completionId = randomUUID();
  const completion = {
    id: completionId, completionId, businessId, assignmentId, employeeId: employee.id, trainingId: assignment.trainingId,
    completedVersion: version.version, trainingTitle: version.title,
    checklistItems: version.checklist.map((item) => ({ itemId: item.itemId, text: item.text, required: true, checked: true })),
    contentMode: version.contentMode ?? 'structured', document: version.document ?? null,
    acknowledgementStatement: version.acknowledgementStatement, acknowledged: true, completedAt, nextDueDate, submissionId,
  };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: completionSk(completionId), entityType: 'TRAINING_COMPLETION', ...completion }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: idempotencySk(employee.id, assignmentId, submissionId), entityType: 'TRAINING_COMPLETION_IDEMPOTENCY', businessId, employeeId: employee.id, assignmentId, completionId, createdAt: completedAt }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: assignmentSk(assignmentId) }, UpdateExpression: 'SET latestCompletionId = :completionId, latestCompletedAt = :completedAt, nextDueDate = :nextDueDate, currentDueDate = :nextDueDate, lastCompletedCycleKey = :cycleKey', ConditionExpression: 'attribute_not_exists(revokedAt) AND (attribute_not_exists(lastCompletedCycleKey) OR lastCompletedCycleKey <> :cycleKey)', ExpressionAttributeValues: { ':completionId': completionId, ':completedAt': completedAt, ':nextDueDate': nextDueDate, ':cycleKey': cycleKey } } },
      { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'training_completed', actor: { id: employee.userId ?? employee.id, name: employee.name, email: employee.email }, metadata: { assignmentId, completionId, employeeId: employee.id, trainingId: assignment.trainingId, completedVersion: version.version }, createdAt: completedAt }) } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const replayMarker = await getItem(businessId, idempotencySk(employee.id, assignmentId, submissionId));
    if (replayMarker?.completionId) return { completion: await getTrainingCompletionForBusiness(businessId, replayMarker.completionId), replayed: true };
    const current = await getTrainingAssignmentForBusiness(businessId, assignmentId);
    if (current?.lastCompletedCycleKey === cycleKey) throw Object.assign(new Error('This training cycle is already complete.'), { statusCode: 409, code: 'cycle_complete' });
    throw error;
  }
  return { completion, replayed: false };
}