import { requireSession } from '../../_lib/session.js';
import { getMicrosoftConnection, toSafeMicrosoftConnection, updateMicrosoftConnectionSettings } from '../../_lib/microsoftCalendarRepo.js';
import { reconcileMicrosoftJobsForUser } from '../../_lib/microsoftCalendarSync.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) return methodNotAllowed(res, ['GET', 'PATCH']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  const connection = await getMicrosoftConnection({ businessId: session.businessId, userId: session.id });
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, integration: toSafeMicrosoftConnection(connection) });
  }
  if (!connection) return res.status(409).json({ ok: false, error: 'Outlook Calendar is not connected' });

  const showOutlookEvents = req.body?.showOutlookEvents;
  const syncOliveOpsJobs = req.body?.syncOliveOpsJobs;
  if (typeof showOutlookEvents !== 'boolean' || typeof syncOliveOpsJobs !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'Invalid integration preferences' });
  }
  const preferences = { ...connection.preferences, showOutlookEvents, syncOliveOpsJobs, scope: 'all_company_jobs', employeeIds: [], divisionIds: [] };
  await updateMicrosoftConnectionSettings({ businessId: session.businessId, userId: session.id, preferences });
  if (connection.preferences?.syncOliveOpsJobs !== true && syncOliveOpsJobs) {
    await reconcileMicrosoftJobsForUser({ businessId: session.businessId, userId: session.id });
  }
  return res.status(200).json({
    ok: true,
    integration: toSafeMicrosoftConnection({ ...connection, preferences, updatedAt: new Date().toISOString() }),
  });
}