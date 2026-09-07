import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const visitSk = (jobId, visitId) => `SERVICE_VISIT#${jobId}#${visitId}`;
const visitPrefix = (jobId) => `SERVICE_VISIT#${jobId}#`;

function visitItem(businessId, visit) {
  return {
    PK: businessPk(businessId),
    SK: visitSk(visit.jobId, visit.id),
    entityType: 'SERVICE_VISIT',
    businessId,
    visitId: visit.id,
    ...visit,
  };
}

function mapVisit(item) {
  if (!item) return null;
  const { PK: _PK, SK: _SK, entityType: _entityType, timeEntryIndexPk: _indexPk, timeEntryIndexSk: _indexSk, ...visit } = item;
  return visit;
}

export async function getServiceVisitForBusiness(businessId, jobId, visitId) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: visitSk(jobId, visitId) } }));
  return mapVisit(result.Item);
}

export async function listServiceVisitsForJob(businessId, jobId) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': visitPrefix(jobId) },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items.map(mapVisit).sort((left, right) => `${left.scheduledDate}#${left.scheduledStartAt ?? ''}`.localeCompare(`${right.scheduledDate}#${right.scheduledStartAt ?? ''}`));
}

export async function listServiceVisitsForSchedule(businessId, startDate, endDate) {
  const partitionKey = businessPk(businessId);
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': partitionKey },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items
    .filter((item) => item.PK === partitionKey && item.entityType === 'SERVICE_VISIT' && item.scheduledDate >= startDate && item.scheduledDate <= endDate)
    .map(mapVisit)
    .sort((left, right) => `${left.scheduledDate}#${left.scheduledStartAt ?? ''}#${left.jobId}#${left.id}`.localeCompare(`${right.scheduledDate}#${right.scheduledStartAt ?? ''}#${right.jobId}#${right.id}`));
}

export async function updateOperationalServiceForBusiness({ businessId, jobId, serviceIndex, service, expectedRevision, updatedAt }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: `JOB#${jobId}` },
      UpdateExpression: `SET #services[${serviceIndex}] = :service, #updatedAt = :updatedAt`,
      ConditionExpression: `attribute_exists(PK) AND attribute_exists(SK) AND #services[${serviceIndex}].#schedule.#revision = :expectedRevision`,
      ExpressionAttributeNames: { '#services': 'services', '#schedule': 'operationalSchedule', '#revision': 'revision', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':service': service, ':updatedAt': updatedAt, ':expectedRevision': expectedRevision },
    }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, conflict: true };
    throw error;
  }
}

export async function createServiceVisitForBusiness({ businessId, visit }) {
  try {
    await ddb.send(new PutCommand({ TableName: tableName, Item: visitItem(businessId, visit), ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' }));
    return { ok: true, created: true, visit };
  } catch (error) {
    if (error?.name !== 'ConditionalCheckFailedException') throw error;
    const existing = await getServiceVisitForBusiness(businessId, visit.jobId, visit.id);
    return { ok: true, created: false, visit: existing };
  }
}

export async function createGeneratedServiceVisitsForBusiness({ businessId, visits }) {
  const results = [];
  for (const visit of visits) results.push(await createServiceVisitForBusiness({ businessId, visit }));
  return { created: results.filter((result) => result.created).map((result) => result.visit), existing: results.filter((result) => !result.created).map((result) => result.visit) };
}

export async function updateServiceVisitForBusiness({ businessId, visit, expectedRevision }) {
  try {
    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: visitItem(businessId, visit),
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #revision = :expectedRevision',
      ExpressionAttributeNames: { '#revision': 'revision' },
      ExpressionAttributeValues: { ':expectedRevision': expectedRevision },
    }));
    return { ok: true, visit };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, conflict: true };
    throw error;
  }
}

export function buildStartServiceVisitTransactionItem({ businessId, visit, startedAt }) {
  if (!visit || visit.status !== 'scheduled') return null;
  return {
    Update: {
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: visitSk(visit.jobId, visit.id) },
      UpdateExpression: 'SET #status = :inProgress, #updatedAt = :startedAt, #revision = #revision + :one',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :scheduled AND #revision = :expectedRevision',
      ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt', '#revision': 'revision' },
      ExpressionAttributeValues: { ':inProgress': 'in_progress', ':scheduled': 'scheduled', ':startedAt': startedAt, ':one': 1, ':expectedRevision': visit.revision },
    },
  };
}

export function buildStartServiceVisitTransactionItems({ businessId, visit, startedAt, actorUserId, actorName, auditEventId }) {
  const update = buildStartServiceVisitTransactionItem({ businessId, visit, startedAt });
  if (!update) return [];
  return [update, {
    Put: {
      TableName: tableName,
      Item: {
        PK: businessPk(businessId), SK: `AUDIT#${auditEventId}`, entityType: 'AUDIT_EVENT', businessId,
        eventId: auditEventId, action: 'service_visit.work_started', actorUserId, actorName: actorName || actorUserId,
        actorEmail: '', createdAt: startedAt, metadata: { jobId: visit.jobId, serviceId: visit.serviceId, visitId: visit.id },
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    },
  }];
}