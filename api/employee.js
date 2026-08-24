import { createHash } from 'node:crypto';
import {
  createEmployeeFormSubmissionForBusiness,
  generateId,
  getBusinessProfile,
  getEmployeeFormSubmissionIdempotency,
  listCustomersForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listFormFieldsForBusiness,
  listFormResponsesForBusiness,
  listFormSubmissionsForBusiness,
  listFormsForBusiness,
  listJobsForBusiness,
  listTimeEntriesForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { filterRecordsForSession } from './_lib/authorization.js';
import { listCrewsForBusiness, listDivisionsForBusiness } from './_lib/schedulingConfig.js';
import {
  buildFormCompletionScope,
  getMissingRequiredFormsForTrigger,
  isEmployeeAuthorizedForJob,
  isFormAssignedToEmployee,
  isSubmissionSatisfiedForScope,
  validateEmployeeFormResponses,
} from './_lib/formsEngine.js';
import { normalizeBusinessTimeZone } from './_lib/businessTime.js';

const FORM_TRIGGERS = new Set(['before_clock_in', 'after_clock_out', 'before_starting_job', 'after_completing_job', 'after_leaving_job', 'job_completed', 'daily', 'weekly', 'monthly', 'on_demand']);
const CLIENT_SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORM_IDEMPOTENCY_RETENTION_DAYS = 30;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function buildEmployeeResponse(employee) {
  return employee ? {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    role: employee.role,
    hourlyRate: employee.hourlyRate,
    compensationType: employee.compensationType ?? 'hourly',
    labourType: employee.labourType ?? 'field_producing',
    payrollBurdenPct: employee.payrollBurdenPct,
    benefitsExtraCost: employee.benefitsExtraCost,
    bonus: employee.bonus,
    userId: employee.userId ?? null,
    active: employee.active,
    createdAt: employee.createdAt,
  } : null;
}

function resolveSessionEmployee(session, employees) {
  const linked = employees.find((employee) => employee.active && employee.userId === session.id);
  if (linked) return linked;
  const sessionLinked = employees.find((employee) => employee.active && employee.id === session.employeeId);
  if (sessionLinked) return sessionLinked;
  const email = normalize(session.email);
  return employees.find((employee) => employee.active && !employee.userId && normalize(employee.email) === email) ?? null;
}

async function loadFormsContext(session) {
  const businessId = session.businessId;
  const [profile, employees, forms, fields, submissions, responses, jobs, customers, equipment, crews, divisions] = await Promise.all([
    getBusinessProfile(businessId), listEmployeesForBusiness(businessId), listFormsForBusiness(businessId),
    listFormFieldsForBusiness(businessId), listFormSubmissionsForBusiness(businessId), listFormResponsesForBusiness(businessId),
    listJobsForBusiness(businessId), listCustomersForBusiness(businessId), listEquipmentAssetsForBusiness(businessId),
    listCrewsForBusiness(businessId), listDivisionsForBusiness(businessId),
  ]);
  const employee = resolveSessionEmployee(session, employees);
  const authorizedJobs = employee ? jobs.filter((job) => isEmployeeAuthorizedForJob({ employee, job, crews })) : [];
  return { profile, employee, forms, fields, submissions, responses, jobs, authorizedJobs, customers, equipment, crews, divisions, timeZone: normalizeBusinessTimeZone(profile?.timezone) };
}

function findAssignmentDivision(form, divisions) {
  const target = text(form.assignmentValue || form.division);
  return divisions.find((division) => division.id === target || normalize(division.name) === normalize(target) || normalize(division.normalizedName) === normalize(target));
}

function contextsForForm(form, data) {
  if (form.assignedTo === 'job') {
    const job = data.authorizedJobs.find((candidate) => candidate.id === form.assignmentValue);
    return job ? [{ job, division: data.divisions.find((item) => item.id === job.divisionId) }] : [];
  }
  if (form.assignedTo === 'equipment') {
    const equipment = data.equipment.find((candidate) => candidate.id === form.assignmentValue);
    if (!equipment) return [];
    return data.authorizedJobs.filter((job) => job.assignedEquipmentIds?.includes(equipment.id)).map((job) => ({ job, equipment, division: data.divisions.find((item) => item.id === job.divisionId) }));
  }
  if (form.assignedTo === 'division') {
    const division = findAssignmentDivision(form, data.divisions);
    if (!division) return [];
    const jobs = data.authorizedJobs.filter((job) => job.divisionId === division.id);
    return jobs.length ? jobs.map((job) => ({ job, division })) : [{ division }];
  }
  return [{}];
}

function contextMatchesQuery(context, query) {
  if (text(query.jobId) && context.job?.id !== text(query.jobId)) return false;
  if (text(query.equipmentId) && context.equipment?.id !== text(query.equipmentId)) return false;
  if (text(query.divisionId) && (context.division?.id || context.job?.divisionId) !== text(query.divisionId)) return false;
  return true;
}

function choicesForField(field, data) {
  if (field.type === 'employee_selector') return [{ value: data.employee.id, label: data.employee.name }];
  if (field.type === 'job_selector') return data.authorizedJobs.map((job) => ({ value: job.id, label: job.title }));
  if (field.type === 'customer_selector') {
    const customerIds = new Set(data.authorizedJobs.map((job) => job.customerId));
    return data.customers.filter((customer) => customerIds.has(customer.id)).map((customer) => ({ value: customer.id, label: customer.name }));
  }
  return undefined;
}

function safeFields(formId, data) {
  return data.fields.filter((field) => field.formId === formId).sort((left, right) => left.order - right.order).map((field) => ({
    id: field.id, type: field.type, label: field.label, helpText: field.helpText ?? '', required: field.required,
    defaultValue: field.defaultValue ?? '', placeholder: field.placeholder ?? '', options: field.options ?? [], order: field.order,
    choices: choicesForField(field, data),
  }));
}

function safeContext(context) {
  return {
    jobId: context.job?.id, jobName: context.job?.title,
    equipmentId: context.equipment?.id, equipmentName: context.equipment?.name,
    divisionId: context.division?.id || context.job?.divisionId, divisionName: context.division?.name,
  };
}

function packageFor({ form, trigger, context, data, instant }) {
  const scope = buildFormCompletionScope({ form, trigger, instant, timeZone: data.timeZone, ...context });
  const submission = data.submissions.filter((candidate) => candidate.employeeId === data.employee.id).find((candidate) => isSubmissionSatisfiedForScope({ submission: candidate, employeeId: data.employee.id, scope, timeZone: data.timeZone }));
  return {
    id: form.id, name: form.name, description: form.description, category: form.category, trigger,
    required: trigger !== 'on_demand', completionRequirement: form.completionRequirement ?? 'reminder', enforcement: 'advisory',
    periodKey: scope.periodKey, context: safeContext(context), fields: safeFields(form.id, data),
    submissionState: { completed: Boolean(submission), submissionId: submission?.id, submittedAt: submission?.submittedAt, status: submission?.status },
  };
}

function availableInstances(data, query, instant) {
  const packages = [];
  for (const form of data.forms) {
    if (form.status !== 'active' || !form.trigger?.includes('on_demand')) continue;
    for (const context of contextsForForm(form, data)) {
      if (!contextMatchesQuery(context, query)) continue;
      if (isFormAssignedToEmployee({ form, employee: data.employee, crews: data.crews, divisions: data.divisions, ...context })) packages.push(packageFor({ form, trigger: 'on_demand', context, data, instant }));
    }
  }
  return packages;
}

function toDoInstances(data, query, instant, triggerFilter) {
  const packages = [];
  for (const form of data.forms) {
    if (form.status !== 'active') continue;
    for (const context of contextsForForm(form, data)) {
      if (!contextMatchesQuery(context, query) || !isFormAssignedToEmployee({ form, employee: data.employee, crews: data.crews, divisions: data.divisions, ...context })) continue;
      for (const trigger of form.trigger ?? []) {
        if (trigger === 'on_demand' || (triggerFilter && trigger !== triggerFilter)) continue;
        const item = packageFor({ form, trigger, context, data, instant });
        if (!item.submissionState.completed) packages.push(item);
      }
    }
  }
  return packages;
}

function completedSubmissions(data) {
  const formsById = new Map(data.forms.map((form) => [form.id, form]));
  const jobsById = new Map(data.jobs.map((job) => [job.id, job]));
  const equipmentById = new Map(data.equipment.map((item) => [item.id, item]));
  return data.submissions.filter((submission) => submission.employeeId === data.employee.id && submission.status !== 'draft')
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt)).slice(0, 50).map((submission) => ({
      submissionId: submission.id, formId: submission.formId, formName: formsById.get(submission.formId)?.name ?? 'Archived form',
      clientSubmissionId: submission.clientSubmissionId ?? null, submittedAt: submission.submittedAt, status: submission.status, trigger: submission.trigger,
      context: { jobId: submission.jobId, jobName: jobsById.get(submission.jobId)?.title, equipmentId: submission.equipmentId, equipmentName: equipmentById.get(submission.equipmentId)?.name, divisionId: submission.divisionId },
    }));
}

