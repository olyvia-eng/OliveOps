import { createHash } from 'node:crypto';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { isFormAssignedToEmployee, isJobOperationallyActive } from './formsEngine.js';

const SATISFYING_SUBMISSION_STATUSES = new Set(['submitted', 'approved']);

const businessPk = (businessId) => `BUSINESS#${businessId}`;
export const clockOutWorkflowSk = (occurrenceId) => `CLOCK_OUT_WORKFLOW#${occurrenceId}`;
export const pendingClockOutSk = (employeeId) => `CLOCK_OUT_PENDING#EMPLOYEE#${employeeId}`;

const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalized = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');

export function createClockOutOccurrenceId({ businessId, employeeId, timeEntryId, idempotencyKey }) {
  const digest = createHash('sha256')
    .update(`${businessId}\0${employeeId}\0${timeEntryId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `clock-out-${digest}`;
}

function requirementId(formId, context) {
  const digest = createHash('sha256')
    .update([formId, context.jobId, context.equipmentId, context.divisionId].filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 24);
  return `requirement-${digest}`;
}

function safeContext({ job, equipment, division }) {
  return {
    jobId: job?.id,
    jobName: job?.title,
    equipmentId: equipment?.id,
    equipmentName: equipment?.name,
    divisionId: division?.id ?? job?.divisionId,
    divisionName: division?.name,
  };
}

function assignmentContext({ form, employee, crews, divisions, jobs, equipment }) {
  const assignmentValue = text(form.assignmentValue || form.division);
  if (form.assignedTo === 'job') {
    const job = jobs.find((item) => item.id === assignmentValue);
    return job ? { job, division: divisions.find((item) => item.id === job.divisionId) } : null;
  }
  if (form.assignedTo === 'equipment') {
    const equipmentItem = equipment.find((item) => item.id === assignmentValue);
    const job = jobs.find((item) => item.assignedEquipmentIds?.includes(assignmentValue));
    return equipmentItem && job
      ? { job, equipment: equipmentItem, division: divisions.find((item) => item.id === job.divisionId) }
      : null;
  }
  if (form.assignedTo === 'division') {
    const division = divisions.find((item) => item.id === assignmentValue
      || normalized(item.name) === normalized(assignmentValue)
      || normalized(item.normalizedName) === normalized(assignmentValue));
    if (!division) return null;
    return { job: jobs.find((item) => item.divisionId === division.id), division };
  }
  const context = {};
  return isFormAssignedToEmployee({ form, employee, crews, divisions, ...context }) ? context : null;
}

export function resolveAfterClockOutForms({ forms = [], employee, crews = [], divisions = [], jobs = [], equipment = [] }) {
  const actionableJobs = jobs.filter(isJobOperationallyActive);
  const applicable = [];
  for (const form of forms) {
    if (form.status !== 'active' || !form.trigger?.includes('after_clock_out')) continue;
    const context = assignmentContext({ form, employee, crews, divisions, jobs: actionableJobs, equipment });
    if (!context || !isFormAssignedToEmployee({ form, employee, crews, divisions, ...context })) continue;
    const packagedContext = safeContext(context);
    applicable.push({
      requirementId: requirementId(form.id, packagedContext),
      formId: form.id,
      title: form.name,
      description: form.description ?? '',
      category: form.category,
      trigger: 'after_clock_out',
      order: applicable.length,
      context: packagedContext,
      completionRequirement: form.completionRequirement === 'required' ? 'required' : 'reminder',
    });
  }

  return {
    requiredForms: applicable.filter((form) => form.completionRequirement === 'required'),
    reminderForms: applicable.filter((form) => form.completionRequirement !== 'required'),
  };
}

export async function createPendingClockOutWorkflow({ businessId, workflow }) {
  const createdAt = workflow.createdAt;
  const workflowItem = {
    PK: businessPk(businessId),
    SK: clockOutWorkflowSk(workflow.workflowOccurrenceId),
    entityType: 'CLOCK_OUT_WORKFLOW',
    businessId,
    ...workflow,
    status: 'pending_required_forms',
    requiredRequirementIds: workflow.requiredForms.map((form) => form.requirementId),
    completedRequirementCount: 0,
    updatedAt: createdAt,
  };
  const pointerItem = {
    PK: businessPk(businessId),
    SK: pendingClockOutSk(workflow.employeeId),
    entityType: 'CLOCK_OUT_PENDING',
    businessId,
    employeeId: workflow.employeeId,
    timeEntryId: workflow.timeEntryId,
    workflowOccurrenceId: workflow.workflowOccurrenceId,
    createdAt,
    updatedAt: createdAt,
  };

  await ddb.send(new TransactWriteCommand({
    TransactItems: [workflowItem, pointerItem].map((Item) => ({
      Put: { TableName: tableName, Item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' },
    })),
  }));
  return workflowItem;
}

export async function getClockOutWorkflowForBusiness(businessId, workflowOccurrenceId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: clockOutWorkflowSk(workflowOccurrenceId) },
    ConsistentRead: true,
  }));
  return result.Item ?? null;
}

export async function getPendingClockOutWorkflowForEmployee(businessId, employeeId) {
  const pointerResult = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: pendingClockOutSk(employeeId) },
    ConsistentRead: true,
  }));
  const occurrenceId = pointerResult.Item?.workflowOccurrenceId;
  return occurrenceId ? getClockOutWorkflowForBusiness(businessId, occurrenceId) : null;
}

export function buildWorkflowCompletionUpdate({ businessId, employeeId, workflowOccurrenceId, requirementId: completedRequirementId, updatedAt }) {
  return {
    Update: {
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: clockOutWorkflowSk(workflowOccurrenceId) },
      UpdateExpression: 'SET #updatedAt = :updatedAt ADD #completedRequirementIds :requirementIds, #completedRequirementCount :one',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending AND #employeeId = :employeeId AND contains(#requiredRequirementIds, :requirementId) AND (attribute_not_exists(#completedRequirementIds) OR NOT contains(#completedRequirementIds, :requirementId))',
      ExpressionAttributeNames: {
        '#status': 'status', '#employeeId': 'employeeId', '#requiredRequirementIds': 'requiredRequirementIds',
        '#completedRequirementIds': 'completedRequirementIds', '#completedRequirementCount': 'completedRequirementCount', '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':pending': 'pending_required_forms', ':employeeId': employeeId, ':requirementId': completedRequirementId,
        ':requirementIds': new Set([completedRequirementId]), ':one': 1, ':updatedAt': updatedAt,
      },
    },
  };
}

export function buildWorkflowFinalizationItems({ businessId, workflow, finalizedAt, timeEntry }) {
  return [
    {
      Update: {
        TableName: tableName,
        Key: { PK: businessPk(businessId), SK: clockOutWorkflowSk(workflow.workflowOccurrenceId) },
        UpdateExpression: 'SET #status = :finalized, #finalizedAt = :finalizedAt, #updatedAt = :finalizedAt, #timeEntry = :timeEntry',
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending AND #completedRequirementCount = :requiredCount',
        ExpressionAttributeNames: {
          '#status': 'status', '#finalizedAt': 'finalizedAt', '#updatedAt': 'updatedAt',
          '#timeEntry': 'timeEntry', '#completedRequirementCount': 'completedRequirementCount',
        },
        ExpressionAttributeValues: {
          ':finalized': 'finalized', ':pending': 'pending_required_forms', ':finalizedAt': finalizedAt,
          ':timeEntry': timeEntry, ':requiredCount': workflow.requiredForms.length,
        },
      },
    },
    {
      Delete: {
        TableName: tableName,
        Key: { PK: businessPk(businessId), SK: pendingClockOutSk(workflow.employeeId) },
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #workflowOccurrenceId = :workflowOccurrenceId',
        ExpressionAttributeNames: { '#workflowOccurrenceId': 'workflowOccurrenceId' },
        ExpressionAttributeValues: { ':workflowOccurrenceId': workflow.workflowOccurrenceId },
      },
    },
  ];
}

export function findWorkflowRequirement(workflow, { formId, requirementId: requestedRequirementId }) {
  return workflow?.requiredForms?.find((requirement) => requirement.formId === formId
    && (!requestedRequirementId || requirement.requirementId === requestedRequirementId)) ?? null;
}

export function clockOutWorkflowStatus(workflow) {
  const completedIds = new Set(workflow?.completedRequirementIds ?? []);
  const requiredForms = workflow?.requiredForms ?? [];
  const completedForms = requiredForms.filter((form) => completedIds.has(form.requirementId));
  const remainingForms = requiredForms.filter((form) => !completedIds.has(form.requirementId));
  return {
    workflowOccurrenceId: workflow.workflowOccurrenceId,
    timeEntryId: workflow.timeEntryId,
    intendedClockOutAt: workflow.intendedClockOutAt,
    status: workflow.status === 'finalized' ? 'clock_out_already_finalized' : 'clock_out_pending_required_forms',
    requiredFormCount: requiredForms.length,
    completedRequiredFormCount: completedForms.length,
    remainingRequiredFormCount: remainingForms.length,
    requiredForms,
    completedForms,
    remainingForms,
    reminderForms: workflow.reminderForms ?? [],
    timeEntry: workflow.timeEntry,
  };
}

export function submissionSatisfiesWorkflowRequirement(submission, workflow, requirement) {
  return Boolean(submission
    && SATISFYING_SUBMISSION_STATUSES.has(submission.status)
    && submission.employeeId === workflow.employeeId
    && submission.formId === requirement.formId
    && submission.trigger === 'after_clock_out'
    && submission.workflowOccurrenceId === workflow.workflowOccurrenceId
    && submission.workflowRequirementId === requirement.requirementId);
}