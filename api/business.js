import { getBusinessProfile, updateBusinessProfile } from './_lib/authRepo.js';
import { isValidTimeZone } from './_lib/businessTime.js';
import { requireSession } from './_lib/session.js';

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  if (req.method === 'GET') {
    const business = await getBusinessProfile(session.businessId);
    if (!business) return res.status(404).json({ ok: false, error: 'Business profile not found.' });
    return res.status(200).json({ ok: true, business });
  }

  if (req.method === 'PATCH') {
    const timezone = req.body?.timezone;
    if (!isValidTimeZone(timezone)) return res.status(400).json({ ok: false, error: 'A valid IANA timezone is required.' });
    const business = await updateBusinessProfile({ businessId: session.businessId, profile: { timezone } });
    return res.status(200).json({ ok: true, business });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}