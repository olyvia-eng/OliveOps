import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const crewSk = (id) => `CREW#${id}`;
const divisionSk = (id) => `DIVISION#${id}`;
const preferencesSk = (userId) => `CALENDAR_PREFERENCES#${userId}`;
const nowIso = () => new Date().toISOString();

const mapCrew = (item) => item ? ({
  id: item.crewId,
  name: item.name,
  colour: item.colour,
  leadEmployeeId: item.leadEmployeeId,
  active: item.active !== false,
  defaultDivisionId: item.defaultDivisionId,
  memberIds: Array.isArray(item.memberIds) ? item.memberIds : [],
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
}) : null;

const mapDivision = (item) => item ? ({
  id: item.divisionId,
  name: item.name,
  normalizedName: item.normalizedName,
  colour: item.colour,
  active: item.active !== false,
  sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 0,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
}) : null;

async function listByPrefix(businessId, prefix, mapper) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': prefix },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId).map(mapper);
}

async function getOwned(businessId, SK, mapper) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK } }));
  if (!result.Item || result.Item.businessId !== businessId) return null;
  return mapper(result.Item);
}

export const listCrewsForBusiness = (businessId) => listByPrefix(businessId, 'CREW#', mapCrew);
export const getCrewForBusiness = (businessId, id) => getOwned(businessId, crewSk(id), mapCrew);
export const listDivisionsForBusiness = (businessId) => listByPrefix(businessId, 'DIVISION#', mapDivision);
export const getDivisionForBusiness = (businessId, id) => getOwned(businessId, divisionSk(id), mapDivision);

export async function saveCrewForBusiness({ businessId, crew }) {
  const existing = await getCrewForBusiness(businessId, crew.id);
  const timestamp = nowIso();
  const item = {
    PK: businessPk(businessId), SK: crewSk(crew.id), entityType: 'CREW', businessId, crewId: crew.id,
    ...crew, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
  };
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: existing ? 'attribute_exists(PK) AND attribute_exists(SK)' : 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return mapCrew(item);
}

export async function saveDivisionForBusiness({ businessId, division }) {
  const existing = await getDivisionForBusiness(businessId, division.id);
  const timestamp = nowIso();
  const item = {
    PK: businessPk(businessId), SK: divisionSk(division.id), entityType: 'DIVISION', businessId, divisionId: division.id,
    ...division, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
  };
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: existing ? 'attribute_exists(PK) AND attribute_exists(SK)' : 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return mapDivision(item);
}

export async function getCalendarPreferencesForUser(businessId, userId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: preferencesSk(userId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.userId !== userId) return null;
  return {
    view: result.Item.view,
    colourBy: result.Item.colourBy,
    showGoogleEvents: result.Item.showGoogleEvents,
  };
}

export async function saveCalendarPreferencesForUser({ businessId, userId, preferences }) {
  const item = {
    PK: businessPk(businessId), SK: preferencesSk(userId), entityType: 'CALENDAR_PREFERENCES',
    businessId, userId, ...preferences, updatedAt: nowIso(),
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return preferences;
}

export function normalizeDivisionName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}