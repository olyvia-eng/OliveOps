import { createHash, randomBytes } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const DEFAULT_PREFERENCES = Object.freeze({
  showOutlookEvents: true,
  syncOliveOpsJobs: false,
  scope: 'all_company_jobs',
  employeeIds: [],
  divisionIds: [],
});

const encodeKeyPart = (value) => Buffer.from(String(value), 'utf8').toString('base64url');
const nowIso = () => new Date().toISOString();

export const microsoftBusinessPk = (businessId) => `BUSINESS#${businessId}`;
export const microsoftConnectionSk = (userId) => `MICROSOFT_CONNECTION#${encodeKeyPart(userId)}`;
export const microsoftOAuthStateSk = (stateHash) => `MICROSOFT_OAUTH_STATE#${stateHash}`;
export const microsoftProjectionPrefix = (userId) => `MICROSOFT_EVENT#${encodeKeyPart(userId)}#`;
export const microsoftProjectionSk = (userId, calendarId, eventId) => `${microsoftProjectionPrefix(userId)}${encodeKeyPart(calendarId)}#${encodeKeyPart(eventId)}`;
export const microsoftJobMappingPrefix = (jobId) => `MICROSOFT_JOB_MAP#${encodeKeyPart(jobId)}#`;
export const microsoftJobMappingSk = (jobId, userId, calendarId) => `${microsoftJobMappingPrefix(jobId)}${encodeKeyPart(userId)}#${encodeKeyPart(calendarId)}`;
export const microsoftSyncOperationSk = (operationId) => `MICROSOFT_SYNC_OP#${encodeKeyPart(operationId)}`;

export const createMicrosoftOAuthStateValue = () => randomBytes(32).toString('base64url');
export const hashMicrosoftOAuthState = (state) => createHash('sha256').update(state).digest('hex');

export function toSafeMicrosoftConnection(item) {
  if (!item) return { connected: false, preferences: { ...DEFAULT_PREFERENCES } };
  return {
    connected: item.status === 'connected',
    microsoftAccountEmail: item.microsoftAccountEmail ?? '',
    microsoftAccountName: item.microsoftAccountName ?? '',
    selectedCalendarId: item.selectedCalendarId ?? '',
    selectedCalendarSummary: item.selectedCalendarSummary ?? '',
    connectedAt: item.connectedAt ?? null,
    updatedAt: item.updatedAt ?? null,
    lastSyncAt: item.lastSyncAt ?? null,
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...(item.preferences ?? {}),
      employeeIds: Array.isArray(item.preferences?.employeeIds) ? item.preferences.employeeIds : [],
      divisionIds: Array.isArray(item.preferences?.divisionIds) ? item.preferences.divisionIds : [],
    },
  };
}

export async function getMicrosoftConnection({ businessId, userId }) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: microsoftBusinessPk(businessId), SK: microsoftConnectionSk(userId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.userId !== userId) return null;
  return result.Item;
}

export async function listMicrosoftConnectionsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': microsoftBusinessPk(businessId), ':prefix': 'MICROSOFT_CONNECTION#' },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId && item.status === 'connected');
}

export async function putMicrosoftConnection({ businessId, userId, connection }) {
  const timestamp = nowIso();
  const existing = await getMicrosoftConnection({ businessId, userId });
  const item = {
    PK: microsoftBusinessPk(businessId),
    SK: microsoftConnectionSk(userId),
    entityType: 'MICROSOFT_CONNECTION',
    businessId,
    userId,
    status: 'connected',
    preferences: { ...DEFAULT_PREFERENCES, ...(existing?.preferences ?? {}), ...(connection.preferences ?? {}) },
    connectedAt: existing?.connectedAt ?? timestamp,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    ...connection,
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function updateMicrosoftConnectionSettings({ businessId, userId, selectedCalendarId, selectedCalendarSummary, preferences }) {
  const assignments = ['updatedAt = :updatedAt'];
  const values = { ':updatedAt': nowIso(), ':businessId': businessId, ':userId': userId, ':connected': 'connected' };
  if (selectedCalendarId !== undefined) {
    assignments.push('selectedCalendarId = :selectedCalendarId');
    values[':selectedCalendarId'] = selectedCalendarId;
  }
  if (selectedCalendarSummary !== undefined) {
    assignments.push('selectedCalendarSummary = :selectedCalendarSummary');
    values[':selectedCalendarSummary'] = selectedCalendarSummary;
  }
  if (preferences !== undefined) {
    assignments.push('preferences = :preferences');
    values[':preferences'] = { ...DEFAULT_PREFERENCES, ...preferences };
  }
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: microsoftBusinessPk(businessId), SK: microsoftConnectionSk(userId) },
    UpdateExpression: `SET ${assignments.join(', ')}`,
    ConditionExpression: 'businessId = :businessId AND userId = :userId AND #status = :connected',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: values,
  }));
}

