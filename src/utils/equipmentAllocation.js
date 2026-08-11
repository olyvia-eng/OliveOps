export const EQUIPMENT_ALLOCATION_CAPACITY_MONTHS = 12;

const normalizeNonNegative = (value) => {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? Math.max(0, candidate) : 0;
};

export function normalizeAllocatedMonths(value) {
  return Math.min(EQUIPMENT_ALLOCATION_CAPACITY_MONTHS, normalizeNonNegative(value));
}

export function calculateAllocatedEquipmentCost(annualCost, monthsAllocated) {
  return normalizeNonNegative(annualCost)
    * (normalizeAllocatedMonths(monthsAllocated) / EQUIPMENT_ALLOCATION_CAPACITY_MONTHS);
}

export function getEquipmentAllocationsForGroup(allocations, budgetGroupId, equipmentId) {
  return allocations.filter((allocation) => (
    allocation.budgetGroupId === budgetGroupId
    && (!equipmentId || allocation.equipmentId === equipmentId)
  ));
}

export function calculateEquipmentAllocationSummary({
  allocations,
  budgetGroupId,
  equipmentId,
  annualCost,
  excludeAllocationId,
}) {
  const scopedAllocations = getEquipmentAllocationsForGroup(allocations, budgetGroupId, equipmentId)
    .filter((allocation) => allocation.id !== excludeAllocationId);
  const totalMonthsAllocated = scopedAllocations.reduce(
    (sum, allocation) => sum + normalizeAllocatedMonths(allocation.monthsAllocated),
    0,
  );
  const remainingMonths = Math.max(0, EQUIPMENT_ALLOCATION_CAPACITY_MONTHS - totalMonthsAllocated);
  const overAllocatedMonths = Math.max(0, totalMonthsAllocated - EQUIPMENT_ALLOCATION_CAPACITY_MONTHS);

  return {
    allocations: scopedAllocations,
    totalMonthsAllocated,
    remainingMonths,
    suggestedMonths: remainingMonths,
    overAllocatedMonths,
    isOverAllocated: overAllocatedMonths > 0,
    allocatedCost: calculateAllocatedEquipmentCost(annualCost, totalMonthsAllocated),
    unallocatedCost: calculateAllocatedEquipmentCost(annualCost, remainingMonths),
  };
}

export function buildEquipmentAllocationGroups({
  allocations,
  budgetGroups,
  budgets,
  equipmentId,
  annualCost,
}) {
  return budgetGroups
    .map((group) => {
      const summary = calculateEquipmentAllocationSummary({
        allocations,
        budgetGroupId: group.id,
        equipmentId,
        annualCost,
      });
      return {
        group,
        ...summary,
        rows: summary.allocations.map((allocation) => ({
          allocation,
          budget: budgets.find((budget) => budget.id === allocation.budgetId) ?? null,
          allocatedCost: calculateAllocatedEquipmentCost(annualCost, allocation.monthsAllocated),
        })),
      };
    })
    .filter((summary) => summary.allocations.length > 0);
}