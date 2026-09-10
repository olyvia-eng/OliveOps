import { createHash } from 'node:crypto';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { isClockDeliverySatisfied, isFormAssignedToEmployee, isFormDeliveredBy, isJobOperationallyActive, runtimeDeliveryRule } from './formsEngine.js';

const SATISFYING_SUBMISSION_STATUSES = new Set(['submitted', 'pending_review', 'approved']);

const businessPk = (businessId) => `BUSINESS#${businessId}`;
export const clockOutWorkflowSk = (occurrenceId) => `CLOCK_OUT_WORKFLOW#${occurrenceId}`;
export const pendingClockOutSk = (employeeId) => `CLOCK_OUT_PENDING#EMPLOYEE#${employeeId}`;
const timeEntrySk = (timeEntryId) => `TIME#${timeEntryId}`;
const auditEventSk = (eventId) => `AUDIT#${eventId}`;

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
    .update([formId, context.jobId, context.equipmentId, context.divisionId, context.serviceId, context.serviceVisitId].filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 24);
  return `requirement-${digest}`;
}

function safeContext({ job, equipment, division, service, serviceVisit }) {
  return {
    jobId: job?.id,
    jobName: job?.title,
    equipmentId: equipment?.id,
    equipmentName: equipment?.name,
    divisionId: division?.id ?? job?.divisionId,
    divisionName: division?.name,
    ...(service?.id ? { serviceId: service.id, serviceName: service.name } : {}),
    ...(serviceVisit?.id ? { serviceVisitId: serviceVisit.id } : {}),
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
    trigger: 'after_clock_out',
    ...(form.deliveryRule ? { deliveryRule: form.deliveryRule } : {}),
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

export function resolveAfterClockOutForms({ forms = [], fields = [], submissions = [], employee, crews = [], divisions = [], jobs = [], equipment = [], customers = [], service, serviceVisit, instant = new Date(), timeZone }) {
  const actionableJobs = jobs.filter(isJobOperationallyActive);
  const applicable = [];
  for (const form of forms) {
    if (form.status !== 'active' || !isFormDeliveredBy(form, 'after_clock_out')) continue;
    if (isClockDeliverySatisfied({ form, deliveryType: 'after_clock_out', employeeId: employee.id, submissions, instant, timeZone })) continue;
    const context = assignmentContext({ form, employee, crews, divisions, jobs: actionableJobs, equipment });
    if (!context || !isFormAssignedToEmployee({ form, employee, crews, divisions, ...context })) continue;
    const packagedContext = safeContext({ ...context, service, serviceVisit });
    const rule = runtimeDeliveryRule(form);
    applicable.push({
      requirementId: requirementId(form.id, packagedContext),
      formId: form.id,
      title: form.name,
      description: form.description ?? '',
      category: form.category,
      trigger: 'after_clock_out',
      order: applicable.length,
      context: packagedContext,
      completionRequirement: rule.completionBehavior === 'blocking' ? 'required' : 'reminder',
      form: formSnapshot({ form, context: packagedContext, fields, employee, jobs: actionableJobs, customers }),
    });
  }

  return {
    requiredForms: applicable.filter((form) => form.completionRequirement === 'required'),
    reminderForms: applicable.filter((form) => form.completionRequirement !== 'required'),
  };
}

export async function createPendingClockOutWorkflow({ businessId, workflow, clockOutTransaction }) {
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
    TransactItems: [
      ...(clockOutTransaction?.TransactItems ?? []),
      ...[workflowItem, pointerItem].map((Item) => ({
        Put: { TableName: tableName, Item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' },
      })),
    ],
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

export async function administrativelyResolvePendingClockOutWorkflow({
  session,
  employeeId,
  workflowOccurrenceId,
  reason,
  resolvedAt = new Date().toISOString(),
}) {
  if (session?.role !== 'owner' && session?.role !== 'admin') {
    return { ok: false, status: 403, code: 'clock_out_admin_resolution_forbidden', error: 'Only an Owner or Admin can resolve a required form block.' };
  }

  const workflow = await getClockOutWorkflowForBusiness(session.businessId, workflowOccurrenceId);
  if (!workflow || workflow.employeeId !== employeeId) {
    return { ok: false, status: 404, code: 'clock_out_workflow_not_found', error: 'Pending clock-out workflow not found.' };
  }
  if (workflow.status === 'administratively_resolved') {
    return { ok: true, status: 'clock_out_already_administratively_resolved', workflow };
  }
  if (workflow.status !== 'pending_required_forms') {
    return { ok: false, status: 409, code: 'clock_out_workflow_not_pending', error: 'This clock-out workflow is no longer pending.' };
  }

  const trimmedReason = text(reason);
  if (!trimmedReason) {
    return { ok: false, status: 400, code: 'clock_out_admin_resolution_reason_required', error: 'A reason is required.' };
  }
  if (trimmedReason.length > 1000) {
    return { ok: false, status: 400, code: 'clock_out_admin_resolution_reason_invalid', error: 'Reason must be 1,000 characters or fewer.' };
  }

  const originalRequirementIds = (workflow.requiredForms ?? []).map((requirement) => requirement.requirementId);
  const resolutionType = 'admin_override_missing_submission';
  const auditEventId = `clock-out-admin-resolution-${workflowOccurrenceId}`;
  const administrativeResolution = {
    resolutionType,
    resolvedBy: session.id,
    resolvedAt,
    reason: trimmedReason,
    originalWorkflowOccurrenceId: workflowOccurrenceId,
    originalRequirementIds,
  };

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: businessPk(session.businessId), SK: timeEntrySk(workflow.timeEntryId) },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #employeeId = :employeeId AND #status = :clockedOut',
          ExpressionAttributeNames: { '#employeeId': 'employeeId', '#status': 'status' },
          ExpressionAttributeValues: { ':employeeId': employeeId, ':clockedOut': 'clocked_out' },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: { PK: businessPk(session.businessId), SK: clockOutWorkflowSk(workflowOccurrenceId) },
          UpdateExpression: 'SET #status = :resolved, #updatedAt = :resolvedAt, #administrativeResolution = :administrativeResolution, #resolvedBy = :resolvedBy, #resolvedAt = :resolvedAt, #resolutionReason = :reason, #resolutionType = :resolutionType, #originalWorkflowOccurrenceId = :workflowOccurrenceId, #originalRequirementIds = :requirementIds',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending AND #employeeId = :employeeId',
          ExpressionAttributeNames: {
            '#status': 'status', '#updatedAt': 'updatedAt', '#administrativeResolution': 'administrativeResolution',
            '#resolvedBy': 'resolvedBy', '#resolvedAt': 'resolvedAt', '#resolutionReason': 'resolutionReason',
            '#resolutionType': 'resolutionType', '#originalWorkflowOccurrenceId': 'originalWorkflowOccurrenceId',
            '#originalRequirementIds': 'originalRequirementIds', '#employeeId': 'employeeId',
          },
          ExpressionAttributeValues: {
            ':resolved': 'administratively_resolved', ':pending': 'pending_required_forms', ':resolvedAt': resolvedAt,
            ':administrativeResolution': administrativeResolution, ':resolvedBy': session.id, ':reason': trimmedReason,
            ':resolutionType': resolutionType, ':workflowOccurrenceId': workflowOccurrenceId,
            ':requirementIds': originalRequirementIds, ':employeeId': employeeId,
          },
        },
      },
      {
        Delete: {
          TableName: tableName,
          Key: { PK: businessPk(session.businessId), SK: pendingClockOutSk(employeeId) },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #employeeId = :employeeId AND #workflowOccurrenceId = :workflowOccurrenceId',
          ExpressionAttributeNames: { '#employeeId': 'employeeId', '#workflowOccurrenceId': 'workflowOccurrenceId' },
          ExpressionAttributeValues: { ':employeeId': employeeId, ':workflowOccurrenceId': workflowOccurrenceId },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            PK: businessPk(session.businessId), SK: auditEventSk(auditEventId), entityType: 'AUDIT_EVENT',
            businessId: session.businessId, eventId: auditEventId, id: auditEventId,
            action: 'mandatory_clock_out_administratively_resolved', actorUserId: session.id,
            actorName: session.name ?? '', actorEmail: session.email ?? '', createdAt: resolvedAt,
            metadata: { employeeId, timeEntryId: workflow.timeEntryId, ...administrativeResolution },
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
    ] }));
    return { ok: true, status: 'clock_out_administratively_resolved', workflow: { ...workflow, status: 'administratively_resolved', administrativeResolution } };
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const current = await getClockOutWorkflowForBusiness(session.businessId, workflowOccurrenceId);
    if (current?.employeeId === employeeId && current.status === 'administratively_resolved') {
      return { ok: true, status: 'clock_out_already_administratively_resolved', workflow: current };
    }
    return { ok: false, status: 409, code: 'clock_out_admin_resolution_conflict', error: 'The workflow, pointer, or Time Entry changed. Refresh and try again.' };
  }
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

