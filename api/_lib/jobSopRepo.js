import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const associationSk = (jobId, sopId) => `JOB_SOP#${jobId}#${sopId}`;
const reverseSk = (sopId, jobId) => `SOP_JOB#${sopId}#${jobId}`;
const MAX_ASSOCIATIONS_PER_TRANSACTION = 50;

function withoutKeys(item) {
  if (!item) return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...record } = item;
  return record;
}

async function queryPrefix(businessId, prefix) {
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

export async function getJobSopAssociationForBusiness(businessId, jobId, sopId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: associationSk(jobId, sopId) },
  }));
  return withoutKeys(result.Item);
}

export async function listJobSopAssociationsForBusiness(businessId, jobId) {
  return (await queryPrefix(businessId, `JOB_SOP#${jobId}#`)).map(withoutKeys);
}

export async function listAllJobSopAssociationsForBusiness(businessId) {
  return (await queryPrefix(businessId, 'JOB_SOP#')).map(withoutKeys);
}

export async function addJobSopAssociationForBusiness({ businessId, jobId, sopId, actor }) {
  const existing = await getJobSopAssociationForBusiness(businessId, jobId, sopId);
  if (existing) return existing;

  const association = {
    businessId,
    jobId,
    sopId,
    addedAt: new Date().toISOString(),
    addedBy: actor.id,
    addedByName: actor.name,
  };
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: associationSk(jobId, sopId), entityType: 'JOB_SOP_ASSOCIATION', ...association }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: reverseSk(sopId, jobId), entityType: 'SOP_JOB_ASSOCIATION', ...association }, ConditionExpression: 'attribute_not_exists(PK)' } },
    ] }));
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const winner = await getJobSopAssociationForBusiness(businessId, jobId, sopId);
    if (!winner) throw error;
    return winner;
  }
  return association;
}

export async function removeJobSopAssociationForBusiness({ businessId, jobId, sopId }) {
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: associationSk(jobId, sopId) } } },
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: reverseSk(sopId, jobId) } } },
  ] }));
  return { ok: true };
}

async function removeAssociationsInBatches(businessId, associations) {
  for (let index = 0; index < associations.length; index += MAX_ASSOCIATIONS_PER_TRANSACTION) {
    const batch = associations.slice(index, index + MAX_ASSOCIATIONS_PER_TRANSACTION);
    await ddb.send(new TransactWriteCommand({ TransactItems: batch.flatMap(({ jobId, sopId }) => [
      { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: associationSk(jobId, sopId) } } },
      { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: reverseSk(sopId, jobId) } } },
    ]) }));
  }
  return associations.length;
}

export async function removeJobSopAssociationsForJob(businessId, jobId) {
  const associations = (await queryPrefix(businessId, `JOB_SOP#${jobId}#`)).map(withoutKeys);
  return removeAssociationsInBatches(businessId, associations);
}

export async function removeJobSopAssociationsForSop(businessId, sopId) {
  const associations = (await queryPrefix(businessId, `SOP_JOB#${sopId}#`)).map(withoutKeys);
  return removeAssociationsInBatches(businessId, associations);
}