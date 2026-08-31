import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFormCompletionScope,
  getMissingRequiredFormsForTrigger,
  isFormAssignedToEmployee,
  isJobOperationallyActive,
  isSubmissionSatisfiedForScope,
  validateEmployeeFormResponses,
} from '../api/_lib/formsEngine.js';

const employee = { id: 'employee-1', role: 'crew_member', active: true };
const crews = [{ id: 'crew-1', active: true, leadEmployeeId: 'lead', memberIds: [employee.id], defaultDivisionId: 'division-1' }];
const divisions = [{ id: 'division-1', name: 'Earth Works', normalizedName: 'earth works', active: true }];
const job = { id: 'job-1', crewId: 'crew-1', assignedEmployeeIds: [], assignedEquipmentIds: ['equipment-1'], divisionId: 'division-1' };
const equipment = { id: 'equipment-1', name: 'Excavator' };
const form = (assignedTo, assignmentValue, trigger = ['daily']) => ({ id: `${assignedTo}-${assignmentValue || 'all'}`, status: 'active', assignedTo, assignmentValue, trigger });

test('authoritative assignment evaluator supports every current assignment type', () => {
  const context = { employee, crews, divisions, job, equipment };
  assert.equal(isFormAssignedToEmployee({ ...context, form: form('everyone') }), true);
  assert.equal(isFormAssignedToEmployee({ ...context, form: form('role', 'crew_member') }), true);
  assert.equal(isFormAssignedToEmployee({ ...context, form: form('employee', employee.id) }), true);
  assert.equal(isFormAssignedToEmployee({ ...context, form: form('division', 'division-1') }), true);
  assert.equal(isFormAssignedToEmployee({ ...context, form: form('division', 'Earth Works') }), true);
  assert.equal(isFormAssignedToEmployee({ ...context, form: form('job', job.id) }), true);
  assert.equal(isFormAssignedToEmployee({ ...context, form: form('equipment', equipment.id) }), true);
});

test('assignment evaluator fails closed for unassigned and unauthorized contexts', () => {
  assert.equal(isFormAssignedToEmployee({ form: form('employee', 'other'), employee, crews, divisions }), false);
  assert.equal(isFormAssignedToEmployee({ form: form('division', 'other'), employee, crews, divisions }), false);
  assert.equal(isFormAssignedToEmployee({ form: form('job', job.id), employee, crews: [], job }), false);
  assert.equal(isFormAssignedToEmployee({ form: form('equipment', equipment.id), employee, crews: [], job, equipment }), false);
  assert.equal(isFormAssignedToEmployee({ form: form('everyone'), employee: { ...employee, active: false } }), false);
});

test('job lifecycle actionability excludes only closed and on-hold statuses', () => {
  for (const status of ['completed', 'cancelled', 'on_hold', ' Completed ', 'ON_HOLD']) {
    assert.equal(isJobOperationallyActive({ status }), false, status);
  }
  for (const status of [undefined, '', 'scheduled', 'in_progress', 'quoted', 'future_status']) {
    assert.equal(isJobOperationallyActive({ status }), true, status);
  }
  assert.equal(isJobOperationallyActive(null), false);
});

test('required trigger evaluation excludes unrelated and completed forms', () => {
  const required = form('everyone', '', ['daily']);
  const unrelated = { ...form('everyone', '', ['weekly']), id: 'unrelated' };
  const inactive = { ...form('everyone', '', ['daily']), id: 'inactive', status: 'draft' };
  const input = { forms: [required, unrelated, inactive], trigger: 'daily', employee, crews, divisions, instant: '2026-08-18T02:30:00.000Z', timeZone: 'America/Toronto' };
  assert.deepEqual(getMissingRequiredFormsForTrigger(input).map((item) => item.id), [required.id]);

  const submissions = [{ id: 'submission-1', formId: required.id, employeeId: employee.id, status: 'submitted', submittedAt: '2026-08-17T20:00:00.000Z' }];
  assert.deepEqual(getMissingRequiredFormsForTrigger({ ...input, submissions }), []);
});

test('completion scopes separate recurring periods and job trigger contexts', () => {
  const dailyForm = form('everyone', '', ['daily']);
  const dailyScope = buildFormCompletionScope({ form: dailyForm, trigger: 'daily', instant: '2026-08-18T02:30:00.000Z', timeZone: 'America/Toronto' });
  assert.equal(dailyScope.periodKey, '2026-08-17');
  assert.equal(isSubmissionSatisfiedForScope({ submission: { formId: dailyForm.id, employeeId: employee.id, status: 'approved', submittedAt: '2026-08-17T18:00:00.000Z' }, employeeId: employee.id, scope: dailyScope, timeZone: 'America/Toronto' }), true);

  const jobForm = form('job', job.id, ['before_starting_job']);
  const jobScope = buildFormCompletionScope({ form: jobForm, trigger: 'before_starting_job', job });
  assert.equal(jobScope.periodKey, undefined);
  assert.equal(isSubmissionSatisfiedForScope({ submission: { formId: jobForm.id, employeeId: employee.id, jobId: job.id, status: 'submitted', submittedAt: '2026-08-01T00:00:00.000Z' }, employeeId: employee.id, scope: jobScope, timeZone: 'America/Toronto' }), true);
  assert.equal(isSubmissionSatisfiedForScope({ submission: { formId: jobForm.id, employeeId: employee.id, jobId: 'job-2', status: 'submitted', submittedAt: '2026-08-01T00:00:00.000Z' }, employeeId: employee.id, scope: jobScope, timeZone: 'America/Toronto' }), false);
});

