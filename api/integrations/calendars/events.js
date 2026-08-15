import { listExternalCalendarEvents } from '../../_lib/externalCalendarEvents.js';
import { requireSession } from '../../_lib/session.js';
import { parseDateRange } from '../microsoft/_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res);
  if (!session) return;
  const range = parseDateRange(req.query);
  if (!range) return res.status(400).json({ ok: false, error: 'A valid date range of at most 370 days is required' });
  try {
    const result = await listExternalCalendarEvents({ businessId: session.businessId, userId: session.id, from: range.from, to: range.to });
    return res.status(200).json({ ok: true, ...result });
  } catch {
    return res.status(502).json({ ok: false, error: 'Could not load external calendar events' });
  }
}