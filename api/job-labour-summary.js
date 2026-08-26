import {
  getJobForBusiness,
  listEmployeesForBusiness,
  listLabourClassesForBusiness,
  listTimeCorrectionsForBusiness,
  listTimeEntriesForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { calculateJobLabourSummary } from '../src/utils/jobLabourSummary.js';

const queryValue = (value) => typeof value === 'string' ? value.trim() : '';

export function createJobLabourSummaryHandler(overrides = {}) {
  const deps = {
    requireSession,
    getJobForBusiness,
    listEmployeesForBusiness,
    listLabourClassesForBusiness,
    listTimeCorrectionsForBusiness,
    listTimeEntriesForBusiness,
    ...overrides,
  };

  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    const session = await deps.requireSession(req, res, ['owner', 'admin'], 'jobs');
    if (!session) return;
    const jobId = queryValue(req.query?.jobId);
    if (!jobId) return res.status(400).json({ ok: false, error: 'Job is required.' });

    try {
      const job = await deps.getJobForBusiness(session.businessId, jobId);
      if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
      const [employees, labourClasses, timeEntries, timeCorrections] = await Promise.all([
        deps.listEmployeesForBusiness(session.businessId),
        deps.listLabourClassesForBusiness(session.businessId),
        deps.listTimeEntriesForBusiness(session.businessId),
        deps.listTimeCorrectionsForBusiness(session.businessId),
      ]);
      const summary = calculateJobLabourSummary({ job, employees, labourClasses, timeEntries, timeCorrections });
      return res.status(200).json({ ok: true, jobId: job.id, summary });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not calculate Job labour.' });
    }
  };
}

export default createJobLabourSummaryHandler();