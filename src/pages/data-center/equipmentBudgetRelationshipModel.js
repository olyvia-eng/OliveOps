const nonNegativeFinite = (value) => Number.isFinite(value) ? Math.max(0, value) : 0;

export function buildEquipmentBudgetRelationshipRows({
  equipmentId,
  planningItems,
  budgets,
  budgetDivisions,
  budgetItems = [],
  legacyAllocations = [],
}) {
  const budgetById = new Map(budgets.map((budget) => [budget.id, budget]));
  const divisionByBudgetAndId = new Map(budgetDivisions.map((division) => [`${division.budgetId}:${division.id}`, division]));
  const legacyBudgetItemById = new Map(budgetItems.map((item) => [item.id, item]));
  const currentPlanningItemIds = new Set();

  const rows = planningItems
    .filter((item) => item.category === 'equipment' && item.equipmentId === equipmentId)
    .map((item) => {
      currentPlanningItemIds.add(item.id);
      const annualCost = nonNegativeFinite(item.plannedAmount);
      const annualHours = nonNegativeFinite(item.sellableHoursPerYear ?? item.utilizationHours);
      const hoursPerDay = nonNegativeFinite(item.equipmentHoursPerDay);
      return {
        id: item.id,
        budgetId: item.budgetId,
        budget: budgetById.get(item.budgetId),
        annualCost,
        annualHours,
        hoursPerDay,
        operatingDays: annualHours > 0 && hoursPerDay > 0 ? annualHours / hoursPerDay : null,
        costPerHour: annualHours > 0 ? annualCost / annualHours : null,
        divisions: (item.equipmentDivisionAllocations ?? [])
          .filter((allocation) => nonNegativeFinite(allocation.months) > 0)
          .map((allocation) => ({
            divisionId: allocation.divisionId,
            division: divisionByBudgetAndId.get(`${item.budgetId}:${allocation.divisionId}`),
            months: nonNegativeFinite(allocation.months),
            annualCost: annualCost * nonNegativeFinite(allocation.months) / 12,
          })),
        source: 'planning',
      };
    });

  for (const allocation of legacyAllocations) {
    if (allocation.equipmentId !== equipmentId || currentPlanningItemIds.has(allocation.budgetItemId)) continue;
    const item = legacyBudgetItemById.get(allocation.budgetItemId);
    if (!item || item.equipmentId !== equipmentId || item.budgetId !== allocation.budgetId) continue;
    const annualCost = nonNegativeFinite(item.budgeted);
    const annualHours = nonNegativeFinite(item.sellableHoursPerYear);
    const hoursPerDay = nonNegativeFinite(item.equipmentHoursPerDay);
    rows.push({
      id: allocation.id,
      budgetId: allocation.budgetId,
      budget: budgetById.get(allocation.budgetId),
      annualCost,
      annualHours,
      hoursPerDay,
      operatingDays: annualHours > 0 && hoursPerDay > 0 ? annualHours / hoursPerDay : null,
      costPerHour: annualHours > 0 ? annualCost / annualHours : null,
      divisions: [{ divisionId: null, division: null, months: nonNegativeFinite(allocation.monthsAllocated), annualCost: annualCost * nonNegativeFinite(allocation.monthsAllocated) / 12 }],
      source: 'legacy',
    });
  }

  return rows.sort((left, right) => {
    const leftYear = String(left.budget?.fiscalYear ?? '');
    const rightYear = String(right.budget?.fiscalYear ?? '');
    return rightYear.localeCompare(leftYear) || String(left.budget?.name ?? '').localeCompare(String(right.budget?.name ?? ''));
  });
}
