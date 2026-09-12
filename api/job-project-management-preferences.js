import { requireSession } from './_lib/session.js';
import {
  getJobProjectManagementCardIdsForUser,
  saveJobProjectManagementCardIdsForUser,
} from './_lib/jobProjectManagementPreferences.js';

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const cardIds = await getJobProjectManagementCardIdsForUser(session.businessId, session.id);
      return res.status(200).json({ ok: true, cardIds });
    }

    const cardIds = await saveJobProjectManagementCardIdsForUser({
      businessId: session.businessId,
      userId: session.id,
      cardIds: req.body?.cardIds,
    });
    return res.status(200).json({ ok: true, cardIds });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not save Project Management layout.' });
  }
}
