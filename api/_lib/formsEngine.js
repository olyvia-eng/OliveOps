import { getPeriodKeyForTrigger, normalizeBusinessTimeZone } from './businessTime.js';

const SATISFYING_SUBMISSION_STATUSES = new Set(['submitted', 'pending_review', 'approved']);
const CONTEXT_TRIGGERS = new Set(['before_starting_job', 'after_completing_job', 'after_leaving_job', 'job_completed']);
const DISPLAY_FIELD_TYPES = new Set(['section_header', 'paragraph_text']);
const OPTION_FIELD_TYPES = new Set(['checkbox', 'multiple_choice', 'dropdown']);
const SELECTOR_FIELD_TYPES = new Set(['employee_selector', 'job_selector', 'customer_selector']);
const MEDIA_FIELD_TYPES = new Set(['photo_upload', 'file_upload']);
const NON_OPERATIONAL_JOB_STATUSES = new Set(['completed', 'cancelled', 'on_hold']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const NUMBER_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

export function getEmployeeCrewIds(employeeId, crews = []) {
  return new Set(crews
    .filter((crew) => crew?.active === true
      && (crew.leadEmployeeId === employeeId || crew.memberIds?.includes(employeeId)))
    .map((crew) => crew.id));
}

export function isEmployeeAuthorizedForJob({ employee, job, crews = [] }) {
  if (!employee || !job) return false;
  if (job.assignedEmployeeIds?.includes(employee.id)) return true;
  return Boolean(job.crewId && getEmployeeCrewIds(employee.id, crews).has(job.crewId));
}

function employeeDivisionIds({ employee, crews, job }) {
  const ids = new Set();
  for (const crew of crews) {
    if (crew?.active !== true || !crew.defaultDivisionId) continue;
    if (crew.leadEmployeeId === employee.id || crew.memberIds?.includes(employee.id)) ids.add(crew.defaultDivisionId);
  }
  if (job?.divisionId && isEmployeeAuthorizedForJob({ employee, job, crews })) ids.add(job.divisionId);
  return ids;
}

function assignmentDivisionId(form, divisions) {
  const assignment = text(form.assignmentValue || form.division);
  if (!assignment) return '';
  const match = divisions.find((division) => division.id === assignment
    || normalized(division.name) === normalized(assignment)
    || normalized(division.normalizedName) === normalized(assignment));
  return match?.id ?? '';
}

export function isFormAssignedToEmployee({ form, employee, crews = [], divisions = [], job, equipment }) {
  if (!form || !employee?.active) return false;
  const assignmentValue = text(form.assignmentValue);
  if (form.assignedTo === 'everyone') return true;
  if (form.assignedTo === 'role') return Boolean(assignmentValue && assignmentValue === employee.role);
  if (form.assignedTo === 'employee') return Boolean(assignmentValue && assignmentValue === employee.id);
  if (form.assignedTo === 'job') {
    return Boolean(assignmentValue && job?.id === assignmentValue && isEmployeeAuthorizedForJob({ employee, job, crews }));
  }
  if (form.assignedTo === 'division') {
    const divisionId = assignmentDivisionId(form, divisions);
    return Boolean(divisionId && employeeDivisionIds({ employee, crews, job }).has(divisionId));
  }
  if (form.assignedTo === 'equipment') {
    return Boolean(assignmentValue
      && equipment?.id === assignmentValue
      && job?.assignedEquipmentIds?.includes(equipment.id)
      && isEmployeeAuthorizedForJob({ employee, job, crews }));
  }
  return false;
}

export function buildFormCompletionScope({ form, trigger, instant = new Date(), timeZone, job, equipment, division }) {
  const periodKey = CONTEXT_TRIGGERS.has(trigger)
    ? undefined
    : getPeriodKeyForTrigger(trigger, instant, normalizeBusinessTimeZone(timeZone));
  const jobId = text(job?.id);
  const equipmentId = text(equipment?.id);
  const divisionId = text(division?.id || job?.divisionId);
  const contextKey = [jobId && `job:${jobId}`, equipmentId && `equipment:${equipmentId}`, divisionId && `division:${divisionId}`]
    .filter(Boolean)
    .join('|');
  return {
    formId: form.id,
    trigger,
    periodKey,
    jobId: jobId || undefined,
    equipmentId: equipmentId || undefined,
    divisionId: divisionId || undefined,
    contextKey: contextKey || undefined,
  };
}

function legacySubmissionMatches({ submission, scope, timeZone }) {
  if (scope.jobId && submission.jobId !== scope.jobId) return false;
  if (scope.equipmentId && submission.equipmentId && submission.equipmentId !== scope.equipmentId) return false;
  if (scope.divisionId && submission.divisionId && submission.divisionId !== scope.divisionId) return false;
  if (CONTEXT_TRIGGERS.has(scope.trigger)) return Boolean(scope.jobId && submission.jobId === scope.jobId);
  return getPeriodKeyForTrigger(scope.trigger, submission.submittedAt, timeZone) === scope.periodKey;
}

export function isSubmissionSatisfiedForScope({ submission, employeeId, scope, timeZone }) {
  if (!submission || submission.formId !== scope.formId || submission.employeeId !== employeeId) return false;
  if (!SATISFYING_SUBMISSION_STATUSES.has(submission.status)) return false;
  if (submission.trigger && submission.trigger !== scope.trigger) return false;
  if (submission.periodKey && submission.periodKey !== scope.periodKey) return false;
  if (submission.jobId && scope.jobId && submission.jobId !== scope.jobId) return false;
  if (submission.equipmentId && scope.equipmentId && submission.equipmentId !== scope.equipmentId) return false;
  if (submission.divisionId && scope.divisionId && submission.divisionId !== scope.divisionId) return false;
  if (submission.trigger || submission.periodKey) return true;
  return legacySubmissionMatches({ submission, scope, timeZone });
}

export function getMissingRequiredFormsForTrigger({
  forms = [],
  submissions = [],
  trigger,
  employee,
  crews = [],
  divisions = [],
  job,
  equipment,
  division,
  instant = new Date(),
  timeZone,
}) {
  if (trigger === 'on_demand') return [];
  return forms.filter((form) => {
    if (form.status !== 'active' || !form.trigger?.includes(trigger)) return false;
    if (!isFormAssignedToEmployee({ form, employee, crews, divisions, job, equipment })) return false;
    const scope = buildFormCompletionScope({ form, trigger, instant, timeZone, job, equipment, division });
    return !submissions.some((submission) => isSubmissionSatisfiedForScope({
      submission,
      employeeId: employee.id,
      scope,
      timeZone: normalizeBusinessTimeZone(timeZone),
    }));
  });
}

function validDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function responseError(field, message, code) {
  return { ok: false, error: `${field.label}: ${message}`, fieldId: field.id, ...(code ? { code } : {}) };
}

export function validateEmployeeFormResponses({ fields = [], responses, choicesByFieldId = {} }) {
  if (!Array.isArray(responses)) return { ok: false, error: 'Responses must be an array.' };
  if (responses.length > 99) return { ok: false, error: 'A form can contain at most 99 answers.' };
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const seen = new Set();
  const normalizedResponses = [];

  for (const response of responses) {
    const fieldId = text(response?.fieldId);
    const field = fieldsById.get(fieldId);
    if (!field) return { ok: false, error: 'A response references a field that does not belong to this form.', fieldId };
    if (seen.has(fieldId)) return responseError(field, 'duplicate responses are not allowed.');
    if (DISPLAY_FIELD_TYPES.has(field.type)) return responseError(field, 'display fields cannot contain answers.');
    seen.add(fieldId);

    const value = typeof response.value === 'string' ? response.value.trim() : '';
    const fileIds = Array.isArray(response.fileIds) ? response.fileIds.map(text).filter(Boolean) : [];
    if (field.type === 'signature') {
      if (value) return responseError(field, 'drawn signatures must be submitted as a signature artifact.');
      if (fileIds.length === 0) {
        if (field.required) return responseError(field, 'a signature is required.');
        continue;
      }
      if (fileIds.length !== 1) return responseError(field, 'must reference exactly one signature artifact.');
      normalizedResponses.push({
        fieldId: field.id,
        value: '',
        fileIds,
        labelSnapshot: field.label,
        typeSnapshot: field.type,
      });
      continue;
    }
    if (MEDIA_FIELD_TYPES.has(field.type)) {
      if (typeof response.value === 'string' && /^(?:data:|[A-Za-z0-9+/]{256,}={0,2}$)/.test(response.value.trim())) {
        return responseError(field, 'file bytes and base64 values are not accepted.');
      }
      if (fileIds.length > 0) return responseError(field, 'mobile file uploads are not enabled for Forms yet.');
      if (field.required) return responseError(field, 'a file upload is required but mobile uploads are not enabled yet.');
      continue;
    }
    if (!value) {
      if (field.required) return responseError(field, 'a response is required.');
      continue;
    }
    if (field.type === 'single_line_text' && value.length > 500) return responseError(field, 'must be 500 characters or fewer.');
    if (field.type === 'multi_line_text' && value.length > 10_000) return responseError(field, 'must be 10000 characters or fewer.');
    if ((field.type === 'number' || field.type === 'currency') && (!NUMBER_PATTERN.test(value) || !Number.isFinite(Number(value)))) return responseError(field, 'must be a valid number.');
    if (field.type === 'date' && !validDate(value)) return responseError(field, 'must be a valid date in YYYY-MM-DD format.');
    if (field.type === 'time' && !TIME_PATTERN.test(value)) return responseError(field, 'must be a valid 24-hour time in HH:MM format.');
    if (field.type === 'yes_no' && value !== 'yes' && value !== 'no') return responseError(field, 'must be yes or no.');
    if (OPTION_FIELD_TYPES.has(field.type) && !field.options?.includes(value)) return responseError(field, 'must be one of the configured options.');
    if (SELECTOR_FIELD_TYPES.has(field.type)) {
      const allowedValues = new Set((choicesByFieldId[field.id] ?? []).map((choice) => choice.value));
      if (!allowedValues.has(value)) return responseError(field, 'must reference an available option.');
    }
    if (field.acceptedResponse && value !== text(field.acceptedResponse.value)) {
      return responseError(field, text(field.acceptedResponse.message) || 'Choose the required answer to continue.', 'form_response_requirement_failed');
    }
    normalizedResponses.push({
      fieldId: field.id,
      value,
      labelSnapshot: field.label,
      typeSnapshot: field.type,
    });
  }

  for (const field of fields) {
    if (field.required && !DISPLAY_FIELD_TYPES.has(field.type) && !MEDIA_FIELD_TYPES.has(field.type) && !seen.has(field.id)) {
      return responseError(field, 'a response is required.');
    }
  }
  return { ok: true, responses: normalizedResponses };
}

export function isJobOperationallyActive(job) {
  return Boolean(job) && !NON_OPERATIONAL_JOB_STATUSES.has(normalized(job.status));
}