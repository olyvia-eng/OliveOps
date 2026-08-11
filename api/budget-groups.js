import { requireSession } from './_lib/session.js';
import {
  dissolveBudgetGroupForBusiness,
  getBudgetGroupForBusiness,
  listBudgetGroupsForBusiness,
  listEquipmentBudgetAllocationsForBusiness,
  saveBudgetGroupForBusiness,
} from './_lib/budgetGroups.js';

const YEAR_REGEX = /^\d{4}$/;

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res, req.method === 'GET' ? undefined : ['owner', 'admin', 'foreman'], 'budget-groups');
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (id) {
        const group = await getBudgetGroupForBusiness(session.businessId, id);
        if (!group) return res.status(404).json({ ok: false, error: 'Budget Group not found' });
        return res.status(200).json({ ok: true, group });
      }
      const [groups, equipmentBudgetAllocations] = await Promise.all([
        listBudgetGroupsForBusiness(session.businessId),
        listEquipmentBudgetAllocationsForBusiness(session.businessId),
      ]);
      return res.status(200).json({ ok: true, groups, equipmentBudgetAllocations });
    }

    const id = req.method === 'POST' ? req.body?.id : req.query.id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ ok: false, error: 'Budget Group id is required.' });
    if (req.method === 'DELETE') {
      const result = await dissolveBudgetGroupForBusiness({ businessId: session.businessId, groupId: id });
      return res.status(result.ok ? 200 : 404).json(result);
    }

    const existing = req.method === 'PATCH' ? await getBudgetGroupForBusiness(session.businessId, id) : null;
    if (req.method === 'PATCH' && !existing) return res.status(404).json({ ok: false, error: 'Budget Group not found' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const year = typeof req.body?.year === 'string' ? req.body.year : '';
    const budgetIds = Array.isArray(req.body?.budgetIds) ? req.body.budgetIds.filter((value) => typeof value === 'string' && value) : [];
    if (!name || !YEAR_REGEX.test(year)) return res.status(400).json({ ok: false, error: 'Name and four-digit year are required.' });

    const result = await saveBudgetGroupForBusiness({
      businessId: session.businessId,
      group: { id, name, year, budgetIds, createdAt: existing?.createdAt, updatedAt: existing?.updatedAt },
      confirmAllocationMove: req.body?.confirmAllocationMove === true,
    });
    const status = result.ok ? 200 : result.code === 'ALLOCATION_MOVE_CONFIRMATION_REQUIRED' ? 409 : 400;
    return res.status(status).json(result);
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not update Budget Groups' });
  }
}