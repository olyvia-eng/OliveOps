import {
  createJobTaskHeadingForBusiness,
  deleteJobTaskHeadingForBusiness,
  generateId,
  getJobForBusiness,
  getJobTaskHeadingForBusiness,
  listJobTaskHeadingsForBusiness,
  listTasksForBusiness,
  updateJobTaskHeadingForBusiness,
  updateTaskForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { authorizeRecordAccess } from './_lib/authorization.js';
import { listCrewsForBusiness } from './_lib/schedulingConfig.js';

const MANAGE_ROLES = new Set(['owner', 'admin', 'foreman']);
const validName = (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80;

export default async function handler(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;

  const jobId = typeof req.query?.jobId === 'string' ? req.query.jobId : '';
  const headingId = typeof req.query?.id === 'string' ? req.query.id : '';
  const job = jobId ? await getJobForBusiness(session.businessId, jobId) : null;
  if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
  const crews = await listCrewsForBusiness(session.businessId);
  if (!authorizeRecordAccess(session, 'jobs', job, { crews })) return res.status(404).json({ ok: false, error: 'Job not found.' });

  if (req.method === 'GET') {
    const headings = (await listJobTaskHeadingsForBusiness(session.businessId)).filter((heading) => heading.jobId === jobId);
    return res.status(200).json({ ok: true, headings });
  }

  if (!MANAGE_ROLES.has(session.role)) return res.status(403).json({ ok: false, error: 'Not authorized.' });

  if (req.method === 'POST') {
    const name = req.body?.name;
    if (!validName(name)) return res.status(400).json({ ok: false, error: 'Heading name is required and must be 80 characters or fewer.' });
    const now = new Date().toISOString();
    const existing = (await listJobTaskHeadingsForBusiness(session.businessId)).filter((heading) => heading.jobId === jobId);
    const heading = {
      id: generateId(),
      businessId: session.businessId,
      jobId,
      name: name.trim(),
      sortOrder: existing.length ? Math.max(...existing.map((item) => item.sortOrder)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    await createJobTaskHeadingForBusiness({ businessId: session.businessId, heading });
    return res.status(200).json({ ok: true, heading });
  }

  const heading = headingId ? await getJobTaskHeadingForBusiness(session.businessId, headingId) : null;
  if (!heading || heading.jobId !== jobId) return res.status(404).json({ ok: false, error: 'Heading not found.' });

  if (req.method === 'PATCH') {
    const name = req.body?.name;
    if (!validName(name)) return res.status(400).json({ ok: false, error: 'Heading name is required and must be 80 characters or fewer.' });
    const next = { ...heading, name: name.trim(), updatedAt: new Date().toISOString() };
    await updateJobTaskHeadingForBusiness({ businessId: session.businessId, heading: next });
    return res.status(200).json({ ok: true, heading: next });
  }

  if (req.method === 'PUT' && req.query?.action === 'reorder') {
    const orderedIds = req.body?.orderedIds;
    const headings = (await listJobTaskHeadingsForBusiness(session.businessId)).filter((item) => item.jobId === jobId);
    if (!Array.isArray(orderedIds) || orderedIds.length !== headings.length || new Set(orderedIds).size !== headings.length || orderedIds.some((id) => !headings.some((item) => item.id === id))) {
      return res.status(400).json({ ok: false, error: 'Heading order must contain every heading for this job exactly once.' });
    }
    const now = new Date().toISOString();
    const reordered = orderedIds.map((id, sortOrder) => ({ ...headings.find((item) => item.id === id), sortOrder, updatedAt: now }));
    await Promise.all(reordered.map((item) => updateJobTaskHeadingForBusiness({ businessId: session.businessId, heading: item })));
    return res.status(200).json({ ok: true, headings: reordered });
  }

  if (req.method === 'DELETE') {
    const tasks = await listTasksForBusiness(session.businessId);
    const assignedTasks = tasks.filter((task) => task.relatedEntityType === 'job' && task.relatedEntityId === jobId && task.headingId === headingId);
    await Promise.all(assignedTasks.map((task) => updateTaskForBusiness({
      businessId: session.businessId,
      task: { ...task, headingId: undefined, updatedAt: new Date().toISOString() },
    })));
    await deleteJobTaskHeadingForBusiness(session.businessId, headingId);
    return res.status(200).json({ ok: true, movedTaskCount: assignedTasks.length });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, PUT, DELETE');
  return res.status(405).json({ ok: false, error: 'Method not allowed.' });
}