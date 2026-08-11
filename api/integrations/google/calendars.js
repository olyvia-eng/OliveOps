import { requireSession } from '../../_lib/session.js';
import {
  getGoogleConnection,
  updateGoogleConnectionSettings,
} from '../../_lib/googleCalendarRepo.js';
import {
  getValidGoogleAccessToken,
  listGoogleCalendars,
} from '../../_lib/googleCalendarService.js';
import { methodNotAllowed } from './_http.js';
import { reconcileGoogleJobsForUser } from '../../_lib/googleCalendarSync.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') return methodNotAllowed(res, ['GET', 'PATCH']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  const connection = await getGoogleConnection({ businessId: session.businessId, userId: session.id });
  if (!connection) return res.status(409).json({ ok: false, error: 'Google Calendar is not connected' });

  try {
    const accessToken = await getValidGoogleAccessToken({
      businessId: session.businessId,
      userId: session.id,
      connection,
    });
    const calendars = await listGoogleCalendars({ accessToken });
    const safeCalendars = calendars.map(({ id, summary, primary, accessRole, backgroundColor }) => ({
      id, summary, primary, accessRole, backgroundColor,
    }));
    if (req.method === 'GET') return res.status(200).json({ ok: true, calendars: safeCalendars });

    const calendarId = typeof req.body?.calendarId === 'string' ? req.body.calendarId : '';
    const selected = calendars.find((calendar) => calendar.id === calendarId);
    if (!selected || !['owner', 'writer'].includes(selected.accessRole)) {
      return res.status(400).json({ ok: false, error: 'Select a writable Google Calendar' });
    }
    const calendarChanged = selected.id !== connection.selectedCalendarId;
    if (calendarChanged && connection.preferences?.syncOliveOpsJobs === true) {
      await reconcileGoogleJobsForUser({
        businessId: session.businessId,
        userId: session.id,
        action: 'delete',
      });
    }
    await updateGoogleConnectionSettings({
      businessId: session.businessId,
      userId: session.id,
      selectedCalendarId: selected.id,
      selectedCalendarSummary: selected.summary,
    });
    if (calendarChanged && connection.preferences?.syncOliveOpsJobs === true) {
      await reconcileGoogleJobsForUser({ businessId: session.businessId, userId: session.id });
    }
    return res.status(200).json({ ok: true, calendar: selected });
  } catch {
    return res.status(502).json({ ok: false, error: 'Could not access Google calendars' });
  }
}