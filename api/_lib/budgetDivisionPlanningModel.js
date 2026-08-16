export const DIVISION_PLAN_CATEGORIES = ['labour', 'equipment', 'materials', 'subcontractors'];

const normalizeText = (value) => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';

export function divisionPlanIdentity(item) {
  if (item.category === 'labour') return item.employeeId ? `employee:${item.employeeId}` : `custom:${normalizeText(item.name || item.description)}`;
  if (item.category === 'equipment') return item.equipmentId ? `equipment:${item.equipmentId}` : `custom:${normalizeText(item.description)}`;
  if (item.category === 'materials') return item.materialCatalogItemId ? `material:${item.materialCatalogItemId}` : `custom:${normalizeText(item.description)}:${normalizeText(item.unit)}`;
  if (item.category === 'subcontractors') return item.vendorId ? `vendor:${item.vendorId}` : `custom:${normalizeText(item.name || item.description)}`;
  return '';
}

const SHARED_FIELDS = ['name', 'description', 'sortOrder'];
const CATEGORY_FIELDS = {
  labour: ['employeeId', 'role', 'compType', 'hourlyRate', 'annualSalary', 'plannedHours', 'billableHours', 'unbillableHours', 'overtimeHours', 'overtimeMultiplier', 'payrollBurdenPct', 'labourBurdenPct', 'benefitsExtraCost', 'bonus'],
  equipment: ['equipmentId', 'costType', 'classification', 'equipmentPayment', 'paymentFrequencyPerYear', 'yearlyFuelCost', 'yearlyInsuranceCost', 'yearlyMaintenanceCost', 'sellableHoursPerYear', 'utilizationHours', 'allocationMonths', 'allocationPercent', 'plannedAmount'],
  materials: ['materialCatalogItemId', 'unit', 'unitCost', 'plannedQuantity', 'plannedAmount'],
  subcontractors: ['vendorId', 'unit', 'rate', 'plannedQuantity', 'plannedAmount'],
};

export function copyDivisionPlanAssumptions(source, destination, createId, now = new Date().toISOString()) {
  const category = source?.category;
  if (!DIVISION_PLAN_CATEGORIES.includes(category)) throw new Error('Planning category is invalid.');
  const copied = {};
  for (const field of [...SHARED_FIELDS, ...CATEGORY_FIELDS[category]]) {
    if (source[field] !== undefined) copied[field] = source[field];
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

export function appendImportedSortOrders(existingItems, importedItems) {
  const start = existingItems.length;
  return importedItems
    .slice()
    .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0))
    .map((item, index) => ({ ...item, sortOrder: start + index }));
}
