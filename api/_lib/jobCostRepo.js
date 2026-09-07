import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const typePrefix = { equipment: 'JOB_EQUIPMENT_USAGE', vendor: 'VENDOR_BILL', subcontractor: 'SUBCONTRACTOR_BILL' };
const recordSk = (jobId, type, id) => `JOB_COST#${jobId}#${typePrefix[type]}#${id}`;
const vendorSk = (id) => `VENDOR#${id}`;
const withoutKeys = (item) => {
  if (!item) return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...record } = item;
  return record;
};

export async function listJobCostRecordsForBusiness(businessId, jobId) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': `JOB_COST#${jobId}#` },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  const records = items.map(withoutKeys);
  return {
    equipmentUsage: records.filter((record) => record.recordType === 'equipment'),
    vendorBills: records.filter((record) => record.recordType === 'vendor'),
    subcontractorBills: records.filter((record) => record.recordType === 'subcontractor'),
  };
}

export async function getJobCostRecordForBusiness(businessId, jobId, type, id) {
  if (!typePrefix[type]) return null;
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: recordSk(jobId, type, id) } }));
  return withoutKeys(result.Item);
}

export async function putJobCostRecordForBusiness({ businessId, record, expectedRevision }) {
  const create = expectedRevision === undefined;
  try {
    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: { PK: businessPk(businessId), SK: recordSk(record.jobId, record.recordType, record.id), entityType: typePrefix[record.recordType], businessId, ...record },
      ConditionExpression: create ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)' : 'attribute_exists(PK) AND attribute_exists(SK) AND #revision = :revision',
      ...(create ? {} : { ExpressionAttributeNames: { '#revision': 'revision' }, ExpressionAttributeValues: { ':revision': expectedRevision } }),
    }));
    return { ok: true, record };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, conflict: true };
    throw error;
  }
}

export async function deleteJobCostRecordForBusiness({ businessId, jobId, type, id, expectedRevision }) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: recordSk(jobId, type, id) },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #revision = :revision',
      ExpressionAttributeNames: { '#revision': 'revision' }, ExpressionAttributeValues: { ':revision': expectedRevision },
    }));
    return { ok: true };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, conflict: true };
    throw error;
  }
}

export async function listVendorsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': 'VENDOR#' } }));
  return (result.Items ?? []).map(withoutKeys);
}

export async function getVendorForBusiness(businessId, id) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: vendorSk(id) } }));
  return withoutKeys(result.Item);
}

export async function putVendorForBusiness({ businessId, vendor, create }) {
  await ddb.send(new PutCommand({ TableName: tableName, Item: { PK: businessPk(businessId), SK: vendorSk(vendor.id), entityType: 'VENDOR', businessId, ...vendor }, ConditionExpression: create ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)' : 'attribute_exists(PK) AND attribute_exists(SK)' }));
  return { ok: true, vendor };
}