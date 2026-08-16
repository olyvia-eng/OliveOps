import { createHash } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { getBudgetForBusiness, getBudgetItemForBusiness, listBudgetItemsForBusiness } from './authRepo.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const budgetMetaSk = (budgetId) => `BUDGET_META#${budgetId}`;
const budgetGroupSk = (groupId) => `BUDGET_GROUP#${groupId}`;
const allocationPrefix = 'EQUIPMENT_ALLOCATION#';
const keyPart = (value) => Buffer.from(String(value), 'utf8').toString('base64url');
const allocationSk = (groupId, equipmentId, budgetId) => `${allocationPrefix}${keyPart(groupId)}#${keyPart(equipmentId)}#${keyPart(budgetId)}`;
const nowIso = () => new Date().toISOString();

export function buildEquipmentAllocationId({ budgetGroupId, equipmentId, budgetId }) {
  return createHash('sha256')
    .update(`${budgetGroupId}\0${equipmentId}\0${budgetId}`)
    .digest('hex')
    .slice(0, 32);
}

const mapGroup = (item) => item ? ({
  id: item.budgetGroupId,
  name: item.name,
  year: item.year,
  budgetIds: Array.isArray(item.budgetIds) ? item.budgetIds : [],
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
}) : null;

const mapAllocation = (item) => item ? ({
  id: item.allocationId,
  equipmentId: item.equipmentId,
  budgetGroupId: item.budgetGroupId,
  budgetId: item.budgetId,
  budgetItemId: item.budgetItemId,
  monthsAllocated: item.monthsAllocated,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
}) : null;

function budgetItem(businessId, budget, budgetGroupId) {
  return {
    PK: businessPk(businessId),
    SK: budgetMetaSk(budget.id),
    entityType: 'BUDGET',
    businessId,
    budgetId: budget.id,
    ...budget,
    budgetGroupId: budgetGroupId || undefined,
    updatedAt: nowIso(),
  };
}

function groupItem(businessId, group) {
  return {
    PK: businessPk(businessId),
    SK: budgetGroupSk(group.id),
    entityType: 'BUDGET_GROUP',
    businessId,
    budgetGroupId: group.id,
    name: group.name,
    year: group.year,
    budgetIds: group.budgetIds,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

export async function listBudgetGroupsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': 'BUDGET_GROUP#' },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId).map(mapGroup);
}

export async function getBudgetGroupForBusiness(businessId, groupId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: budgetGroupSk(groupId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId) return null;
  return mapGroup(result.Item);
}

export async function listEquipmentBudgetAllocationsForBusiness(businessId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': allocationPrefix },
  }));
  return (result.Items ?? []).filter((item) => item.businessId === businessId).map(mapAllocation);
}

export async function putEquipmentBudgetAllocation({ businessId, allocation }) {
  const timestamp = nowIso();
  const id = buildEquipmentAllocationId(allocation);
  const item = {
    PK: businessPk(businessId),
    SK: allocationSk(allocation.budgetGroupId, allocation.equipmentId, allocation.budgetId),
    entityType: 'EQUIPMENT_BUDGET_ALLOCATION',
    businessId,
    allocationId: id,
    ...allocation,
    id: undefined,
    createdAt: allocation.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
  return mapAllocation(item);
}

export async function deleteEquipmentBudgetAllocation({ businessId, budgetGroupId, equipmentId, budgetId }) {
  await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: allocationSk(budgetGroupId, equipmentId, budgetId) },
    ConditionExpression: 'businessId = :businessId',
    ExpressionAttributeValues: { ':businessId': businessId },
  }));
}

export async function saveEquipmentBudgetAllocationForItem({
  businessId,
  budgetId,
  equipmentId,
  budgetItemId,
  monthsAllocated,
}) {
  if (!Number.isFinite(monthsAllocated) || monthsAllocated <= 0 || monthsAllocated > 12) {
    return { ok: false, error: 'Annual cost allocation must be greater than 0 and no more than 12 months.' };
  }
  const context = await findBudgetGroupContext({ businessId, budgetId, equipmentId });
  if (!context || !context.group.budgetIds.includes(budgetId)) {
    return { ok: false, error: 'Equipment can only be allocated within the budget’s Budget Group.' };
  }
  const existing = context.allocations.find((allocation) => allocation.budgetId === budgetId);
  const allocatedElsewhere = context.allocations
    .filter((allocation) => allocation.id !== existing?.id)
    .reduce((sum, allocation) => sum + allocation.monthsAllocated, 0);
  if (allocatedElsewhere + monthsAllocated > 12) {
    return { ok: false, error: `Only ${Math.max(0, 12 - allocatedElsewhere)} months of annual cost responsibility remain in this Budget Group.` };
  }
  const allocation = await putEquipmentBudgetAllocation({
    businessId,
    allocation: {
      budgetGroupId: context.group.id,
      budgetId,
      equipmentId,
      budgetItemId,
      monthsAllocated,
      createdAt: existing?.createdAt,
    },
  });
  return { ok: true, allocation };
}

