import { requireSession } from './_lib/session.js';
import { applyLabourClassSetupForBusiness } from './_lib/authRepo.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res, ['owner', 'admin'], 'labour-classes');
  if (!session) return;

  try {
    const result = await applyLabourClassSetupForBusiness({
      businessId: session.businessId,
      classes: req.body?.classes,
      assignments: req.body?.assignments,
    });
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Labour Class setup failed', error);
    return res.status(500).json({ ok: false, error: 'Labour Class setup could not be saved.' });
  }
}