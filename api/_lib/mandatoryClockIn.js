import { createHash } from 'node:crypto';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { isFormAssignedToEmployee, isJobOperationallyActive } from './formsEngine.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
export const clockInWorkflowSk = (occurrenceId) => `CLOCK_IN_WORKFLOW#${occurrenceId}`;
export const pendingClockInSk = (employeeId) => `CLOCK_IN_PENDING#EMPLOYEE#${employeeId}`;

const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalized = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');

export function createClockInOccurrenceId({ businessId, employeeId, idempotencyKey }) {
  const digest = createHash('sha256')
    .update(`${businessId}\0${employeeId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `clock-in-${digest}`;
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

function choicesForField(field, { employee, jobs, customers }) {
  if (field.type === 'employee_selector') return [{ value: employee.id, label: employee.name }];
  if (field.type === 'job_selector') return jobs.map((job) => ({ value: job.id, label: job.title }));
  if (field.type === 'customer_selector') {
    const customerIds = new Set(jobs.map((job) => job.customerId).filter(Boolean));
    return customers.filter((customer) => customerIds.has(customer.id)).map((customer) => ({ value: customer.id, label: customer.name }));
  }
  return undefined;
}

function formSnapshot({ form, context, fields, employee, jobs, customers }) {
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    category: form.category,
    trigger: 'before_clock_in',
    required: true,
    completionRequirement: form.completionRequirement === 'required' ? 'required' : 'reminder',
    requiresApproval: form.requiresApproval === true,
    enforcement: form.completionRequirement === 'required' ? 'blocking' : 'advisory',
    context,
    fields: fields
      .filter((field) => field.formId === form.id)
      .sort((left, right) => left.order - right.order)
      .map((field) => ({
        id: field.id,
        type: field.type,
        label: field.label,
        helpText: field.helpText ?? '',
        required: field.required,
        defaultValue: field.defaultValue ?? '',
        placeholder: field.placeholder ?? '',
        options: field.options ?? [],
        acceptedResponse: field.acceptedResponse,
        order: field.order,
        choices: choicesForField(field, { employee, jobs, customers }),
      })),
    submissionState: { completed: false },
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

export function resolveBeforeClockInForms({ forms = [], fields = [], employee, crews = [], divisions = [], jobs = [], equipment = [], customers = [] }) {
  const actionableJobs = jobs.filter(isJobOperationallyActive);
  const applicable = [];
  for (const form of forms) {
    if (form.status !== 'active' || !form.trigger?.includes('before_clock_in')) continue;
    const context = assignmentContext({ form, employee, crews, divisions, jobs: actionableJobs, equipment });
    if (!context || !isFormAssignedToEmployee({ form, employee, crews, divisions, ...context })) continue;
    const packagedContext = safeContext(context);
    const completionRequirement = form.completionRequirement === 'required' ? 'required' : 'reminder';
    applicable.push({
      requirementId: requirementId(form.id, packagedContext),
      formId: form.id,
      title: form.name,
      description: form.description ?? '',
      category: form.category,
      trigger: 'before_clock_in',
      order: applicable.length,
      context: packagedContext,
      completionRequirement,
      form: formSnapshot({ form, context: packagedContext, fields, employee, jobs: actionableJobs, customers }),
    });
  }
  return {
    requiredForms: applicable.filter((form) => form.completionRequirement === 'required'),
    reminderForms: applicable.filter((form) => form.completionRequirement !== 'required'),
  };
}

export async function createPendingClockInWorkflow({ businessId, workflow }) {
  const workflowItem = {
    PK: businessPk(businessId),
    SK: clockInWorkflowSk(workflow.workflowOccurrenceId),
    entityType: 'CLOCK_IN_WORKFLOW',
    businessId,
    ...workflow,
    status: 'pending_required_forms',
    requiredRequirementIds: workflow.requiredForms.map((form) => form.requirementId),
    completedRequirementCount: 0,
    updatedAt: workflow.createdAt,
  };
  const pointerItem = {
    PK: businessPk(businessId),
    SK: pendingClockInSk(workflow.employeeId),
    entityType: 'CLOCK_IN_PENDING',
    businessId,
    employeeId: workflow.employeeId,
    workflowOccurrenceId: workflow.workflowOccurrenceId,
    createdAt: workflow.createdAt,
    updatedAt: workflow.createdAt,
  };
  await ddb.send(new TransactWriteCommand({
    TransactItems: [workflowItem, pointerItem].map((Item) => ({
      Put: { TableName: tableName, Item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' },
    })),
  }));
  return workflowItem;
}

export async function getClockInWorkflowForBusiness(businessId, workflowOccurrenceId) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: clockInWorkflowSk(workflowOccurrenceId) },
    ConsistentRead: true,
  }));
  return result.Item ?? null;
}

export async function getPendingClockInWorkflowForEmployee(businessId, employeeId) {
  const pointer = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: businessPk(businessId), SK: pendingClockInSk(employeeId) },
    ConsistentRead: true,
  }));
  return pointer.Item?.workflowOccurrenceId
    ? getClockInWorkflowForBusiness(businessId, pointer.Item.workflowOccurrenceId)
    : null;
}

export function buildClockInWorkflowCompletionUpdate({ businessId, employeeId, workflowOccurrenceId, requirementId: completedRequirementId, updatedAt }) {
  return {
    Update: {
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: clockInWorkflowSk(workflowOccurrenceId) },
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

export function buildClockInWorkflowFinalizationItems({ businessId, workflow, finalizedAt, timeEntry }) {
  return [
    {
      Update: {
        TableName: tableName,
        Key: { PK: businessPk(businessId), SK: clockInWorkflowSk(workflow.workflowOccurrenceId) },
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
        Key: { PK: businessPk(businessId), SK: pendingClockInSk(workflow.employeeId) },
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #workflowOccurrenceId = :workflowOccurrenceId',
        ExpressionAttributeNames: { '#workflowOccurrenceId': 'workflowOccurrenceId' },
        ExpressionAttributeValues: { ':workflowOccurrenceId': workflow.workflowOccurrenceId },
      },
    },
  ];
}

export function findClockInWorkflowRequirement(workflow, { formId, requirementId: requestedRequirementId }) {
  return workflow?.requiredForms?.find((requirement) => requirement.formId === formId
    && (!requestedRequirementId || requirement.requirementId === requestedRequirementId)) ?? null;
}

export function clockInWorkflowStatus(workflow) {
  const completedIds = new Set(workflow?.completedRequirementIds ?? []);
  const requiredForms = (workflow?.requiredForms ?? []).map((form) => ({
    ...form,
    completed: completedIds.has(form.requirementId),
  }));
  const completedForms = requiredForms.filter((form) => form.completed);
  const remainingForms = requiredForms.filter((form) => !form.completed);
  return {
    workflowOccurrenceId: workflow.workflowOccurrenceId,
    status: workflow.status === 'finalized' ? 'clock_in_already_finalized' : 'clock_in_pending_required_forms',
    requiredFormCount: requiredForms.length,
    completedRequiredFormCount: completedForms.length,
    remainingRequiredFormCount: remainingForms.length,
    requiredForms,
    completedForms,
    remainingForms,
    reminderForms: workflow.reminderForms ?? [],
    clockInIntent: workflow.clockInIntent,
    timeEntry: workflow.timeEntry,
  };
}