export async function saveGroupedEquipmentAllocationsForBusiness({
  businessId,
  budgetId,
  equipmentId,
  annualCost,
  allocations,
}) {
  if (!equipmentId || !Number.isFinite(annualCost) || annualCost < 0 || !Array.isArray(allocations) || allocations.length === 0) {
    return { ok: false, error: 'Equipment, annual cost, and allocation rows are required.' };
  }
  const context = await findBudgetGroupContext({ businessId, budgetId, equipmentId });
  if (!context || !context.group.budgetIds.includes(budgetId)) {
    return { ok: false, error: 'Equipment allocations must belong to one tenant-owned Budget Group.' };
  }

  const applicableBudgetItems = (await listBudgetItemsForBusiness(businessId)).filter((item) => (
    item.category === 'equipment'
    && item.equipmentId === equipmentId
    && item.budgetId
    && context.group.budgetIds.includes(item.budgetId)
  ));
  const applicableBudgetItemIds = new Set(applicableBudgetItems.map((item) => item.id));
  const submittedBudgetItemIds = new Set(allocations.map((allocation) => allocation?.budgetItemId));
  if (submittedBudgetItemIds.size !== allocations.length) {
    return { ok: false, error: 'Each applicable Budget Equipment row must appear exactly once.' };
  }
  const existingByBudgetItemId = new Map(context.allocations.map((allocation) => [allocation.budgetItemId, allocation]));
  if (
    allocations.length !== applicableBudgetItems.length
    || allocations.some((allocation) => !applicableBudgetItemIds.has(allocation.budgetItemId))
  ) {
    return { ok: false, error: 'Allocation changes must include every existing Budget Equipment row in this group.' };
  }

  const budgetItems = await Promise.all(allocations.map((allocation) => getBudgetItemForBusiness(businessId, allocation.budgetItemId)));
  const invalidRelationship = allocations.some((allocation, index) => {
    const item = budgetItems[index];
    const existing = existingByBudgetItemId.get(allocation.budgetItemId);
    return !item
      || item.category !== 'equipment'
      || item.equipmentId !== equipmentId
      || item.budgetId !== allocation.budgetId
      || (existing && existing.budgetId !== allocation.budgetId)
      || !context.group.budgetIds.includes(allocation.budgetId);
  });
  if (invalidRelationship) {
    return { ok: false, error: 'One or more allocations do not match an existing Budget Equipment relationship in this group.' };
  }

  if (allocations.some((allocation) => !Number.isFinite(allocation.monthsAllocated) || allocation.monthsAllocated <= 0 || allocation.monthsAllocated > 12)) {
    return { ok: false, error: 'Each annual cost allocation must be greater than 0 and no more than 12 months.' };
  }
  const totalMonths = allocations.reduce((sum, allocation) => sum + allocation.monthsAllocated, 0);
  if (totalMonths > 12) {
    return { ok: false, error: `${totalMonths} of 12 months are allocated. Reduce the allocation by ${totalMonths - 12} months.` };
  }

  const timestamp = nowIso();
  const transactItems = allocations.flatMap((allocation, index) => {
    const existing = existingByBudgetItemId.get(allocation.budgetItemId);
    const allocatedCost = annualCost * (allocation.monthsAllocated / 12);
    return [{
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: allocationSk(context.group.id, equipmentId, allocation.budgetId),
          entityType: 'EQUIPMENT_BUDGET_ALLOCATION',
          businessId,
          allocationId: existing?.id ?? buildEquipmentAllocationId({ budgetGroupId: context.group.id, equipmentId, budgetId: allocation.budgetId }),
          budgetGroupId: context.group.id,
          budgetId: allocation.budgetId,
          equipmentId,
          budgetItemId: allocation.budgetItemId,
          monthsAllocated: allocation.monthsAllocated,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        },
        ...(existing ? {
          ConditionExpression: 'businessId = :businessId AND budgetGroupId = :budgetGroupId AND equipmentId = :equipmentId AND budgetItemId = :budgetItemId',
          ExpressionAttributeValues: {
            ':businessId': businessId,
            ':budgetGroupId': context.group.id,
            ':equipmentId': equipmentId,
            ':budgetItemId': allocation.budgetItemId,
          },
        } : {
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        }),
      },
    }, {
      Put: {
        TableName: tableName,
        Item: {
          PK: businessPk(businessId),
          SK: `BUDGET#${allocation.budgetItemId}`,
          entityType: 'BUDGET_ITEM',
          businessId,
          budgetItemId: allocation.budgetItemId,
          ...budgetItems[index],
          budgeted: allocatedCost,
        },
        ConditionExpression: 'businessId = :businessId AND budgetId = :budgetId AND equipmentId = :equipmentId',
        ExpressionAttributeValues: {
          ':businessId': businessId,
          ':budgetId': allocation.budgetId,
          ':equipmentId': equipmentId,
        },
      },
    }];
  });
  if (transactItems.length > 100) return { ok: false, error: 'This equipment allocation is too large to save at once.' };
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return {
    ok: true,
    allocations: allocations.map((allocation) => ({
      ...existingByBudgetItemId.get(allocation.budgetItemId),
      id: existingByBudgetItemId.get(allocation.budgetItemId)?.id
        ?? buildEquipmentAllocationId({ budgetGroupId: context.group.id, equipmentId, budgetId: allocation.budgetId }),
      budgetGroupId: context.group.id,
      equipmentId,
      budgetId: allocation.budgetId,
      budgetItemId: allocation.budgetItemId,
      createdAt: existingByBudgetItemId.get(allocation.budgetItemId)?.createdAt ?? timestamp,
      monthsAllocated: allocation.monthsAllocated,
      updatedAt: timestamp,
    })),
    budgetItems: allocations.map((allocation, index) => ({
      ...budgetItems[index],
      budgeted: annualCost * (allocation.monthsAllocated / 12),
    })),
  };
}

