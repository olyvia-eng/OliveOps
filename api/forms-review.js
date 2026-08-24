import {
  getEmployeeForBusiness,
  getFormForBusiness,
  getFormSubmissionForBusiness,
  getJobForBusiness,
  listFormFieldsForBusiness,
  listFormResponsesForBusiness,
  listFormSubmissionsForBusiness,
  reviewFormSubmissionForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { listDivisionsForBusiness } from './_lib/schedulingConfig.js';

const REVIEW_STATUSES = new Set(['approved', 'rejected']);

const queryValue = (value) => typeof value === 'string' ? value.trim() : '';

async function getScopedContext(session, req, res) {
  const jobId = queryValue(req.query?.jobId);
  const formId = queryValue(req.query?.formId);
  if (!jobId || !formId) {
    res.status(400).json({ ok: false, error: 'Job and Form are required.' });
    return null;
  }

  const [job, form] = await Promise.all([
    getJobForBusiness(session.businessId, jobId),
    getFormForBusiness(session.businessId, formId),
  ]);
  if (!job || !form || form.assignedTo !== 'job' || form.assignmentValue !== job.id) {
    res.status(404).json({ ok: false, error: 'Assigned Form not found for this Job.' });
    return null;
  }
  return { job, form };
}

async function handleGet(session, req, res) {
  const context = await getScopedContext(session, req, res);
  if (!context) return;

  const submissions = (await listFormSubmissionsForBusiness(session.businessId))
    .filter((submission) => submission.jobId === context.job.id && submission.formId === context.form.id)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  const submissionId = queryValue(req.query?.id);

  if (!submissionId) {
    const employeeIds = [...new Set(submissions.map((submission) => submission.employeeId).filter(Boolean))];
    const employees = await Promise.all(employeeIds.map((employeeId) => getEmployeeForBusiness(session.businessId, employeeId)));
    const employeeNames = new Map(employees.filter(Boolean).map((employee) => [employee.id, employee.name]));
    return res.status(200).json({
      ok: true,
      job: { id: context.job.id, title: context.job.title },
      form: context.form,
      submissions: submissions.map((submission) => ({
        ...submission,
        employeeName: employeeNames.get(submission.employeeId) ?? submission.submittedBy ?? 'Unknown employee',
      })),
    });
  }

  const submission = await getFormSubmissionForBusiness(session.businessId, submissionId);
  if (!submission || submission.jobId !== context.job.id || submission.formId !== context.form.id) {
    return res.status(404).json({ ok: false, error: 'Submission not found for this Job and Form.' });
  }

  const [allFields, allResponses, employee, divisions] = await Promise.all([
    listFormFieldsForBusiness(session.businessId),
    listFormResponsesForBusiness(session.businessId),
    getEmployeeForBusiness(session.businessId, submission.employeeId),
    listDivisionsForBusiness(session.businessId),
  ]);
  const fields = allFields.filter((field) => field.formId === context.form.id);
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const responses = allResponses
    .filter((response) => response.submissionId === submission.id)
    .map((response) => {
      const field = fieldsById.get(response.fieldId);
      return {
        ...response,
        fieldLabel: field?.label ?? response.fieldId,
        fieldType: field?.type,
        fieldOrder: field?.order ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => left.fieldOrder - right.fieldOrder);
  const division = divisions.find((item) => item.id === submission.divisionId);

  return res.status(200).json({
    ok: true,
    job: { id: context.job.id, title: context.job.title },
    form: context.form,
    submission: {
      ...submission,
      employeeName: employee?.name ?? submission.submittedBy ?? 'Unknown employee',
      divisionName: division?.name,
    },
    responses,
  });
}

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin', 'foreman']);
  if (!session) return;

  if (req.method === 'GET') return handleGet(session, req, res);

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const submissionId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
  if (!submissionId || !REVIEW_STATUSES.has(status)) {
    return res.status(400).json({ ok: false, error: 'A submission ID and approved or rejected status are required.' });
  }

  const submission = await getFormSubmissionForBusiness(session.businessId, submissionId);
  if (!submission) return res.status(404).json({ ok: false, error: 'Submission not found.' });
  if (submission.status !== 'submitted') {
    return res.status(409).json({ ok: false, error: 'Only submitted Forms can be reviewed.' });
  }

  const reviewed = { ...submission, status };
  try {
    await reviewFormSubmissionForBusiness({ businessId: session.businessId, formSubmissionId: submission.id, status });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return res.status(409).json({ ok: false, error: 'This Form submission has already been reviewed.' });
    }
    throw error;
  }
  return res.status(200).json({ ok: true, submission: reviewed });
}