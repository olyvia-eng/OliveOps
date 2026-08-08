import { listTimeEntriesForBusiness, listFormSubmissionsForBusiness, listFormsForBusiness, createFormSubmissionForBusiness, getEmployeeForBusiness } from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { filterRecordsForSession } from './_lib/authorization.js';

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
    userId: employee.userId ?? null,
    active: employee.active,
    createdAt: employee.createdAt,
  } : null;
}

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin', 'foreman', 'crew_member']);
  if (!session) return;

  const employee = await getEmployeeForBusiness(session.businessId, session.employeeId);
  if (!employee) {
    return res.status(404).json({ ok: false, error: 'Employee profile not found' });
  }

  if (req.method === 'GET' && req.query.action === 'status') {
    return res.status(200).json({ ok: true, employee: buildEmployeeResponse(employee) });
  }

  if (req.method === 'GET' && req.query.action === 'history') {
    const [timeEntries, formSubmissions] = await Promise.all([
      listTimeEntriesForBusiness(session.businessId),
      listFormSubmissionsForBusiness(session.businessId),
    ]);
    const scopedTimeEntries = filterRecordsForSession(session, 'time-entries', timeEntries);
    const scopedSubmissions = filterRecordsForSession(session, 'form-submissions', formSubmissions);
    return res.status(200).json({ ok: true, timeEntries: scopedTimeEntries, formSubmissions: scopedSubmissions });
  }

  if (req.method === 'GET' && req.query.action === 'forms') {
    const forms = await listFormsForBusiness(session.businessId);
    return res.status(200).json({ ok: true, forms: filterRecordsForSession(session, 'forms', forms) });
  }

  if (req.method === 'GET' && req.query.action === 'required') {
    const forms = await listFormsForBusiness(session.businessId);
    return res.status(200).json({ ok: true, forms: forms.filter((form) => form.status === 'active') });
  }

  if (req.method === 'POST' && req.query.action === 'submit') {
    const formId = req.query.formId;
    const payload = req.body?.data;
    if (typeof formId !== 'string' || !formId || !payload || typeof payload !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    const forms = await listFormsForBusiness(session.businessId);
    const form = forms.find((candidate) => candidate.id === formId);
    if (!form) {
      return res.status(404).json({ ok: false, error: 'Form not found' });
    }

    const submission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      formId: form.id,
      employeeId: session.employeeId,
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      submittedBy: session.id,
    };

    await createFormSubmissionForBusiness({ businessId: session.businessId, formSubmission: submission });
    return res.status(200).json({ ok: true, submission });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