export async function deleteEquipmentBudgetAllocationForItem({ businessId, budgetItemId }) {
  const allocations = await listEquipmentBudgetAllocationsForBusiness(businessId);
  const allocation = allocations.find((value) => value.budgetItemId === budgetItemId);
  if (!allocation) return { ok: true };
  await deleteEquipmentBudgetAllocation({
    businessId,
    budgetGroupId: allocation.budgetGroupId,
    equipmentId: allocation.equipmentId,
    budgetId: allocation.budgetId,
  });
  return { ok: true };
}

async function validateMembers({ businessId, budgetIds, year }) {
  const uniqueIds = [...new Set(budgetIds)];
  if (uniqueIds.length === 0) return { ok: false, error: 'Select at least one budget.' };
  const budgets = await Promise.all(uniqueIds.map((id) => getBudgetForBusiness(businessId, id)));
  if (budgets.some((budget) => !budget)) return { ok: false, error: 'One or more budgets do not belong to this business.' };
  if (budgets.some((budget) => budget.fiscalYear !== year)) {
    return { ok: false, error: 'All budgets in a Budget Group must use the same fiscal year.' };
  }
  return { ok: true, budgets };
}

export async function saveBudgetGroupForBusiness({
  businessId,
  group,
  confirmAllocationMove = false,
}) {
  const existing = await getBudgetGroupForBusiness(businessId, group.id);
  const validated = await validateMembers({ businessId, budgetIds: group.budgetIds, year: group.year });
  if (!validated.ok) return validated;

  const [allGroups, allocations] = await Promise.all([
    listBudgetGroupsForBusiness(businessId),
    listEquipmentBudgetAllocationsForBusiness(businessId),
  ]);
  const otherGroups = allGroups.filter((value) => value.id !== group.id);
  const movingBudgets = validated.budgets.filter((budget) => budget.budgetGroupId && budget.budgetGroupId !== group.id);
  const movingBudgetIds = new Set(movingBudgets.map((budget) => budget.id));
  const movingAllocations = allocations.filter((allocation) => movingBudgetIds.has(allocation.budgetId));
  if (movingAllocations.length > 0 && !confirmAllocationMove) {
    return {
      ok: false,
      code: 'ALLOCATION_MOVE_CONFIRMATION_REQUIRED',
      error: 'Moving these budgets will move their equipment allocations to the new group.',
      impact: { budgetIds: [...movingBudgetIds], allocationCount: movingAllocations.length },
    };
  }

  const timestamp = nowIso();
  const nextGroup = {
    ...group,
    budgetIds: [...new Set(group.budgetIds)],
    createdAt: existing?.createdAt ?? group.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const previousMemberIds = new Set(existing?.budgetIds ?? []);
  const nextMemberIds = new Set(nextGroup.budgetIds);
  const removedIds = [...previousMemberIds].filter((id) => !nextMemberIds.has(id));
  const removedBudgets = await Promise.all(removedIds.map((id) => getBudgetForBusiness(businessId, id)));
  const changedOtherGroups = otherGroups
    .filter((other) => other.budgetIds.some((id) => movingBudgetIds.has(id)))
    .map((other) => ({ ...other, budgetIds: other.budgetIds.filter((id) => !movingBudgetIds.has(id)), updatedAt: timestamp }));

  const transactItems = [{
    Put: {
      TableName: tableName,
      Item: groupItem(businessId, nextGroup),
      ConditionExpression: existing ? 'attribute_exists(PK) AND attribute_exists(SK)' : 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    },
  }];
  for (const changed of changedOtherGroups) {
    if (changed.budgetIds.length === 0) {
      transactItems.push({ Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: budgetGroupSk(changed.id) } } });
    } else {
      transactItems.push({ Put: { TableName: tableName, Item: groupItem(businessId, changed), ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)' } });
    }
  }
  for (const budget of validated.budgets) {
    transactItems.push({ Put: { TableName: tableName, Item: budgetItem(businessId, budget, nextGroup.id), ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)' } });
  }
  for (const budget of removedBudgets.filter(Boolean)) {
    transactItems.push({ Put: { TableName: tableName, Item: budgetItem(businessId, budget, undefined), ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)' } });
  }
  for (const allocation of allocations.filter((value) => removedIds.includes(value.budgetId))) {
    transactItems.push({ Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: allocationSk(allocation.budgetGroupId, allocation.equipmentId, allocation.budgetId) } } });
  }
  for (const allocation of movingAllocations) {
    transactItems.push({ Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: allocationSk(allocation.budgetGroupId, allocation.equipmentId, allocation.budgetId) } } });
    transactItems.push({ Put: { TableName: tableName, Item: {
      PK: businessPk(businessId),
      SK: allocationSk(nextGroup.id, allocation.equipmentId, allocation.budgetId),
      entityType: 'EQUIPMENT_BUDGET_ALLOCATION',
      businessId,
      allocationId: buildEquipmentAllocationId({ ...allocation, budgetGroupId: nextGroup.id }),
      ...allocation,
      budgetGroupId: nextGroup.id,
      updatedAt: timestamp,
    } } });
  }
  if (transactItems.length > 100) return { ok: false, error: 'This group change is too large to save at once.' };
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return { ok: true, group: nextGroup, movedAllocationCount: movingAllocations.length };
}

export async function dissolveBudgetGroupForBusiness({ businessId, groupId }) {
  const group = await getBudgetGroupForBusiness(businessId, groupId);
  if (!group) return { ok: false, error: 'Budget Group not found.' };
  const [budgets, allocations] = await Promise.all([
    Promise.all(group.budgetIds.map((id) => getBudgetForBusiness(businessId, id))),
    listEquipmentBudgetAllocationsForBusiness(businessId),
  ]);
  const transactItems = [{ Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: budgetGroupSk(groupId) } } }];
  for (const budget of budgets.filter(Boolean)) {
    transactItems.push({ Put: { TableName: tableName, Item: budgetItem(businessId, budget, undefined), ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)' } });
  }
  for (const allocation of allocations.filter((value) => value.budgetGroupId === groupId)) {
    transactItems.push({ Delete: { TableName: tableName, Key: { PK: businessPk(businessId), SK: allocationSk(groupId, allocation.equipmentId, allocation.budgetId) } } });
  }
  if (transactItems.length > 100) return { ok: false, error: 'This group is too large to dissolve at once.' };
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return { ok: true };
}

export async function repairBudgetGroupMembershipForDeletion({ businessId, budgetId }) {
  const budget = await getBudgetForBusiness(businessId, budgetId);
  if (!budget?.budgetGroupId) return;
  const group = await getBudgetGroupForBusiness(businessId, budget.budgetGroupId);
  if (!group) return;
  const remainingBudgetIds = group.budgetIds.filter((id) => id !== budgetId);
  if (remainingBudgetIds.length === 0) {
    await dissolveBudgetGroupForBusiness({ businessId, groupId: group.id });
    return;
  }
  await saveBudgetGroupForBusiness({
    businessId,
    group: { ...group, budgetIds: remainingBudgetIds },
    confirmAllocationMove: true,
  });
}

export async function findBudgetGroupContext({ businessId, budgetId, equipmentId }) {
  const budget = await getBudgetForBusiness(businessId, budgetId);
  if (!budget?.budgetGroupId) return null;
  const [group, allocations] = await Promise.all([
    getBudgetGroupForBusiness(businessId, budget.budgetGroupId),
    listEquipmentBudgetAllocationsForBusiness(businessId),
  ]);
  if (!group) return null;
  return {
    budget,
    group,
    allocations: allocations.filter((allocation) => allocation.budgetGroupId === group.id && (!equipmentId || allocation.equipmentId === equipmentId)),
  };
}

export { allocationSk, budgetGroupSk };