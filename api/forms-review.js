import { getFormSubmissionForBusiness, updateFormSubmissionForBusiness } from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';

const REVIEW_STATUSES = new Set(['approved', 'rejected']);

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin', 'foreman']);
  if (!session) return;

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
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
  await updateFormSubmissionForBusiness({ businessId: session.businessId, formSubmission: reviewed });
  return res.status(200).json({ ok: true, submission: reviewed });
}