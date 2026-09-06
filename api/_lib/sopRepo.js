import { createHash, randomUUID } from 'node:crypto';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { normalizeSopDraft, validateSopForPublish } from './sopModel.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const definitionSk = (sopId) => `SOP#${sopId}`;
const versionSk = (sopId, version) => `SOP_VERSION#${sopId}#${String(version).padStart(8, '0')}`;
const auditSk = (eventId) => `AUDIT#${eventId}`;
const publishRequestSk = (sopId, requestId) => `SOP_PUBLISH_REQUEST#${sopId}#${createHash('sha256').update(requestId).digest('hex')}`;
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

async function getItem(businessId, sk) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: sk } }));
  return withoutKeys(result.Item);
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

export const getSopDefinitionForBusiness = (businessId, sopId) => getItem(businessId, definitionSk(sopId));
export const getSopVersionForBusiness = (businessId, sopId, version) => getItem(businessId, versionSk(sopId, version));
export const listSopDefinitionsForBusiness = (businessId) => queryPrefix(businessId, 'SOP#');
export const listSopVersionsForBusiness = (businessId, sopId) => queryPrefix(businessId, `SOP_VERSION#${sopId}#`);

export async function createSopDraftForBusiness({ businessId, actor, input, requestId }) {
  const sopId = typeof requestId === 'string' && requestId.trim() ? requestId.trim() : randomUUID();
  const existing = await getSopDefinitionForBusiness(businessId, sopId);
  if (existing) return existing;
  const createdAt = nowIso();
  const record = {
    id: sopId, businessId, ...normalizeSopDraft(input), status: 'draft', active: false, currentVersion: 0,
    createdAt, createdBy: actor.id, updatedAt: createdAt, updatedBy: actor.id,
  };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: definitionSk(sopId), entityType: 'SOP_DEFINITION', ...record }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'sop_created', actor, metadata: { sopId }, createdAt }) } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const winner = await getSopDefinitionForBusiness(businessId, sopId);
    if (!winner) throw error;
    return winner;
  }
  return record;
}

export async function updateSopDraftForBusiness({ businessId, sopId, actor, input }) {
  const current = await getSopDefinitionForBusiness(businessId, sopId);
  if (!current) return null;
  const updatedAt = nowIso();
  const draft = normalizeSopDraft({ ...current, ...input });
  const record = { ...current, ...draft, updatedAt, updatedBy: actor.id };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: definitionSk(sopId), entityType: 'SOP_DEFINITION', ...record }, ConditionExpression: 'attribute_exists(PK)' } },
    { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'sop_draft_updated', actor, metadata: { sopId }, createdAt: updatedAt }) } },
  ] }));
  return record;
}

export async function publishSopVersionForBusiness({ businessId, sopId, actor, requestId, document }) {
  if (typeof requestId !== 'string' || !requestId.trim()) throw Object.assign(new Error('A publish request ID is required.'), { statusCode: 400 });
  const requestKey = publishRequestSk(sopId, requestId.trim());
  const priorRequest = await getItem(businessId, requestKey);
  if (priorRequest?.version) return getSopVersionForBusiness(businessId, sopId, priorRequest.version);
  const definition = await getSopDefinitionForBusiness(businessId, sopId);
  if (!definition) return null;
  const validation = validateSopForPublish({ ...definition, ...(definition.contentMode === 'document' ? { document } : {}) });
  if (!validation.ok) throw Object.assign(new Error('SOP is not ready to publish.'), { statusCode: 400, fields: validation.errors });
  const version = Number(definition.currentVersion ?? 0) + 1;
  const publishedAt = nowIso();
  const snapshot = { sopId, businessId, version, ...validation.draft, document: validation.draft.document ? { ...validation.draft.document, version } : null, publishedAt, publishedBy: actor.id };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: versionSk(sopId, version), entityType: 'SOP_VERSION', ...snapshot }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: definitionSk(sopId) }, UpdateExpression: 'SET currentVersion = :version, #status = :published, active = :active, publishedAt = :now, updatedAt = :now, updatedBy = :actor', ConditionExpression: 'currentVersion = :previous', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':version': version, ':published': 'published', ':active': true, ':now': publishedAt, ':actor': actor.id, ':previous': version - 1 } } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: requestKey, entityType: 'SOP_PUBLISH_REQUEST', businessId, sopId, requestId: requestId.trim(), version, createdAt: publishedAt }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'sop_version_published', actor, metadata: { sopId, version }, createdAt: publishedAt }) } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const winner = await getItem(businessId, requestKey);
    if (!winner?.version) throw error;
    return getSopVersionForBusiness(businessId, sopId, winner.version);
  }
  return snapshot;
}

