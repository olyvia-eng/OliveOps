import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { divisionPlanIdentity } from './budgetDivisionPlanningModel.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const planPrefix = (budgetId, divisionId, category = '') => `BUDGET_DIVISION_PLAN#${budgetId}#DIVISION#${divisionId}#${category ? `CATEGORY#${category}#` : ''}`;
const planSk = (item) => `${planPrefix(item.budgetId, item.divisionId, item.category)}ITEM#${item.id}`;
const identitySk = (item) => `${planPrefix(item.budgetId, item.divisionId, item.category)}IDENTITY#${Buffer.from(divisionPlanIdentity(item)).toString('base64url')}`;

const mapItem = (item) => {
  const record = { ...item, id: item.planningItemId };
  delete record.PK;
  delete record.SK;
  delete record.entityType;
  delete record.businessId;
  delete record.planningItemId;
  delete record.identity;
  return record;
};

export async function listDivisionPlanningItemsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': 'BUDGET_DIVISION_PLAN#' },
  }));
  return (result.Items ?? []).filter((item) => item.entityType === 'BUDGET_DIVISION_PLAN').map(mapItem);
}

export async function listDivisionPlanningItems({ businessId, budgetId, divisionId, category }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': planPrefix(budgetId, divisionId, category) },
  }));
  return (result.Items ?? []).filter((item) => item.entityType === 'BUDGET_DIVISION_PLAN').map(mapItem);
}

const storedItem = (businessId, item) => ({
  PK: businessPk(businessId), SK: planSk(item), entityType: 'BUDGET_DIVISION_PLAN', businessId,
  planningItemId: item.id, identity: divisionPlanIdentity(item), ...item,
});

const identityItem = (businessId, item) => ({
  PK: businessPk(businessId), SK: identitySk(item), entityType: 'BUDGET_DIVISION_PLAN_IDENTITY', businessId,
  planningItemId: item.id, budgetId: item.budgetId, divisionId: item.divisionId, category: item.category,
});

export async function createDivisionPlanningItem({ businessId, item }) {
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: tableName, Item: storedItem(businessId, item), ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    { Put: { TableName: tableName, Item: identityItem(businessId, item), ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
  ] }));
  return item;
}

export async function createDivisionPlanningItems({ businessId, items }) {
  if (items.length === 0) return [];
  if (items.length > 50) throw new Error('No more than 50 planning items can be imported at once.');
  await ddb.send(new TransactWriteCommand({
    TransactItems: items.flatMap((item) => [
      { Put: { TableName: tableName, Item: storedItem(businessId, item), ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: tableName, Item: identityItem(businessId, item), ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ]),
  }));
  return items;
}

export async function updateDivisionPlanningItem({ businessId, previous, item }) {
  const transaction = [
    { Put: { TableName: tableName, Item: storedItem(businessId, item), ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)' } },
  ];
  if (divisionPlanIdentity(previous) !== divisionPlanIdentity(item)) {
    transaction.push(
      { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: identitySk(previous) } } },
      { Put: { TableName: tableName, Item: identityItem(businessId, item), ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    );
  }
  await ddb.send(new TransactWriteCommand({ TransactItems: transaction }));
  return item;
}

export async function deleteDivisionPlanningItem({ businessId, item }) {
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: planSk(item) } } },
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: identitySk(item) } } },
  ] }));
  return { ok: true };
}

export async function reorderDivisionPlanningItems({ businessId, items }) {
  if (items.length === 0) return [];
  const now = new Date().toISOString();
  await ddb.send(new TransactWriteCommand({
    TransactItems: items.map((item, sortOrder) => ({ Put: {
      TableName: tableName,
      Item: storedItem(businessId, { ...item, sortOrder, updatedAt: now }),
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    } })),
  }));
  return items.map((item, sortOrder) => ({ ...item, sortOrder, updatedAt: now }));
}
