import { requireSession } from '../../_lib/session.js';
import { getMicrosoftConnection, updateMicrosoftConnectionSettings } from '../../_lib/microsoftCalendarRepo.js';
import { getValidMicrosoftAccessToken, listMicrosoftCalendars } from '../../_lib/microsoftCalendarService.js';
import { reconcileMicrosoftJobsForUser } from '../../_lib/microsoftCalendarSync.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) return methodNotAllowed(res, ['GET', 'PATCH']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  const connection = await getMicrosoftConnection({ businessId: session.businessId, userId: session.id });
  if (!connection) return res.status(409).json({ ok: false, error: 'Outlook Calendar is not connected' });
  try {
    const accessToken = await getValidMicrosoftAccessToken({ businessId: session.businessId, userId: session.id, connection });
    const calendars = await listMicrosoftCalendars({ accessToken });
    if (req.method === 'GET') return res.status(200).json({ ok: true, calendars });
    const calendarId = typeof req.body?.calendarId === 'string' ? req.body.calendarId : '';
    const selected = calendars.find((calendar) => calendar.id === calendarId && calendar.canEdit);
    if (!selected) return res.status(400).json({ ok: false, error: 'Select an editable Outlook Calendar' });
    const changed = selected.id !== connection.selectedCalendarId;
    if (changed && connection.preferences?.syncOliveOpsJobs === true) {
      await reconcileMicrosoftJobsForUser({ businessId: session.businessId, userId: session.id, action: 'delete' });
    }
    await updateMicrosoftConnectionSettings({
      businessId: session.businessId,
      userId: session.id,
      selectedCalendarId: selected.id,
      selectedCalendarSummary: selected.summary,
    });
    if (changed && connection.preferences?.syncOliveOpsJobs === true) {
      await reconcileMicrosoftJobsForUser({ businessId: session.businessId, userId: session.id });
    }
    return res.status(200).json({ ok: true, calendar: selected });
  } catch (error) {
    const reconnect = ['InvalidAuthenticationToken', 'invalid_grant'].includes(error?.code);
    return res.status(reconnect ? 401 : 502).json({ ok: false, error: reconnect ? 'Reconnect Outlook Calendar' : 'Could not access Outlook calendars', reconnect });
  }
}