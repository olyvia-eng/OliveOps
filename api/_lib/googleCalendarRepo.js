import { createHash, randomBytes } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const DEFAULT_PREFERENCES = Object.freeze({
  showGoogleEvents: true,
  syncOliveOpsJobs: false,
  scope: 'all_company_jobs',
  employeeIds: [],
  divisionIds: [],
});

const encodeKeyPart = (value) => Buffer.from(String(value), 'utf8').toString('base64url');
const nowIso = () => new Date().toISOString();

export const googleBusinessPk = (businessId) => `BUSINESS#${businessId}`;
export const googleConnectionSk = (userId) => `GOOGLE_CONNECTION#${encodeKeyPart(userId)}`;
export const googleOAuthStateSk = (stateHash) => `GOOGLE_OAUTH_STATE#${stateHash}`;
export const googleProjectionPrefix = (userId) => `GOOGLE_EVENT#${encodeKeyPart(userId)}#`;
export const googleProjectionSk = (userId, calendarId, eventId) => `${googleProjectionPrefix(userId)}${encodeKeyPart(calendarId)}#${encodeKeyPart(eventId)}`;
export const googleJobMappingPrefix = (jobId) => `GOOGLE_JOB_MAP#${encodeKeyPart(jobId)}#`;
export const googleJobMappingSk = (jobId, userId, calendarId) => `${googleJobMappingPrefix(jobId)}${encodeKeyPart(userId)}#${encodeKeyPart(calendarId)}`;
export const googleSyncOperationSk = (operationId) => `GOOGLE_SYNC_OP#${encodeKeyPart(operationId)}`;

export function hashOAuthState(state) {
  return createHash('sha256').update(state).digest('hex');
}

export function createOAuthStateValue() {
  return randomBytes(32).toString('base64url');
}

export function toSafeGoogleConnection(item) {
  if (!item) {
    return {
      connected: false,
      preferences: { ...DEFAULT_PREFERENCES },
    };
  }

  return {
    connected: item.status === 'connected',
    googleAccountEmail: item.googleAccountEmail ?? '',
    selectedCalendarId: item.selectedCalendarId ?? 'primary',
    selectedCalendarSummary: item.selectedCalendarSummary ?? 'Primary calendar',
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

export async function getGoogleConnection({ businessId, userId }) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: googleBusinessPk(businessId), SK: googleConnectionSk(userId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.userId !== userId) return null;
  return result.Item;
}

export async function listGoogleConnectionsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': googleBusinessPk(businessId), ':prefix': 'GOOGLE_CONNECTION#' },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId && item.status === 'connected');
}

export async function putGoogleConnection({ businessId, userId, connection }) {
  const timestamp = nowIso();
  const existing = await getGoogleConnection({ businessId, userId });
  const item = {
    PK: googleBusinessPk(businessId),
    SK: googleConnectionSk(userId),
    entityType: 'GOOGLE_CONNECTION',
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

export async function updateGoogleConnectionSettings({ businessId, userId, selectedCalendarId, selectedCalendarSummary, preferences }) {
  const names = { '#status': 'status' };
  const values = { ':connected': 'connected', ':updatedAt': nowIso() };
  const assignments = ['updatedAt = :updatedAt'];
  if (selectedCalendarId !== undefined) {
    values[':selectedCalendarId'] = selectedCalendarId;
    assignments.push('selectedCalendarId = :selectedCalendarId');
  }
  if (selectedCalendarSummary !== undefined) {
    values[':selectedCalendarSummary'] = selectedCalendarSummary;
    assignments.push('selectedCalendarSummary = :selectedCalendarSummary');
  }
  if (preferences !== undefined) {
    values[':preferences'] = { ...DEFAULT_PREFERENCES, ...preferences };
    assignments.push('preferences = :preferences');
  }
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: googleBusinessPk(businessId), SK: googleConnectionSk(userId) },
    UpdateExpression: `SET ${assignments.join(', ')}`,
    ConditionExpression: 'businessId = :businessId AND userId = :userId AND #status = :connected',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: { ...values, ':businessId': businessId, ':userId': userId },
  }));
}

export async function deleteGoogleConnection({ businessId, userId }) {
  await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: googleBusinessPk(businessId), SK: googleConnectionSk(userId) },
    ConditionExpression: 'businessId = :businessId AND userId = :userId',
    ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId },
  }));
}

