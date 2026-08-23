const nonNegative = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const overheadAllocationTotal = (allocations = []) => allocations.reduce((sum, allocation) => sum + nonNegative(allocation.percentage), 0);

export const overheadAllocationsAreValid = (allocations = []) => allocations.length > 0
  && new Set(allocations.map((allocation) => allocation.divisionId)).size === allocations.length
  && allocations.every((allocation) => typeof allocation.divisionId === 'string' && allocation.divisionId.trim() && nonNegative(allocation.percentage) <= 100)
  && Math.abs(overheadAllocationTotal(allocations) - 100) < 0.001;

export function splitOverheadAllocationsEvenly(divisionIds) {
  const uniqueIds = [...new Set(divisionIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const hundredths = 10000;
  const base = Math.floor(hundredths / uniqueIds.length);
  const remainder = hundredths - base * uniqueIds.length;
  return uniqueIds.map((divisionId, index) => ({
    divisionId,
    percentage: (base + (index >= uniqueIds.length - remainder ? 1 : 0)) / 100,
  }));
}

export const overheadAllocationForDivision = (item, divisionId) => nonNegative(
  item.overheadDivisionAllocations?.find((allocation) => allocation.divisionId === divisionId)?.percentage,
);

export const overheadAllocatedAmount = (item, divisionId) => Math.round(
  nonNegative(item.plannedAmount) * overheadAllocationForDivision(item, divisionId),
) / 100;