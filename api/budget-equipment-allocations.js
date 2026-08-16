import { saveGroupedEquipmentAllocationsForBusiness } from './_lib/budgetGroups.js';
import { requireSession } from './_lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res, ['owner', 'admin', 'foreman'], 'equipment-budget-allocations');
  if (!session) return;

  try {
    const result = await saveGroupedEquipmentAllocationsForBusiness({
      businessId: session.businessId,
      budgetId: req.body?.budgetId,
      equipmentId: req.body?.equipmentId,
      annualCost: req.body?.annualCost,
      allocations: req.body?.allocations,
    });
    return res.status(result.ok ? 200 : 409).json(result);
  } catch {
    return res.status(500).json({ ok: false, error: 'Equipment allocations could not be saved.' });
  }
}