import { requireSession } from './_lib/session.js';
import { getUiPreferencesForUser, saveUiPreferencesForUser } from './_lib/uiPreferences.js';

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const preferences = req.method === 'GET'
      ? await getUiPreferencesForUser(session.businessId, session.id)
      : await saveUiPreferencesForUser({ businessId: session.businessId, userId: session.id, preferences: req.body });
    return res.status(200).json({ ok: true, preferences });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not save interface preferences.' });
  }
}