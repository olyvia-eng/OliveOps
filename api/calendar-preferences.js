import { requireSession } from './_lib/session.js';
import { getCalendarPreferencesForUser, saveCalendarPreferencesForUser } from './_lib/schedulingConfig.js';

const defaults = { view: 'week', colourBy: 'crew', showGoogleEvents: true, showOutlookEvents: true };

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    if (req.method === 'GET') {
      const preferences = await getCalendarPreferencesForUser(session.businessId, session.id);
      return res.status(200).json({ ok: true, preferences: { ...defaults, ...preferences } });
    }
    const current = { ...defaults, ...await getCalendarPreferencesForUser(session.businessId, session.id) };
    const next = { ...current, ...req.body };
    if (!['month', 'week', 'day'].includes(next.view) || !['crew', 'division', 'status'].includes(next.colourBy) || typeof next.showGoogleEvents !== 'boolean' || typeof next.showOutlookEvents !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Invalid Calendar preferences.' });
    }
    const preferences = await saveCalendarPreferencesForUser({
      businessId: session.businessId,
      userId: session.id,
      preferences: { view: next.view, colourBy: next.colourBy, showGoogleEvents: next.showGoogleEvents, showOutlookEvents: next.showOutlookEvents },
    });
    return res.status(200).json({ ok: true, preferences });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not save Calendar preferences.' });
  }
}