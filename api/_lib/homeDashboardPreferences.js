import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

export const PERSONAL_HOME_WIDGET_IDS = [
  'due-today',
  'overdue',
  'jobs-week',
  'hours-today',
  'calendar',
  'mini-calendar',
  'tasks',
  'upcoming',
  'activity',
  'quick-actions',
];

export const FINANCE_HOME_WIDGET_IDS = [
  'finance-outstanding-invoices',
  'finance-overdue-invoices',
  'finance-budget-profit',
];

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const preferencesSk = (userId) => `HOME_DASHBOARD_PREFERENCES#${userId}`;

export function allowedHomeWidgetIds(role) {
  return role === 'owner' || role === 'admin'
    ? [...PERSONAL_HOME_WIDGET_IDS, ...FINANCE_HOME_WIDGET_IDS]
    : [...PERSONAL_HOME_WIDGET_IDS];
}

export function normalizeHomeDashboardPreferences(value, role) {
  const allowed = new Set(allowedHomeWidgetIds(role));
  const input = Array.isArray(value?.widgetIds) ? value.widgetIds : PERSONAL_HOME_WIDGET_IDS;
  const widgetIds = [];

  for (const id of input) {
    if (typeof id !== 'string' || !allowed.has(id) || widgetIds.includes(id)) continue;
    widgetIds.push(id);
  }

  return { widgetIds };
}

export async function getHomeDashboardPreferencesForUser(businessId, userId, role) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: preferencesSk(userId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.userId !== userId) {
    return normalizeHomeDashboardPreferences(null, role);
  }
  return normalizeHomeDashboardPreferences({ widgetIds: result.Item.widgetIds }, role);
}

export async function saveHomeDashboardPreferencesForUser({ businessId, userId, role, preferences }) {
  const normalized = normalizeHomeDashboardPreferences(preferences, role);
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: preferencesSk(userId),
      entityType: 'HOME_DASHBOARD_PREFERENCES',
      businessId,
      userId,
      widgetIds: normalized.widgetIds,
      updatedAt: new Date().toISOString(),
    },
  }));
  return normalized;
}