export async function putMicrosoftOAuthState({ businessId, userId, stateHash, expiresAt, encryptedCodeVerifier }) {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: microsoftBusinessPk(businessId),
      SK: microsoftOAuthStateSk(stateHash),
      entityType: 'MICROSOFT_OAUTH_STATE',
      businessId,
      userId,
      stateHash,
      encryptedCodeVerifier,
      expiresAt,
      ttl: Math.floor(Date.parse(expiresAt) / 1000),
      createdAt: nowIso(),
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
}

export async function consumeMicrosoftOAuthState({ businessId, userId, stateHash, now = nowIso() }) {
  const result = await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: microsoftBusinessPk(businessId), SK: microsoftOAuthStateSk(stateHash) },
    ConditionExpression: 'businessId = :businessId AND userId = :userId AND stateHash = :stateHash AND expiresAt > :now',
    ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId, ':stateHash': stateHash, ':now': now },
    ReturnValues: 'ALL_OLD',
  }));
  return result.Attributes ?? null;
}

export async function acquireMicrosoftRefreshLease({ businessId, userId, leaseId, expiresAt }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: microsoftBusinessPk(businessId), SK: microsoftConnectionSk(userId) },
      UpdateExpression: 'SET refreshLeaseId = :leaseId, refreshLeaseExpiresAt = :expiresAt',
      ConditionExpression: 'businessId = :businessId AND userId = :userId AND #status = :connected AND (attribute_not_exists(refreshLeaseExpiresAt) OR refreshLeaseExpiresAt < :now)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId, ':connected': 'connected', ':leaseId': leaseId, ':expiresAt': expiresAt, ':now': nowIso() },
    }));
    return true;
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

export async function persistMicrosoftRefreshedCredentials({ businessId, userId, leaseId, credentials }) {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: microsoftBusinessPk(businessId), SK: microsoftConnectionSk(userId) },
    UpdateExpression: 'SET encryptedAccessToken = :access, encryptedRefreshToken = :refresh, accessTokenExpiresAt = :expiresAt, grantedScopes = :scopes, updatedAt = :updatedAt REMOVE refreshLeaseId, refreshLeaseExpiresAt',
    ConditionExpression: 'businessId = :businessId AND userId = :userId AND refreshLeaseId = :leaseId',
    ExpressionAttributeValues: {
      ':businessId': businessId,
      ':userId': userId,
      ':leaseId': leaseId,
      ':access': credentials.encryptedAccessToken,
      ':refresh': credentials.encryptedRefreshToken,
      ':expiresAt': credentials.accessTokenExpiresAt,
      ':scopes': credentials.grantedScopes,
      ':updatedAt': nowIso(),
    },
  }));
}

export async function releaseMicrosoftRefreshLease({ businessId, userId, leaseId }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: microsoftBusinessPk(businessId), SK: microsoftConnectionSk(userId) },
      UpdateExpression: 'REMOVE refreshLeaseId, refreshLeaseExpiresAt',
      ConditionExpression: 'businessId = :businessId AND userId = :userId AND refreshLeaseId = :leaseId',
      ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId, ':leaseId': leaseId },
    }));
  } catch (error) {
    if (error?.name !== 'ConditionalCheckFailedException') throw error;
  }
}

