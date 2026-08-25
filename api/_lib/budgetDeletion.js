import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { deleteBudgetForBusiness, listEstimatesForBusiness } from './authRepo.js';
import { repairBudgetGroupMembershipForDeletion } from './budgetGroups.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const MAX_TRANSACTION_ITEMS = 100;

const budgetOwnedQueries = (budgetId) => [
  { prefix: `BUDGET_DIVISION_PLAN#${budgetId}#`, owns: () => true },
  { prefix: `BUDGET_DIVISION#${budgetId}#`, owns: () => true },
  { prefix: 'BUDGET_RATE#', owns: (item) => item.budgetId === budgetId },
  { prefix: 'BUDGET#', owns: (item) => item.budgetId === budgetId },
  { prefix: 'LABOUR_BUDGET#', owns: (item) => item.budgetId === budgetId },
  { prefix: 'LABOUR_HOURS_GOAL#', owns: (item) => item.budgetId === budgetId },
  { prefix: 'REVENUE_GOAL#', owns: (item) => item.budgetId === budgetId },
  { prefix: 'EQUIPMENT_ALLOCATION#', owns: (item) => item.budgetId === budgetId },
];

async function queryByPrefix(businessId, prefix) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': prefix },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export async function auditBudgetDeletionForBusiness({ businessId, budgetId }) {
  const estimates = await listEstimatesForBusiness(businessId);
  const estimateCount = estimates.filter((estimate) => estimate.pricingBudgetId === budgetId).length;
  return {
    blocked: estimateCount > 0,
    dependencies: { estimates: estimateCount },
  };
}

function dependencyMessage({ estimates }) {
  const references = [];
  if (estimates > 0) references.push(`${estimates} Estimate${estimates === 1 ? '' : 's'}`);
  return `This Budget is referenced by ${references.join(' and ')} and cannot be deleted until those references are removed or reassigned.`;
}

function uniqueKeysForItems(businessId, items) {
  return [...new Map(items.map((item) => [item.SK, { PK: businessPk(businessId), SK: item.SK }])).values()]
    .sort((left, right) => left.SK.localeCompare(right.SK));
}

async function deleteKeysInBatches(keys) {
  for (let index = 0; index < keys.length; index += MAX_TRANSACTION_ITEMS) {
    const batch = keys.slice(index, index + MAX_TRANSACTION_ITEMS);
    await ddb.send(new TransactWriteCommand({
      TransactItems: batch.map((Key) => ({ Delete: { TableName: tableName, Key } })),
    }));
  }
}

export async function deleteBudgetCascadeForBusiness({ businessId, budgetId, budget }) {
  const audit = await auditBudgetDeletionForBusiness({ businessId, budgetId });
  if (audit.blocked) {
    return {
      ok: false,
      status: 409,
      code: 'BUDGET_IN_USE',
      error: dependencyMessage(audit.dependencies),
      dependencies: audit.dependencies,
    };
  }

  const queryResults = await Promise.all(budgetOwnedQueries(budgetId).map(async ({ prefix, owns }) => (
    (await queryByPrefix(businessId, prefix)).filter(owns)
  )));
  const childKeys = uniqueKeysForItems(businessId, queryResults.flat());

  if (!budget?.budgetGroupId && childKeys.length < MAX_TRANSACTION_ITEMS) {
    const finalAudit = await auditBudgetDeletionForBusiness({ businessId, budgetId });
    if (finalAudit.blocked) {
      return {
        ok: false,
        status: 409,
        code: 'BUDGET_IN_USE',
        error: dependencyMessage(finalAudit.dependencies),
        dependencies: finalAudit.dependencies,
      };
    }
    const parentKey = { PK: businessPk(businessId), SK: `BUDGET_META#${budgetId}` };
    await ddb.send(new TransactWriteCommand({
      TransactItems: [...childKeys, parentKey].map((Key) => ({ Delete: { TableName: tableName, Key } })),
    }));
    return { ok: true, deletedChildCount: childKeys.length };
  }

  await deleteKeysInBatches(childKeys);

  await repairBudgetGroupMembershipForDeletion({ businessId, budgetId });

  const finalAudit = await auditBudgetDeletionForBusiness({ businessId, budgetId });
  if (finalAudit.blocked) {
    return {
      ok: false,
      status: 409,
      code: 'BUDGET_IN_USE',
      error: dependencyMessage(finalAudit.dependencies),
      dependencies: finalAudit.dependencies,
    };
  }

  await deleteBudgetForBusiness(businessId, budgetId);
  return { ok: true, deletedChildCount: childKeys.length };
}