async function setSopActiveForBusiness({ businessId, sopId, active, actor }) {
  const current = await getSopDefinitionForBusiness(businessId, sopId);
  if (!current) return null;
  if (active && !current.currentVersion) throw Object.assign(new Error('Publish the SOP before making it active.'), { statusCode: 409 });
  if (current.active === active) return current;
  const updatedAt = nowIso();
  const record = { ...current, active, updatedAt, updatedBy: actor.id };
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: definitionSk(sopId), entityType: 'SOP_DEFINITION', ...record }, ConditionExpression: 'attribute_exists(PK)' } },
    { Put: { TableName: tableName, Item: auditItem({ businessId, action: active ? 'sop_reactivated' : 'sop_archived', actor, metadata: { sopId }, createdAt: updatedAt }) } },
  ] }));
  return record;
}

export const archiveSopForBusiness = (input) => setSopActiveForBusiness({ ...input, active: false });
export const reactivateSopForBusiness = (input) => setSopActiveForBusiness({ ...input, active: true });

export async function deleteSopForBusiness({ businessId, sopId, actor }) {
  const definition = await getSopDefinitionForBusiness(businessId, sopId);
  if (!definition) return null;
  const [versions, publishRequests, files] = await Promise.all([
    queryRawPrefix(businessId, `SOP_VERSION#${sopId}#`),
    queryRawPrefix(businessId, `SOP_PUBLISH_REQUEST#${sopId}#`),
    queryRawPrefix(businessId, 'FILE#'),
  ]);
  const ownedFiles = files.filter((item) => item.entityType === 'sop' && item.entityId === sopId);
  const records = [...versions, ...publishRequests, ...ownedFiles];
  const childKeys = [...new Map(records.map((item) => [item.SK, { PK: businessPk(businessId), SK: item.SK }])).values()];
  await deleteKeysInBatches(childKeys);
  const deletedAt = nowIso();
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: definitionSk(sopId) }, ConditionExpression: 'attribute_exists(PK)' } },
    { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'sop_deleted', actor, metadata: { sopId, title: definition.title, deletedRecordCount: childKeys.length + 1 }, createdAt: deletedAt }) } },
  ] }));
  return { ok: true, deletedRecordCount: childKeys.length + 1, deletedFileKeys: ownedFiles.map((item) => item.objectKey ?? item.key).filter(Boolean) };
}

export async function duplicateSopForBusiness({ businessId, sopId, actor, requestId }) {
  const source = await getSopDefinitionForBusiness(businessId, sopId);
  if (!source) return null;
  const duplicateId = typeof requestId === 'string' && requestId.trim() ? requestId.trim() : randomUUID();
  const existing = await getSopDefinitionForBusiness(businessId, duplicateId);
  if (existing) return existing;
  const duplicatedAt = nowIso();
  const draft = normalizeSopDraft({ ...source, title: `${source.title} Copy`, attachmentFileIds: source.attachmentFileIds ?? [], document: null });
  const duplicate = {
    id: duplicateId, businessId, ...draft, status: 'draft', active: false, currentVersion: 0,
    createdAt: duplicatedAt, createdBy: actor.id, updatedAt: duplicatedAt, updatedBy: actor.id,
  };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: definitionSk(duplicateId), entityType: 'SOP_DEFINITION', ...duplicate }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: auditItem({ businessId, action: 'sop_duplicated', actor, metadata: { sourceSopId: sopId, sopId: duplicateId }, createdAt: duplicatedAt }) } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const winner = await getSopDefinitionForBusiness(businessId, duplicateId);
    if (!winner) throw error;
    return winner;
  }
  return duplicate;
}