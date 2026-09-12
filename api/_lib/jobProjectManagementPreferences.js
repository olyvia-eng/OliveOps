import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

// A per-user (not per-job) preference: which Project Management cards a person wants to see, and in
// what order, across every job they open. Some crews use SOPs or Tasks heavily and others never look
// at them, so this is left entirely up to the individual rather than fixed per job or company-wide.
export const JOB_PROJECT_MANAGEMENT_CARD_IDS = [
  'resources',
  'tasks',
  'sops',
  'notes',
  'photos',
  'forms',
  'time-entries',
];

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const preferencesSk = (userId) => `JOB_PM_CARD_PREFERENCES#${userId}`;

export function normalizeJobProjectManagementCardIds(value) {
  const allowed = new Set(JOB_PROJECT_MANAGEMENT_CARD_IDS);
  const input = Array.isArray(value) ? value : JOB_PROJECT_MANAGEMENT_CARD_IDS;
  const cardIds = [];
  for (const id of input) {
    if (typeof id !== 'string' || !allowed.has(id) || cardIds.includes(id)) continue;
    cardIds.push(id);
  }
  return cardIds;
}

export async function getJobProjectManagementCardIdsForUser(businessId, userId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: preferencesSk(userId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.userId !== userId) {
    return [...JOB_PROJECT_MANAGEMENT_CARD_IDS];
  }
  return normalizeJobProjectManagementCardIds(result.Item.cardIds);
}

export async function saveJobProjectManagementCardIdsForUser({ businessId, userId, cardIds }) {
  const normalized = normalizeJobProjectManagementCardIds(cardIds);
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: businessPk(businessId),
      SK: preferencesSk(userId),
      entityType: 'JOB_PM_CARD_PREFERENCES',
      businessId,
      userId,
      cardIds: normalized,
      updatedAt: new Date().toISOString(),
    },
  }));
  return normalized;
}
