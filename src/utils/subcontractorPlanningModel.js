const finiteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function subcontractorPlannedQuantity(item) {
  return finiteNonNegative(item?.plannedQuantity) ? item.plannedQuantity : 1;
}

export function subcontractorCostPerUnit(item) {
  if (finiteNonNegative(item?.rate)) return item.rate;
  if (finiteNonNegative(item?.unitCost)) return item.unitCost;
  if (!finiteNonNegative(item?.plannedAmount)) return 0;
  const quantity = subcontractorPlannedQuantity(item);
  return quantity > 0 ? item.plannedAmount / quantity : item.plannedAmount;
}

export function calculateAnnualSubcontractorCost(item) {
  return subcontractorCostPerUnit(item) * subcontractorPlannedQuantity(item);
}

export function normalizeSubcontractorPlanAssumptions(item) {
  if (item?.category !== 'subcontractors') return item;
  const plannedQuantity = subcontractorPlannedQuantity(item);
  const rate = subcontractorCostPerUnit(item);
  return { ...item, rate, plannedQuantity, plannedAmount: rate * plannedQuantity };
}