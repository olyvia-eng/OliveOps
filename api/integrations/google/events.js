import { requireSession } from '../../_lib/session.js';
import {
  getGoogleConnection,
  replaceGoogleEventProjectionsForRange,
} from '../../_lib/googleCalendarRepo.js';
import {
  getValidGoogleAccessToken,
  listGoogleEvents,
} from '../../_lib/googleCalendarService.js';
import { methodNotAllowed, parseDateRange } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  const range = parseDateRange(req.query);
  if (!range) return res.status(400).json({ ok: false, error: 'A valid date range of at most 370 days is required' });

  const connection = await getGoogleConnection({ businessId: session.businessId, userId: session.id });
  if (!connection || connection.preferences?.showGoogleEvents === false) {
    return res.status(200).json({ ok: true, events: [] });
  }
  try {
    const accessToken = await getValidGoogleAccessToken({
      businessId: session.businessId,
      userId: session.id,
      connection,
    });
    const calendarId = connection.selectedCalendarId || 'primary';
    const fetched = await listGoogleEvents({
      accessToken,
      calendarId,
      timeMin: range.from,
      timeMax: range.to,
    });
    const events = fetched.filter((event) => event.status !== 'cancelled' && !event.oliveOpsJobId);
    await replaceGoogleEventProjectionsForRange({
      businessId: session.businessId,
      userId: session.id,
      calendarId,
      rangeStart: range.from,
      rangeEnd: range.to,
      events,
    });
    return res.status(200).json({ ok: true, events });
  } catch {
    return res.status(502).json({ ok: false, error: 'Could not load Google Calendar events' });
  }
}