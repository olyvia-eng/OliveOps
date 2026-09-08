import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const eventSk = (eventId) => `SNOW_EVENT#${eventId}`;
const routeSk = (eventId, routeId) => `SNOW_ROUTE#${eventId}#${routeId}`;
const routePrefix = (eventId) => `SNOW_ROUTE#${eventId}#`;
const stopSk = (eventId, routeId, stopId) => `SNOW_STOP#${eventId}#${routeId}#${stopId}`;
const stopPrefix = (eventId, routeId) => `SNOW_STOP#${eventId}#${routeId}#`;
const occurrenceSk = (eventId, routeId, stopId, occurrenceId) => `SNOW_OCCURRENCE#${eventId}#${routeId}#${stopId}#${occurrenceId}`;
const occurrencePrefix = (eventId, routeId, stopId = '') => `SNOW_OCCURRENCE#${eventId}#${routeId}#${stopId}`;
const evidenceSk = (eventId, routeId, stopId, occurrenceId, evidenceId) => `SNOW_EVIDENCE#${eventId}#${routeId}#${stopId}#${occurrenceId}#${evidenceId}`;
const evidencePrefix = (eventId, routeId, stopId = '') => `SNOW_EVIDENCE#${eventId}#${routeId}#${stopId}`;
const breadcrumbSk = (eventId, routeId, stopId, occurrenceId, batchId) => `SNOW_BREADCRUMB#${eventId}#${routeId}#${stopId}#${occurrenceId}#${batchId}`;
const breadcrumbPrefix = (eventId, routeId, stopId = '') => `SNOW_BREADCRUMB#${eventId}#${routeId}#${stopId}`;
const serviceTypeSk = (serviceTypeId) => `SNOW_SERVICE_TYPE#${serviceTypeId}`;
const idempotencySk = (employeeId, key) => `SNOW_IDEMPOTENCY#${employeeId}#${key}`;

const keyedItem = (businessId, sk, entityType, record) => ({
  PK: businessPk(businessId),
  SK: sk,
  entityType,
  businessId,
  ...record,
});

const stripKeys = (item) => {
  if (!item) return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...record } = item;
  return record;
};

async function queryPrefix(businessId, prefix) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': prefix },
      ExclusiveStartKey,
    }));
    items.push(...(result.Items ?? []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.map(stripKeys);
}

async function getRecord(businessId, sk) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: sk } }));
  return stripKeys(result.Item);
}

async function putRecord({ businessId, sk, entityType, record, expectedRevision, createOnly = false }) {
  const command = { TableName: tableName, Item: { PK: businessPk(businessId), SK: sk, entityType, businessId, ...record } };
  if (createOnly) command.ConditionExpression = 'attribute_not_exists(PK) AND attribute_not_exists(SK)';
  if (expectedRevision !== undefined) {
    command.ConditionExpression = 'attribute_exists(PK) AND attribute_exists(SK) AND #revision = :expectedRevision';
    command.ExpressionAttributeNames = { '#revision': 'revision' };
    command.ExpressionAttributeValues = { ':expectedRevision': expectedRevision };
  }
  try {
    await ddb.send(new PutCommand(command));
    return { ok: true, record };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return { ok: false, conflict: true };
    throw error;
  }
}

export const listSnowEventsForBusiness = (businessId) => queryPrefix(businessId, 'SNOW_EVENT#');
export const getSnowEventForBusiness = (businessId, eventId) => getRecord(businessId, eventSk(eventId));
export const putSnowEventForBusiness = ({ businessId, event, expectedRevision, createOnly }) => putRecord({ businessId, sk: eventSk(event.id), entityType: 'SNOW_EVENT', record: event, expectedRevision, createOnly });
export const listSnowRoutesForEvent = (businessId, eventId) => queryPrefix(businessId, routePrefix(eventId));
export const getSnowRouteForBusiness = (businessId, eventId, routeId) => getRecord(businessId, routeSk(eventId, routeId));
export const putSnowRouteForBusiness = ({ businessId, route, expectedRevision, createOnly }) => putRecord({ businessId, sk: routeSk(route.snowEventId, route.id), entityType: 'SNOW_ROUTE', record: route, expectedRevision, createOnly });
export const listSnowStopsForRoute = (businessId, eventId, routeId) => queryPrefix(businessId, stopPrefix(eventId, routeId));
export const getSnowStopForBusiness = (businessId, eventId, routeId, stopId) => getRecord(businessId, stopSk(eventId, routeId, stopId));
export const putSnowStopForBusiness = ({ businessId, stop, expectedRevision, createOnly }) => putRecord({ businessId, sk: stopSk(stop.snowEventId, stop.snowRouteId, stop.id), entityType: 'SNOW_ROUTE_STOP', record: stop, expectedRevision, createOnly });
export async function deleteSnowStopForBusiness({ businessId, eventId, routeId, stopId }) {
  await ddb.send(new DeleteCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: stopSk(eventId, routeId, stopId) }, ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)' }));
  return { ok: true };
}
export const listSnowOccurrencesForStop = (businessId, eventId, routeId, stopId) => queryPrefix(businessId, occurrencePrefix(eventId, routeId, stopId));
export const listSnowOccurrencesForRoute = (businessId, eventId, routeId) => queryPrefix(businessId, occurrencePrefix(eventId, routeId));
export const getSnowOccurrenceForBusiness = (businessId, eventId, routeId, stopId, occurrenceId) => getRecord(businessId, occurrenceSk(eventId, routeId, stopId, occurrenceId));
export const putSnowOccurrenceForBusiness = ({ businessId, occurrence, expectedRevision, createOnly }) => putRecord({ businessId, sk: occurrenceSk(occurrence.snowEventId, occurrence.snowRouteId, occurrence.routeStopId, occurrence.id), entityType: 'SNOW_SERVICE_OCCURRENCE', record: occurrence, expectedRevision, createOnly });
export const listSnowEvidenceForStop = (businessId, eventId, routeId, stopId) => queryPrefix(businessId, evidencePrefix(eventId, routeId, stopId));
export const putSnowEvidenceForBusiness = ({ businessId, evidence }) => putRecord({ businessId, sk: evidenceSk(evidence.snowEventId, evidence.snowRouteId, evidence.routeStopId, evidence.occurrenceId ?? 'none', evidence.id), entityType: 'SNOW_GPS_EVENT', record: evidence, createOnly: true });
export const listSnowBreadcrumbsForStop = (businessId, eventId, routeId, stopId) => queryPrefix(businessId, breadcrumbPrefix(eventId, routeId, stopId));
export const putSnowBreadcrumbBatchForBusiness = ({ businessId, batch }) => putRecord({ businessId, sk: breadcrumbSk(batch.snowEventId, batch.snowRouteId, batch.routeStopId, batch.occurrenceId, batch.id), entityType: 'SNOW_GPS_BREADCRUMB_BATCH', record: batch, createOnly: true });
export const listSnowServiceTypesForBusiness = (businessId) => queryPrefix(businessId, 'SNOW_SERVICE_TYPE#');
export const getSnowServiceTypeForBusiness = (businessId, serviceTypeId) => getRecord(businessId, serviceTypeSk(serviceTypeId));
export const putSnowServiceTypeForBusiness = ({ businessId, serviceType, expectedRevision, createOnly }) => putRecord({ businessId, sk: serviceTypeSk(serviceType.id), entityType: 'SNOW_SERVICE_TYPE', record: serviceType, expectedRevision, createOnly });

