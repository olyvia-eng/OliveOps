import { getBudgetForBusiness, reorderBudgetEquipmentForBusiness } from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  const budgetId = typeof req.body?.budgetId === 'string' ? req.body.budgetId.trim() : '';
  const orderedIds = Array.isArray(req.body?.orderedIds)
    ? req.body.orderedIds.filter((id) => typeof id === 'string' && id)
    : [];
  if (!budgetId || orderedIds.length !== req.body?.orderedIds?.length) {
    return res.status(400).json({ ok: false, error: 'A budget and valid equipment row order are required.' });
  }

  try {
    const budget = await getBudgetForBusiness(session.businessId, budgetId);
    if (!budget) return res.status(404).json({ ok: false, error: 'Budget not found' });
    const result = await reorderBudgetEquipmentForBusiness({ businessId: session.businessId, budgetId, orderedIds });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch {
    return res.status(500).json({ ok: false, error: 'Equipment order could not be saved.' });
  }
}