export async function putMicrosoftEventProjection({ businessId, userId, event }) {
  const item = {
    PK: microsoftBusinessPk(businessId),
    SK: microsoftProjectionSk(userId, event.externalCalendarId, event.externalEventId),
    entityType: 'MICROSOFT_EVENT_PROJECTION',
    businessId,
    userId,
    ...event,
    updatedAt: nowIso(),
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function listMicrosoftEventProjections({ businessId, userId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': microsoftBusinessPk(businessId), ':prefix': microsoftProjectionPrefix(userId) },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId && item.userId === userId);
}

export async function replaceMicrosoftEventProjectionsForRange({ businessId, userId, calendarId, rangeStart, rangeEnd, events }) {
  const existing = await listMicrosoftEventProjections({ businessId, userId });
  const incomingKeys = new Set(events.map((event) => microsoftProjectionSk(userId, calendarId, event.externalEventId)));
  const stale = existing.filter((item) => item.externalCalendarId === calendarId && item.start < rangeEnd && item.end > rangeStart && !incomingKeys.has(item.SK));
  await Promise.all([
    ...events.map((event) => putMicrosoftEventProjection({ businessId, userId, event })),
    ...stale.map((item) => ddb.send(new DeleteCommand({
      TableName: tableName,
      Key: { PK: item.PK, SK: item.SK },
      ConditionExpression: 'businessId = :businessId AND userId = :userId',
      ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId },
    }))),
  ]);
}

export async function putMicrosoftJobMapping({ businessId, userId, jobId, calendarId, microsoftEventId, transactionId, status = 'active' }) {
  const item = {
    PK: microsoftBusinessPk(businessId),
    SK: microsoftJobMappingSk(jobId, userId, calendarId),
    entityType: 'MICROSOFT_JOB_MAPPING',
    businessId,
    userId,
    jobId,
    microsoftCalendarId: calendarId,
    microsoftEventId,
    transactionId,
    status,
    updatedAt: nowIso(),
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function listMicrosoftJobMappings({ businessId, jobId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': microsoftBusinessPk(businessId), ':prefix': microsoftJobMappingPrefix(jobId) },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId && item.jobId === jobId);
}

export async function deleteMicrosoftJobMapping({ businessId, userId, jobId, calendarId }) {
  await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: microsoftBusinessPk(businessId), SK: microsoftJobMappingSk(jobId, userId, calendarId) },
    ConditionExpression: 'businessId = :businessId AND userId = :userId AND jobId = :jobId',
    ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId, ':jobId': jobId },
  }));
}

export async function putMicrosoftSyncOperation({ businessId, operation }) {
  const timestamp = nowIso();
  const item = { PK: microsoftBusinessPk(businessId), SK: microsoftSyncOperationSk(operation.id), entityType: 'MICROSOFT_SYNC_OPERATION', businessId, status: 'pending', attempts: 0, createdAt: timestamp, updatedAt: timestamp, ...operation };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function updateMicrosoftSyncOperation({ businessId, operationId, status, errorCode }) {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: microsoftBusinessPk(businessId), SK: microsoftSyncOperationSk(operationId) },
    UpdateExpression: 'SET #status = :status, attempts = if_not_exists(attempts, :zero) + :one, updatedAt = :updatedAt, errorCode = :errorCode',
    ConditionExpression: 'businessId = :businessId',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status, ':zero': 0, ':one': 1, ':updatedAt': nowIso(), ':errorCode': errorCode ?? null, ':businessId': businessId },
  }));
}

export async function deleteMicrosoftUserData({ businessId, userId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': microsoftBusinessPk(businessId) },
  }));
  const owned = (result.Items ?? []).filter((item) => item.businessId === businessId && item.userId === userId && item.entityType !== 'MICROSOFT_SYNC_OPERATION');
  await Promise.all(owned.map((item) => ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: item.PK, SK: item.SK },
    ConditionExpression: 'businessId = :businessId AND userId = :userId',
    ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId },
  }))));
}

export { DEFAULT_PREFERENCES as DEFAULT_MICROSOFT_PREFERENCES };