export async function claimSnowIdempotency({ businessId, employeeId, key, action, response, createdAt }) {
  const ttl = Math.floor(Date.parse(createdAt) / 1000) + (30 * 24 * 60 * 60);
  const record = { id: key, employeeId, action, response, createdAt, ttl };
  const result = await putRecord({ businessId, sk: idempotencySk(employeeId, key), entityType: 'SNOW_IDEMPOTENCY', record, createOnly: true });
  if (result.ok) return { ok: true, created: true, record };
  return { ok: true, created: false, record: await getRecord(businessId, idempotencySk(employeeId, key)) };
}

function transactionPut(businessId, write) {
  const definitions = {
    route: [routeSk(write.record.snowEventId, write.record.id), 'SNOW_ROUTE'],
    stop: [stopSk(write.record.snowEventId, write.record.snowRouteId, write.record.id), 'SNOW_ROUTE_STOP'],
    occurrence: [occurrenceSk(write.record.snowEventId, write.record.snowRouteId, write.record.routeStopId, write.record.id), 'SNOW_SERVICE_OCCURRENCE'],
    evidence: [evidenceSk(write.record.snowEventId, write.record.snowRouteId, write.record.routeStopId, write.record.occurrenceId ?? 'none', write.record.id), 'SNOW_GPS_EVENT'],
    breadcrumb: [breadcrumbSk(write.record.snowEventId, write.record.snowRouteId, write.record.routeStopId, write.record.occurrenceId, write.record.id), 'SNOW_GPS_BREADCRUMB_BATCH'],
  };
  const definition = definitions[write.kind];
  if (!definition) throw new Error(`Unsupported Snow transaction write: ${write.kind}`);
  const put = { TableName: tableName, Item: keyedItem(businessId, definition[0], definition[1], write.record) };
  if (write.createOnly) put.ConditionExpression = 'attribute_not_exists(PK) AND attribute_not_exists(SK)';
  if (write.expectedRevision !== undefined) {
    put.ConditionExpression = 'attribute_exists(PK) AND attribute_exists(SK) AND #revision = :expectedRevision';
    put.ExpressionAttributeNames = { '#revision': 'revision' };
    put.ExpressionAttributeValues = { ':expectedRevision': write.expectedRevision };
  }
  return { Put: put };
}

export async function commitSnowIdempotentMutation({ businessId, employeeId, key, action, response, createdAt, writes }) {
  const existing = await getRecord(businessId, idempotencySk(employeeId, key));
  if (existing) return existing.action === action ? { ok: true, replay: existing.response } : { ok: false, keyConflict: true };
  const ttl = Math.floor(Date.parse(createdAt) / 1000) + (30 * 24 * 60 * 60);
  const claim = { id: key, employeeId, action, response, createdAt, ttl };
  const TransactItems = [
    ...writes.map((write) => transactionPut(businessId, write)),
    { Put: { TableName: tableName, Item: keyedItem(businessId, idempotencySk(employeeId, key), 'SNOW_IDEMPOTENCY', claim), ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
  ];
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems }));
    return { ok: true, response };
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const racedClaim = await getRecord(businessId, idempotencySk(employeeId, key));
    if (racedClaim) return racedClaim.action === action ? { ok: true, replay: racedClaim.response } : { ok: false, keyConflict: true };
    return { ok: false, conflict: true };
  }
}