export async function putOAuthState({ businessId, userId, stateHash, expiresAt }) {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: googleBusinessPk(businessId),
      SK: googleOAuthStateSk(stateHash),
      entityType: 'GOOGLE_OAUTH_STATE',
      businessId,
      userId,
      stateHash,
      expiresAt,
      ttl: Math.floor(Date.parse(expiresAt) / 1000),
      createdAt: nowIso(),
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
}

export async function consumeOAuthState({ businessId, userId, stateHash, now = nowIso() }) {
  const result = await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: googleBusinessPk(businessId), SK: googleOAuthStateSk(stateHash) },
    ConditionExpression: 'businessId = :businessId AND userId = :userId AND stateHash = :stateHash AND expiresAt > :now',
    ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId, ':stateHash': stateHash, ':now': now },
    ReturnValues: 'ALL_OLD',
  }));
  return result.Attributes ?? null;
}

export async function putGoogleEventProjection({ businessId, userId, event }) {
  const item = {
    PK: googleBusinessPk(businessId),
    SK: googleProjectionSk(userId, event.googleCalendarId, event.googleEventId),
    entityType: 'GOOGLE_EVENT_PROJECTION',
    businessId,
    userId,
    source: 'google',
    ...event,
    updatedAt: nowIso(),
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function listGoogleEventProjections({ businessId, userId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': googleBusinessPk(businessId), ':prefix': googleProjectionPrefix(userId) },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId && item.userId === userId);
}

export async function replaceGoogleEventProjectionsForRange({ businessId, userId, calendarId, rangeStart, rangeEnd, events }) {
  const existing = await listGoogleEventProjections({ businessId, userId });
  const incomingKeys = new Set(events.map((event) => googleProjectionSk(userId, calendarId, event.googleEventId)));
  const stale = existing.filter((item) => (
    item.googleCalendarId === calendarId
    && item.start < rangeEnd
    && item.end > rangeStart
    && !incomingKeys.has(item.SK)
  ));
  await Promise.all([
    ...events.map((event) => putGoogleEventProjection({ businessId, userId, event })),
    ...stale.map((item) => ddb.send(new DeleteCommand({
      TableName: tableName,
      Key: { PK: item.PK, SK: item.SK },
      ConditionExpression: 'businessId = :businessId AND userId = :userId',
      ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId },
    }))),
  ]);
}

export async function deleteGoogleUserData({ businessId, userId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': googleBusinessPk(businessId) },
  }));
  const owned = (result.Items ?? []).filter((item) => (
    item.businessId === businessId
    && item.userId === userId
    && item.entityType !== 'GOOGLE_SYNC_OPERATION'
  ));
  await Promise.all(owned.map((item) => ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: item.PK, SK: item.SK },
    ConditionExpression: 'businessId = :businessId AND userId = :userId',
    ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId },
  }))));
}

export async function putGoogleJobMapping({ businessId, userId, jobId, calendarId, googleEventId, status = 'active' }) {
  const timestamp = nowIso();
  const item = {
    PK: googleBusinessPk(businessId),
    SK: googleJobMappingSk(jobId, userId, calendarId),
    entityType: 'GOOGLE_JOB_MAPPING',
    businessId,
    userId,
    jobId,
    googleCalendarId: calendarId,
    googleEventId,
    status,
    updatedAt: timestamp,
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function listGoogleJobMappings({ businessId, jobId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': googleBusinessPk(businessId), ':prefix': googleJobMappingPrefix(jobId) },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId && item.jobId === jobId);
}

export async function putGoogleSyncOperation({ businessId, operation }) {
  const timestamp = nowIso();
  const item = {
    PK: googleBusinessPk(businessId),
    SK: googleSyncOperationSk(operation.id),
    entityType: 'GOOGLE_SYNC_OPERATION',
    businessId,
    status: 'pending',
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...operation,
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function updateGoogleSyncOperation({ businessId, operationId, status, errorCode }) {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: googleBusinessPk(businessId), SK: googleSyncOperationSk(operationId) },
    UpdateExpression: 'SET #status = :status, attempts = if_not_exists(attempts, :zero) + :one, updatedAt = :updatedAt, errorCode = :errorCode',
    ConditionExpression: 'businessId = :businessId',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': status,
      ':zero': 0,
      ':one': 1,
      ':updatedAt': nowIso(),
      ':errorCode': errorCode ?? null,
      ':businessId': businessId,
    },
  }));
}

export { DEFAULT_PREFERENCES };