export function matchLegacyClockOutRequirement(workflow, {
  formId,
  workflowOccurrenceId,
  workflowRequirementId,
  context = {},
}) {
  if (!workflow || workflow.status !== 'pending_required_forms') return { result: 'no_match', candidateCount: 0, formCandidateCount: 0 };
  if (workflowOccurrenceId && workflow.workflowOccurrenceId !== workflowOccurrenceId) return { result: 'no_match', candidateCount: 0, formCandidateCount: 0 };

  const completedRequirementIds = new Set(workflow.completedRequirementIds ?? []);
  const contextFields = ['jobId', 'equipmentId', 'divisionId', 'serviceId', 'serviceVisitId'];
  const formCandidates = (workflow.requiredForms ?? []).filter((requirement) => (
    !completedRequirementIds.has(requirement.requirementId)
    && requirement.formId === formId
  ));
  const candidates = formCandidates.filter((requirement) => (
    requirement.trigger === 'after_clock_out'
    && requirement.form?.id === formId
    && requirement.form?.trigger === 'after_clock_out'
    && (!workflowRequirementId || requirement.requirementId === workflowRequirementId)
    && contextFields.every((field) => !text(context[field]) || text(requirement.context?.[field]) === text(context[field]))
  ));

  if (candidates.length === 1) return { result: 'matched', candidateCount: 1, formCandidateCount: formCandidates.length, requirement: candidates[0] };
  return { result: candidates.length > 1 ? 'ambiguous' : 'no_match', candidateCount: candidates.length, formCandidateCount: formCandidates.length };
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

export function workflowHasDurableSubmissionEvidence(workflow, submissions) {
  const requirements = Array.isArray(workflow?.requiredForms) ? workflow.requiredForms : [];
  return requirements.length > 0 && requirements.every((requirement) => (
    submissions.some((submission) => submissionSatisfiesWorkflowRequirement(submission, workflow, requirement))
  ));
}

export async function reconcilePendingClockOutWorkflow({
  businessId,
  employeeId,
  getPendingClockOutWorkflow = getPendingClockOutWorkflowForEmployee,
  getTimeEntryForBusiness,
  listFormSubmissionsForBusiness,
  reconciledAt = new Date().toISOString(),
}) {
  const workflow = await getPendingClockOutWorkflow(businessId, employeeId);
  if (!workflow) return null;

  const timeEntry = await getTimeEntryForBusiness(businessId, workflow.timeEntryId);
  const requirements = Array.isArray(workflow.requiredForms) ? workflow.requiredForms : [];
  if (timeEntry?.employeeId !== employeeId || timeEntry.status !== 'clocked_out' || requirements.length === 0) return workflow;

  const submissions = await listFormSubmissionsForBusiness(businessId, { consistentRead: true });
  const completedRequirementIds = requirements.flatMap((requirement) => submissions.some((submission) => (
    submissionSatisfiesWorkflowRequirement(submission, workflow, requirement)
  )) ? [requirement.requirementId] : []);
  if (completedRequirementIds.length !== requirements.length) return workflow;

  if (workflow.status === 'finalized') {
    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: [{
        Delete: {
          TableName: tableName,
          Key: { PK: businessPk(businessId), SK: pendingClockOutSk(employeeId) },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #workflowOccurrenceId = :workflowOccurrenceId',
          ExpressionAttributeNames: { '#workflowOccurrenceId': 'workflowOccurrenceId' },
          ExpressionAttributeValues: { ':workflowOccurrenceId': workflow.workflowOccurrenceId },
        },
      }] }));
      return null;
    } catch (error) {
      if (error?.name !== 'TransactionCanceledException') throw error;
      return getPendingClockOutWorkflow(businessId, employeeId);
    }
  }

  if (workflow.status !== 'pending_required_forms') return workflow;

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      {
        Update: {
          TableName: tableName,
          Key: { PK: businessPk(businessId), SK: clockOutWorkflowSk(workflow.workflowOccurrenceId) },
          UpdateExpression: 'SET #status = :finalized, #finalizedAt = :reconciledAt, #updatedAt = :reconciledAt, #timeEntry = :timeEntry, #completedRequirementIds = :completedRequirementIds, #completedRequirementCount = :completedRequirementCount',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #employeeId = :employeeId AND #status = :pending',
          ExpressionAttributeNames: {
            '#status': 'status', '#employeeId': 'employeeId', '#finalizedAt': 'finalizedAt', '#updatedAt': 'updatedAt',
            '#timeEntry': 'timeEntry', '#completedRequirementIds': 'completedRequirementIds', '#completedRequirementCount': 'completedRequirementCount',
          },
          ExpressionAttributeValues: {
            ':finalized': 'finalized', ':pending': 'pending_required_forms', ':employeeId': employeeId,
            ':reconciledAt': workflow.finalizedAt ?? reconciledAt, ':timeEntry': workflow.timeEntry ?? timeEntry,
            ':completedRequirementIds': new Set(completedRequirementIds), ':completedRequirementCount': requirements.length,
          },
        },
      },
      {
        Delete: {
          TableName: tableName,
          Key: { PK: businessPk(businessId), SK: pendingClockOutSk(employeeId) },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #workflowOccurrenceId = :workflowOccurrenceId',
          ExpressionAttributeNames: { '#workflowOccurrenceId': 'workflowOccurrenceId' },
          ExpressionAttributeValues: { ':workflowOccurrenceId': workflow.workflowOccurrenceId },
        },
      },
    ] }));
    return null;
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    return getPendingClockOutWorkflow(businessId, employeeId);
  }
}