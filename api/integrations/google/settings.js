import { requireSession } from '../../_lib/session.js';
import {
  getGoogleConnection,
  toSafeGoogleConnection,
  updateGoogleConnectionSettings,
} from '../../_lib/googleCalendarRepo.js';
import { methodNotAllowed } from './_http.js';
import { reconcileGoogleJobsForUser } from '../../_lib/googleCalendarSync.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') return methodNotAllowed(res, ['GET', 'PATCH']);
  const session = await requireSession(req, res);
  if (!session) return;

  const connection = await getGoogleConnection({ businessId: session.businessId, userId: session.id });
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, integration: toSafeGoogleConnection(connection) });
  }
  if (!connection) return res.status(409).json({ ok: false, error: 'Google Calendar is not connected' });

  const showGoogleEvents = req.body?.showGoogleEvents;
  const syncOliveOpsJobs = req.body?.syncOliveOpsJobs;
  if (typeof showGoogleEvents !== 'boolean' || typeof syncOliveOpsJobs !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'Invalid integration preferences' });
  }
  if (syncOliveOpsJobs && !['owner', 'admin'].includes(session.role)) {
    return res.status(403).json({ ok: false, error: 'Only owners and admins can sync company jobs' });
  }
  const preferences = {
    ...connection.preferences,
    showGoogleEvents,
    syncOliveOpsJobs,
    scope: 'all_company_jobs',
    employeeIds: [],
    divisionIds: [],
  };
  await updateGoogleConnectionSettings({ businessId: session.businessId, userId: session.id, preferences });
  if (connection.preferences?.syncOliveOpsJobs !== true && syncOliveOpsJobs) {
    await reconcileGoogleJobsForUser({ businessId: session.businessId, userId: session.id });
  }
  return res.status(200).json({
    ok: true,
    integration: toSafeGoogleConnection({ ...connection, preferences, updatedAt: new Date().toISOString() }),
  });
}