function requestedContext(req, data) {
  const payload = req.body?.data ?? req.body ?? {};
  const jobId = text(payload.jobId ?? req.query?.jobId);
  const equipmentId = text(payload.equipmentId ?? req.query?.equipmentId);
  const divisionId = text(payload.divisionId ?? req.query?.divisionId);
  const job = jobId ? data.authorizedJobs.find((candidate) => candidate.id === jobId) : undefined;
  if (jobId && !job) return { error: 'Job context is not available to this employee.' };
  const equipment = equipmentId ? data.equipment.find((candidate) => candidate.id === equipmentId) : undefined;
  if (equipmentId && (!equipment || !job?.assignedEquipmentIds?.includes(equipmentId))) return { error: 'Equipment context is not assigned through this job.' };
  const division = divisionId ? data.divisions.find((candidate) => candidate.id === divisionId) : data.divisions.find((candidate) => candidate.id === job?.divisionId);
  if (divisionId && (!division || (job && job.divisionId !== divisionId))) return { error: 'Division context is invalid.' };
  return { job, equipment, division };
}

function deterministicSubmissionId({ employeeId, scope }) {
  const key = [employeeId, scope.formId, scope.trigger, scope.periodKey, scope.jobId, scope.equipmentId, scope.divisionId].filter(Boolean).join('|');
  return `form-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

function submissionPayloadFingerprint({ formId, trigger, scope, responses }) {
  const canonical = {
    formId,
    trigger,
    context: {
      jobId: scope.jobId ?? null,
      equipmentId: scope.equipmentId ?? null,
      divisionId: scope.divisionId ?? null,
    },
    responses: responses
      .map((response) => ({ fieldId: response.fieldId, value: response.value }))
      .sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function idempotencyConflict(res) {
  return res.status(409).json({ ok: false, error: 'submission_idempotency_conflict' });
}

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin', 'foreman', 'crew_member']);
  if (!session) return;

  const data = await loadFormsContext(session);
  if (!data.employee) return res.status(404).json({ ok: false, error: 'Active employee profile not found.' });

  if (req.method === 'GET' && req.query.action === 'status') {
    return res.status(200).json({ ok: true, employee: buildEmployeeResponse(data.employee) });
  }

  if (req.method === 'GET' && req.query.action === 'history') {
    const timeEntries = await listTimeEntriesForBusiness(session.businessId);
    return res.status(200).json({ ok: true, timeEntries: filterRecordsForSession({ ...session, employeeId: data.employee.id }, 'time-entries', timeEntries), formSubmissions: completedSubmissions(data) });
  }

  if (req.method === 'GET' && req.query.action === 'forms') {
    const instant = new Date();
    return res.status(200).json({ ok: true, timezone: data.timeZone, generatedAt: instant.toISOString(), toDo: toDoInstances(data, req.query, instant), available: availableInstances(data, req.query, instant), completed: completedSubmissions(data) });
  }

  if (req.method === 'GET' && req.query.action === 'required') {
    const trigger = text(req.query.trigger);
    if (!FORM_TRIGGERS.has(trigger) || trigger === 'on_demand') return res.status(400).json({ ok: false, error: 'A required Form trigger is invalid.' });
    const context = requestedContext(req, data);
    if (context.error) return res.status(403).json({ ok: false, error: context.error });
    const forms = getMissingRequiredFormsForTrigger({ ...data, trigger, ...context, instant: new Date(), timeZone: data.timeZone });
    return res.status(200).json({ ok: true, trigger, timezone: data.timeZone, forms: forms.map((form) => packageFor({ form, trigger, context, data, instant: new Date() })) });
  }

  if (req.method === 'GET' && req.query.action === 'submission') {
    const submission = data.submissions.find((candidate) => candidate.id === req.query.id && candidate.employeeId === data.employee.id);
    if (!submission) return res.status(404).json({ ok: false, error: 'Submission not found.' });
    const form = data.forms.find((candidate) => candidate.id === submission.formId);
    const fields = safeFields(submission.formId, data);
    const fieldsById = new Map(fields.map((field) => [field.id, field]));
    return res.status(200).json({
      ok: true,
      submission: completedSubmissions({ ...data, submissions: [submission] })[0],
      form: form ? { id: form.id, name: form.name, description: form.description, category: form.category } : { id: submission.formId, name: 'Archived form' },
      answers: data.responses.filter((response) => response.submissionId === submission.id).map((response) => ({ fieldId: response.fieldId, label: fieldsById.get(response.fieldId)?.label ?? 'Archived field', type: fieldsById.get(response.fieldId)?.type, value: response.value, fileIds: response.fileIds })),
    });
  }

  if (req.method === 'POST' && req.query.action === 'submit') {
    const payload = req.body?.data ?? req.body;
    const hasClientSubmissionId = Object.prototype.hasOwnProperty.call(payload ?? {}, 'clientSubmissionId');
    const clientSubmissionId = text(payload?.clientSubmissionId);
    if (hasClientSubmissionId && !CLIENT_SUBMISSION_ID_PATTERN.test(clientSubmissionId)) {
      return res.status(400).json({ ok: false, error: 'invalid_client_submission_id' });
    }
    const formId = text(payload?.formId ?? req.query.formId);
    const form = data.forms.find((candidate) => candidate.id === formId);
    if (!form) return res.status(404).json({ ok: false, error: 'Form not found.' });
    if (form.status !== 'active') return res.status(409).json({ ok: false, error: 'This form is not active.' });
    const trigger = text(payload?.trigger) || (form.trigger?.includes('on_demand') ? 'on_demand' : form.trigger?.[0]);
    if (!FORM_TRIGGERS.has(trigger) || !form.trigger?.includes(trigger)) return res.status(400).json({ ok: false, error: 'Form trigger is invalid.' });
    const context = requestedContext(req, data);
    if (context.error) return res.status(403).json({ ok: false, error: context.error });
    if (!isFormAssignedToEmployee({ form, employee: data.employee, crews: data.crews, divisions: data.divisions, ...context })) return res.status(403).json({ ok: false, error: 'This form is not assigned or available to this employee.' });
    const fields = data.fields.filter((field) => field.formId === form.id);
    const choicesByFieldId = Object.fromEntries(safeFields(form.id, data).filter((field) => field.choices).map((field) => [field.id, field.choices]));
    const validation = validateEmployeeFormResponses({ fields, responses: payload?.responses, choicesByFieldId });
    if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error, fieldId: validation.fieldId });
    const submittedAt = new Date().toISOString();
    const scope = buildFormCompletionScope({ form, trigger, instant: submittedAt, timeZone: data.timeZone, ...context });
    const payloadFingerprint = clientSubmissionId
      ? submissionPayloadFingerprint({ formId: form.id, trigger, scope, responses: validation.responses })
      : undefined;
    if (clientSubmissionId) {
      const existing = await getEmployeeFormSubmissionIdempotency({ businessId: session.businessId, employeeId: data.employee.id, clientSubmissionId });
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) return idempotencyConflict(res);
        return res.status(200).json({ ok: true, replayed: true, submission: existing.submission });
      }
    }
    if (trigger !== 'on_demand' && data.submissions.some((submission) => isSubmissionSatisfiedForScope({ submission, employeeId: data.employee.id, scope, timeZone: data.timeZone }))) return res.status(409).json({ ok: false, error: 'This required form has already been completed for the current period and context.' });
    const submission = {
      id: trigger === 'on_demand' ? generateId() : deterministicSubmissionId({ employeeId: data.employee.id, scope }),
      formId: form.id, employeeId: data.employee.id, jobId: scope.jobId, equipmentId: scope.equipmentId, divisionId: scope.divisionId,
      trigger, periodKey: scope.periodKey, submittedAt, status: 'submitted', submittedBy: data.employee.name, submittedByUserId: session.id,
      clientSubmissionId: clientSubmissionId || undefined,
    };
    const responses = validation.responses.map((response) => ({ id: generateId(), submissionId: submission.id, ...response }));
    const submissionResponse = { ...submission, responsesCreated: responses.length };
    try {
      await createEmployeeFormSubmissionForBusiness({
        businessId: session.businessId,
        submission,
        responses,
        idempotency: clientSubmissionId ? {
          clientSubmissionId,
          payloadFingerprint,
          submission: submissionResponse,
          expiresAt: new Date(Date.parse(submittedAt) + FORM_IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        } : undefined,
      });
    } catch (error) {
      if (error?.name === 'TransactionCanceledException' && clientSubmissionId) {
        const existing = await getEmployeeFormSubmissionIdempotency({ businessId: session.businessId, employeeId: data.employee.id, clientSubmissionId });
        if (existing?.payloadFingerprint === payloadFingerprint) return res.status(200).json({ ok: true, replayed: true, submission: existing.submission });
        if (existing) return idempotencyConflict(res);
      }
      if (error?.name === 'TransactionCanceledException') return res.status(409).json({ ok: false, error: 'This form was already submitted. Refresh Forms and try again.' });
      throw error;
    }
    return res.status(201).json({ ok: true, submission: submissionResponse });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
