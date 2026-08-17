import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

export const APPEARANCE_STYLES = ['standard', 'tinted-glass', 'clear-glass'];

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const preferencesSk = (userId) => `UI_PREFERENCES#${userId}`;

export function normalizeUiPreferences(value) {
  return {
    appearanceStyle: APPEARANCE_STYLES.includes(value?.appearanceStyle) ? value.appearanceStyle : 'standard',
    sidebarCollapsed: value?.sidebarCollapsed === true,
  };
}

export async function getUiPreferencesForUser(businessId, userId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: preferencesSk(userId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.userId !== userId) {
    return normalizeUiPreferences(null);
  }
  return normalizeUiPreferences(result.Item);
}

export async function saveUiPreferencesForUser({ businessId, userId, preferences }) {
  const normalized = normalizeUiPreferences(preferences);
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: preferencesSk(userId),
      entityType: 'UI_PREFERENCES',
      businessId,
      userId,
      ...normalized,
      updatedAt: new Date().toISOString(),
    },
  }));
  return normalized;
}