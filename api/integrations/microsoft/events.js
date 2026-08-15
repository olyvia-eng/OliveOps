import { requireSession } from '../../_lib/session.js';
import { getMicrosoftConnection, replaceMicrosoftEventProjectionsForRange } from '../../_lib/microsoftCalendarRepo.js';
import { getValidMicrosoftAccessToken, listMicrosoftEvents } from '../../_lib/microsoftCalendarService.js';
import { methodNotAllowed, parseDateRange } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res);
  if (!session) return;
  const range = parseDateRange(req.query);
  if (!range) return res.status(400).json({ ok: false, error: 'A valid date range of at most 370 days is required' });
  const connection = await getMicrosoftConnection({ businessId: session.businessId, userId: session.id });
  if (!connection || connection.preferences?.showOutlookEvents === false) return res.status(200).json({ ok: true, events: [] });
  try {
    const accessToken = await getValidMicrosoftAccessToken({ businessId: session.businessId, userId: session.id, connection });
    const calendarId = connection.selectedCalendarId;
    const fetched = await listMicrosoftEvents({ accessToken, calendarId, timeMin: range.from, timeMax: range.to });
    const events = fetched.filter((event) => event.status !== 'cancelled' && !event.oliveOpsJobId);
    await replaceMicrosoftEventProjectionsForRange({ businessId: session.businessId, userId: session.id, calendarId, rangeStart: range.from, rangeEnd: range.to, events });
    return res.status(200).json({ ok: true, events });
  } catch (error) {
    const reconnect = ['InvalidAuthenticationToken', 'invalid_grant'].includes(error?.code);
    return res.status(reconnect ? 401 : 502).json({ ok: false, error: reconnect ? 'Reconnect Outlook Calendar' : 'Could not load Outlook Calendar events', reconnect });
  }
}