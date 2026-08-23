import { requireSession } from './_lib/session.js';
import { getBudgetForBusiness, listBudgetDivisionsForBudget, listBudgetItemsForBusiness } from './_lib/authRepo.js';
import { createDivisionPlanningItem, listBudgetPlanningItems } from './_lib/budgetDivisionPlanning.js';

const splitEvenly = (divisionIds) => {
  const hundredths = 10000;
  const base = Math.floor(hundredths / divisionIds.length);
  const remainder = hundredths - base * divisionIds.length;
  return divisionIds.map((divisionId, index) => ({ divisionId, percentage: (base + (index >= divisionIds.length - remainder ? 1 : 0)) / 100 }));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res, ['owner', 'admin'], 'budget-divisions');
  if (!session) return;
  const budgetId = typeof req.body?.budgetId === 'string' ? req.body.budgetId : '';
  if (!budgetId) return res.status(400).json({ ok: false, error: 'Budget id is required.' });

  try {
    const [budget, divisions, budgetItems, existingOverhead] = await Promise.all([
      getBudgetForBusiness(session.businessId, budgetId),
      listBudgetDivisionsForBudget(session.businessId, budgetId),
      listBudgetItemsForBusiness(session.businessId),
      listBudgetPlanningItems({ businessId: session.businessId, budgetId, category: 'overhead' }),
    ]);
    if (!budget) return res.status(404).json({ ok: false, error: 'Budget not found.' });
    const activeDivisions = divisions.filter((division) => division.status === 'active').sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
    const legacyItems = budgetItems.filter((item) => item.budgetId === budgetId && item.category === 'overhead');
    if (legacyItems.length > 0 && activeDivisions.length === 0) return res.status(409).json({ ok: false, error: 'Add an active Division before migrating legacy overhead.' });

    const migratedSourceIds = new Set(existingOverhead.map((item) => item.legacyBudgetItemId).filter(Boolean));
    const now = new Date().toISOString();
    const created = [];
    for (const legacy of legacyItems) {
      if (migratedSourceIds.has(legacy.id)) continue;
      const item = {
        id: `legacy-overhead-${legacy.id}`,
        budgetId,
        divisionId: activeDivisions[0].id,
        category: 'overhead',
        name: legacy.description,
        description: legacy.description,
        costCode: legacy.costCode ?? '',
        plannedAmount: Math.max(0, Number(legacy.budgeted) || 0),
        overheadDivisionAllocations: splitEvenly(activeDivisions.map((division) => division.id)),
        legacyBudgetItemId: legacy.id,
        sortOrder: existingOverhead.length + created.length,
        createdAt: now,
        updatedAt: now,
      };
      try {
        created.push(await createDivisionPlanningItem({ businessId: session.businessId, item }));
      } catch (error) {
        const duplicate = error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException';
        if (!duplicate) throw error;
      }
    }
    const items = await listBudgetPlanningItems({ businessId: session.businessId, budgetId, category: 'overhead' });
    return res.status(200).json({ ok: true, items, migratedCount: created.length, legacyRecordsRetained: legacyItems.length });
  } catch {
    return res.status(500).json({ ok: false, error: 'Legacy overhead could not be normalized.' });
  }
}