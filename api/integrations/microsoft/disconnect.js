import { requireSession } from '../../_lib/session.js';
import { deleteMicrosoftUserData } from '../../_lib/microsoftCalendarRepo.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    await deleteMicrosoftUserData({ businessId: session.businessId, userId: session.id });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not disconnect Outlook Calendar' });
  }
}