export const DIVISION_PLAN_CATEGORIES = ['labour', 'equipment', 'materials', 'subcontractors', 'overhead'];

const normalizeText = (value) => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';

export function divisionPlanIdentity(item) {
  if (item.category === 'labour') return item.employeeId ? `employee:${item.employeeId}` : `custom:${normalizeText(item.name || item.description)}`;
  if (item.category === 'equipment') return item.equipmentId ? `equipment:${item.equipmentId}` : `custom:${normalizeText(item.description)}`;
  if (item.category === 'materials') return item.materialCatalogItemId ? `material:${item.materialCatalogItemId}` : `custom:${normalizeText(item.description)}:${normalizeText(item.unit)}`;
  if (item.category === 'subcontractors') return item.subcontractorCatalogItemId || item.vendorId ? `subcontractor:${item.subcontractorCatalogItemId ?? item.vendorId}` : `custom:${normalizeText(item.name || item.description)}`;
  if (item.category === 'overhead') return item.legacyBudgetItemId ? `legacy:${item.legacyBudgetItemId}` : `custom:${normalizeText(item.name || item.description)}`;
  return '';
}

const SHARED_FIELDS = ['name', 'description', 'sortOrder'];
const CATEGORY_FIELDS = {
  labour: ['employeeId', 'role', 'compType', 'hourlyRate', 'annualSalary', 'plannedHours', 'billableHours', 'unbillableHours', 'labourClassification', 'expectedBillablePct', 'overtimeHours', 'overtimeMultiplier', 'payrollBurdenPct', 'labourBurdenPct', 'benefitsExtraCost', 'bonus', 'divisionAllocations'],
  equipment: ['equipmentId', 'costType', 'classification', 'equipmentPayment', 'equipmentPaymentFrequencyPerYear', 'paymentFrequencyPerYear', 'yearlyFuelCost', 'yearlyInsuranceCost', 'yearlyMaintenanceCost', 'expectedReplacementCost', 'expectedResaleValue', 'remainingUsefulMonths', 'sellableHoursPerYear', 'equipmentHoursPerDay', 'utilizationHours', 'allocationMonths', 'allocationPercent', 'plannedAmount', 'rentalCost', 'rentalUnit', 'unit', 'equipmentDivisionAllocations'],
  materials: ['materialCatalogItemId', 'unit', 'unitCost', 'plannedQuantity', 'plannedAmount'],
  subcontractors: ['vendorId', 'subcontractorCatalogItemId', 'unit', 'rate', 'plannedQuantity', 'plannedAmount'],
  overhead: ['costCode', 'plannedAmount', 'overheadDivisionAllocations', 'legacyBudgetItemId'],
};

export function copyDivisionPlanAssumptions(source, destination, createId, now = new Date().toISOString()) {
  const category = source?.category;
  if (!DIVISION_PLAN_CATEGORIES.includes(category)) throw new Error('Planning category is invalid.');
  const copied = {};
  for (const field of [...SHARED_FIELDS, ...CATEGORY_FIELDS[category]]) {
    if (source[field] !== undefined) copied[field] = source[field];
  }
  if (category === 'labour' && Array.isArray(copied.divisionAllocations) && destination.divisionIdMap) {
    const allocationsByDivision = new Map();
    const usesHours = Number.isFinite(source.plannedHours) && source.plannedHours > 0;
    for (const allocation of copied.divisionAllocations) {
      const value = usesHours
        ? (Number.isFinite(allocation.hours) ? allocation.hours : source.plannedHours * (allocation.percentage ?? 0) / 100)
        : (allocation.percentage ?? 0);
      if (!(value > 0)) continue;
      const divisionId = destination.divisionIdMap.get(allocation.divisionId);
      if (!divisionId) throw new Error('Every positive Labour allocation requires a mapped destination Division.');
      allocationsByDivision.set(divisionId, (allocationsByDivision.get(divisionId) ?? 0) + value);
    }
    copied.divisionAllocations = [...allocationsByDivision].map(([divisionId, value]) => usesHours
      ? ({ divisionId, hours: value })
      : ({ divisionId, percentage: value }));
  }
  if (category === 'overhead' && Array.isArray(copied.overheadDivisionAllocations) && destination.divisionIdMap) {
    copied.overheadDivisionAllocations = copied.overheadDivisionAllocations.map((allocation) => {
      const divisionId = destination.divisionIdMap.get(allocation.divisionId);
      if (!divisionId) throw new Error('Every Overhead allocation requires a mapped destination Division.');
      return { divisionId, percentage: allocation.percentage };
    });
  }
  return {
    ...copied,
    id: createId(),
    budgetId: destination.budgetId,
    divisionId: destination.divisionId,
    category,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeLabourPlanAssumptions(item) {
  if (item.category !== 'labour') return item;
  const plannedHours = Number.isFinite(item.plannedHours) && item.plannedHours >= 0 ? item.plannedHours : 0;
  const fallbackBillablePct = plannedHours > 0 && Number.isFinite(item.billableHours)
    ? Math.min(100, Math.max(0, (item.billableHours / plannedHours) * 100))
    : 0;
  const labourClassification = item.labourClassification === 'overhead' ? 'overhead' : 'billable';
  return {
    ...item,
    labourClassification,
    expectedBillablePct: labourClassification === 'overhead'
      ? 0
      : (Number.isFinite(item.expectedBillablePct) ? item.expectedBillablePct : fallbackBillablePct),
    overtimeHours: Number.isFinite(item.overtimeHours) ? item.overtimeHours : 0,
    overtimeMultiplier: Number.isFinite(item.overtimeMultiplier) ? item.overtimeMultiplier : 1.5,
    divisionAllocations: Array.isArray(item.divisionAllocations) && item.divisionAllocations.length
      ? item.divisionAllocations.map((allocation) => plannedHours > 0 || Number.isFinite(allocation.hours)
        ? ({
          divisionId: allocation.divisionId,
          hours: Number.isFinite(allocation.hours) && allocation.hours >= 0
            ? allocation.hours
            : plannedHours * (Number.isFinite(allocation.percentage) ? allocation.percentage : 0) / 100,
        })
        : ({ divisionId: allocation.divisionId, percentage: allocation.percentage }))
      : [{ divisionId: item.divisionId, hours: plannedHours }],
  };
}

export function appendImportedSortOrders(existingItems, importedItems) {
  const start = existingItems.length;
  return importedItems
    .slice()
    .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0))
    .map((item, index) => ({ ...item, sortOrder: start + index }));
}
