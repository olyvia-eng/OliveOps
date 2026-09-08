export function equipmentDivisionAllocation(item, divisionId) {
  if (Array.isArray(item?.equipmentDivisionAllocations)) {
    return item.equipmentDivisionAllocations.find((allocation) => allocation.divisionId === divisionId);
  }
  if (item?.divisionId !== divisionId) return undefined;
  return {
    divisionId,
    months: item.allocationMonths ?? 12,
    sellableHours: item.utilizationHours,
  };
}

export function equipmentMonthsForDivision(item, divisionId) {
  const months = Number(equipmentDivisionAllocation(item, divisionId)?.months ?? 0);
  return Number.isFinite(months) ? Math.max(0, months) : 0;
}

export function isEquipmentAllocatedToDivision(item, divisionId) {
  return equipmentMonthsForDivision(item, divisionId) > 0;
}

export function removeEquipmentDivisionAllocation(item, divisionId) {
  if (!Array.isArray(item?.equipmentDivisionAllocations)) return null;
  const removed = item.equipmentDivisionAllocations.find((allocation) => allocation.divisionId === divisionId);
  if (!(Number(removed?.months) > 0)) return null;

  const recipient = item.equipmentDivisionAllocations.find((allocation) => (
    allocation.divisionId === item.divisionId
    && allocation.divisionId !== divisionId
  )) ?? item.equipmentDivisionAllocations.find((allocation) => (
    allocation.divisionId !== divisionId
    && Number(allocation.months) > 0
  ));
  if (!recipient) return null;

  return item.equipmentDivisionAllocations.map((allocation) => {
    if (allocation.divisionId === divisionId) return { ...allocation, months: 0, sellableHours: 0 };
    if (allocation.divisionId === recipient.divisionId) return { ...allocation, months: Number(allocation.months || 0) + Number(removed.months) };
    return allocation;
  });
}