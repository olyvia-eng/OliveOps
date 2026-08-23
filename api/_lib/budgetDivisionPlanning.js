import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { divisionPlanIdentity, normalizeLabourPlanAssumptions } from './budgetDivisionPlanningModel.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const planPrefix = (budgetId, divisionId, category = '') => `BUDGET_DIVISION_PLAN#${budgetId}#DIVISION#${divisionId}#${category ? `CATEGORY#${category}#` : ''}`;
const budgetCategoryPrefix = (budgetId, category) => `BUDGET_DIVISION_PLAN#${budgetId}#CATEGORY#${category}#`;
const legacyPlanSk = (item) => `${planPrefix(item.budgetId, item.divisionId, item.category)}ITEM#${item.id}`;
const legacyIdentitySk = (item) => `${planPrefix(item.budgetId, item.divisionId, item.category)}IDENTITY#${Buffer.from(divisionPlanIdentity(item)).toString('base64url')}`;
const isBudgetScoped = (item) => item.category === 'labour' || item.category === 'overhead';
const planSk = (item) => isBudgetScoped(item)
  ? `${budgetCategoryPrefix(item.budgetId, item.category)}ITEM#${item.id}`
  : legacyPlanSk(item);
const identitySk = (item) => isBudgetScoped(item)
  ? `${budgetCategoryPrefix(item.budgetId, item.category)}IDENTITY#${Buffer.from(divisionPlanIdentity(item)).toString('base64url')}`
  : legacyIdentitySk(item);

const mapItem = (item) => {
  const record = { ...item, id: item.planningItemId };
  delete record.PK;
  delete record.SK;
  delete record.entityType;
  delete record.businessId;
  delete record.planningItemId;
  delete record.identity;
  return normalizeLabourPlanAssumptions(record);
};

export async function listDivisionPlanningItemsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': 'BUDGET_DIVISION_PLAN#' },
  }));
  return (result.Items ?? []).filter((item) => item.entityType === 'BUDGET_DIVISION_PLAN').map(mapItem);
}

export async function listBudgetPlanningItems({ businessId, budgetId, category }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': `BUDGET_DIVISION_PLAN#${budgetId}#` },
  }));
  const items = (result.Items ?? [])
    .filter((item) => item.entityType === 'BUDGET_DIVISION_PLAN' && item.category === category)
    .map(mapItem);
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export async function listDivisionPlanningItems({ businessId, budgetId, divisionId, category }) {
  if (category === 'labour' || category === 'overhead') {
    const items = await listBudgetPlanningItems({ businessId, budgetId, category });
    return items.filter((item) => category === 'labour'
      ? item.divisionAllocations.some((allocation) => allocation.divisionId === divisionId && (allocation.hours ?? allocation.percentage ?? 0) > 0)
      : item.overheadDivisionAllocations?.some((allocation) => allocation.divisionId === divisionId && allocation.percentage > 0));
  }
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
  if (isBudgetScoped(item)) {
    const previousIdentityChanged = divisionPlanIdentity(previous) !== divisionPlanIdentity(item);
    const transaction = [
      { Put: { TableName: tableName, Item: storedItem(businessId, item) } },
      { Put: {
        TableName: tableName,
        Item: identityItem(businessId, item),
        ConditionExpression: 'attribute_not_exists(PK) OR planningItemId = :planningItemId',
        ExpressionAttributeValues: { ':planningItemId': item.id },
      } },
      { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: legacyPlanSk(previous) } } },
      { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: legacyIdentitySk(previous) } } },
    ];
    if (previousIdentityChanged) {
      transaction.push({ Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: identitySk(previous) } } });
    }
    await ddb.send(new TransactWriteCommand({ TransactItems: transaction }));
    return item;
  }
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
  const transaction = [
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: planSk(item) } } },
    { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: identitySk(item) } } },
  ];
  if (isBudgetScoped(item)) {
    transaction.push(
      { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: legacyPlanSk(item) } } },
      { Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: legacyIdentitySk(item) } } },
    );
  }
  await ddb.send(new TransactWriteCommand({ TransactItems: transaction }));
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