test('leaving a job and completing a job are distinct completion scopes', () => {
  const jobForm = form('job', job.id, ['after_leaving_job', 'job_completed']);
  const leavingScope = buildFormCompletionScope({ form: jobForm, trigger: 'after_leaving_job', job });
  const completedScope = buildFormCompletionScope({ form: jobForm, trigger: 'job_completed', job });
  const leavingSubmission = { formId: jobForm.id, employeeId: employee.id, jobId: job.id, trigger: 'after_leaving_job', status: 'submitted' };

  assert.equal(isSubmissionSatisfiedForScope({ submission: leavingSubmission, employeeId: employee.id, scope: leavingScope, timeZone: 'America/Toronto' }), true);
  assert.equal(isSubmissionSatisfiedForScope({ submission: leavingSubmission, employeeId: employee.id, scope: completedScope, timeZone: 'America/Toronto' }), false);
});

test('response validation enforces field ownership, required values, types, and options', () => {
  const fields = [
    { id: 'name', type: 'single_line_text', label: 'Name', required: true },
    { id: 'count', type: 'number', label: 'Count', required: true },
    { id: 'choice', type: 'dropdown', label: 'Choice', required: true, options: ['A', 'B'] },
    { id: 'job', type: 'job_selector', label: 'Job', required: true },
  ];
  const valid = validateEmployeeFormResponses({
    fields,
    responses: [{ fieldId: 'name', value: ' Ryan ' }, { fieldId: 'count', value: '2.5' }, { fieldId: 'choice', value: 'A' }, { fieldId: 'job', value: 'job-1' }],
    choicesByFieldId: { job: [{ value: 'job-1', label: 'Job 1' }] },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.responses[0].value, 'Ryan');
  assert.equal(validateEmployeeFormResponses({ fields, responses: [{ fieldId: 'foreign', value: 'x' }] }).ok, false);
  assert.match(validateEmployeeFormResponses({ fields, responses: [{ fieldId: 'name', value: 'Ryan' }, { fieldId: 'count', value: 'not-number' }] }).error, /valid number/);
  assert.match(validateEmployeeFormResponses({ fields, responses: [{ fieldId: 'name', value: 'Ryan' }, { fieldId: 'count', value: '2' }, { fieldId: 'choice', value: 'C' }] }).error, /configured options/);
});

test('response validation rejects base64 media rather than storing it in DynamoDB', () => {
  const result = validateEmployeeFormResponses({
    fields: [{ id: 'photo', type: 'photo_upload', label: 'Photo', required: false }],
    responses: [{ fieldId: 'photo', value: `data:image/png;base64,${'A'.repeat(300)}` }],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /base64/);
});

test('response validation accepts every supported answer-bearing field type', () => {
  const fields = [
    ['single', 'single_line_text', 'text'], ['multi', 'multi_line_text', 'long text'],
    ['number', 'number', '-2.5'], ['currency', 'currency', '19.99'], ['date', 'date', '2026-08-18'],
    ['time', 'time', '23:59'], ['yes-no', 'yes_no', 'yes'], ['checkbox', 'checkbox', 'checked'],
    ['multiple', 'multiple_choice', 'A'], ['dropdown', 'dropdown', 'B'],
    ['employee', 'employee_selector', 'employee-1'], ['job', 'job_selector', 'job-1'], ['customer', 'customer_selector', 'customer-1'],
  ].map(([id, type, value]) => ({ id, type, label: id, required: true, value, options: ['checked', 'A', 'B'] }));
  const choicesByFieldId = {
    employee: [{ value: 'employee-1', label: 'Alex' }],
    job: [{ value: 'job-1', label: 'Job' }],
    customer: [{ value: 'customer-1', label: 'Customer' }],
  };
  const result = validateEmployeeFormResponses({ fields, responses: fields.map(({ id, value }) => ({ fieldId: id, value })), choicesByFieldId });
  assert.equal(result.ok, true);
  assert.equal(result.responses.length, fields.length);

  const signature = validateEmployeeFormResponses({
    fields: [{ id: 'signature', type: 'signature', label: 'Signature', required: true }],
    responses: [{ fieldId: 'signature', fileIds: ['signature-file'] }],
  });
  assert.equal(signature.ok, true);
  assert.deepEqual(signature.responses[0].fileIds, ['signature-file']);
  assert.equal(validateEmployeeFormResponses({
    fields: [{ id: 'signature', type: 'signature', label: 'Signature', required: true }],
    responses: [{ fieldId: 'signature', value: 'Alex' }],
  }).ok, false);

  const presentation = validateEmployeeFormResponses({
    fields: [{ id: 'section', type: 'section_header', label: 'Section' }, { id: 'paragraph', type: 'paragraph_text', label: 'Read this' }, { id: 'photo', type: 'photo_upload', label: 'Photo' }, { id: 'file', type: 'file_upload', label: 'File' }],
    responses: [],
  });
  assert.equal(presentation.ok, true);
});