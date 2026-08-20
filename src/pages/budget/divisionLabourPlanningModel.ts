import type { BudgetDivisionPlanningItem, LabourDivisionAllocation } from '../../types';

const finiteNonNegative = (value: number | undefined, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
);

export function labourClassification(item: Partial<BudgetDivisionPlanningItem>) {
  return item.labourClassification === 'overhead' ? 'overhead' : 'billable';
}

export function calculateDivisionLabour(item: Partial<BudgetDivisionPlanningItem>) {
  const classification = labourClassification(item);
  const plannedHours = finiteNonNegative(item.plannedHours);
  const hourlyRate = finiteNonNegative(item.hourlyRate);
  const regularWageCost = item.compType === 'salaried'
    ? finiteNonNegative(item.annualSalary)
    : hourlyRate * plannedHours;
  const overtimeHours = finiteNonNegative(item.overtimeHours);
  const overtimeMultiplier = finiteNonNegative(item.overtimeMultiplier, 1.5);
  const overtimeWageCost = item.compType === 'salaried' ? 0 : hourlyRate * overtimeHours * overtimeMultiplier;
  const payrollBurdenPct = finiteNonNegative(item.payrollBurdenPct ?? item.labourBurdenPct);
  const payrollBurdenCost = (regularWageCost + overtimeWageCost) * (payrollBurdenPct / 100);
  const employerCosts = finiteNonNegative(item.benefitsExtraCost) + finiteNonNegative(item.bonus);
  const annualLabourCost = regularWageCost + overtimeWageCost + payrollBurdenCost + employerCosts;
  const expectedBillablePct = classification === 'billable'
    ? Math.min(100, finiteNonNegative(item.expectedBillablePct))
    : 0;
  const expectedBillableHours = classification === 'billable' ? plannedHours * (expectedBillablePct / 100) : 0;
  const directCostPerBillableHour = expectedBillableHours > 0 ? annualLabourCost / expectedBillableHours : 0;

  return {
    classification,
    plannedHours,
    regularWageCost,
    overtimeWageCost,
    payrollBurdenCost,
    employerCosts,
    annualLabourCost,
    expectedBillablePct,
    expectedBillableHours,
    directCostPerBillableHour,
    directLabourCost: classification === 'billable' ? annualLabourCost : 0,
    overheadLabourCost: classification === 'overhead' ? annualLabourCost : 0,
  };
}

export function labourAllocationTotal(allocations: LabourDivisionAllocation[] | undefined) {
  return (allocations ?? []).reduce((sum, allocation) => sum + finiteNonNegative(allocation.hours ?? allocation.percentage), 0);
}

export function labourAllocationForDivision(item: Partial<BudgetDivisionPlanningItem>, divisionId: string) {
  if (Array.isArray(item.divisionAllocations)) {
    const allocation = item.divisionAllocations.find((value) => value.divisionId === divisionId);
    if (allocation?.hours !== undefined) return finiteNonNegative(allocation.hours);
    return finiteNonNegative(item.plannedHours) * (finiteNonNegative(allocation?.percentage) / 100);
  }
  return item.divisionId === divisionId ? finiteNonNegative(item.plannedHours) : 0;
}

export function isLabourAllocatedToDivision(item: Partial<BudgetDivisionPlanningItem>, divisionId: string) {
  const allocation = item.divisionAllocations?.find((value) => value.divisionId === divisionId);
  if (allocation?.hours !== undefined) return finiteNonNegative(allocation.hours) > 0;
  if (allocation?.percentage !== undefined) return finiteNonNegative(allocation.percentage) > 0;
  return !Array.isArray(item.divisionAllocations) && item.divisionId === divisionId;
}

export function calculateDivisionLabourShare(item: Partial<BudgetDivisionPlanningItem>, divisionId: string) {
  const calculation = calculateDivisionLabour(item);
  const hours = labourAllocationForDivision(item, divisionId);
  const legacyPercentage = item.divisionAllocations?.find((allocation) => allocation.divisionId === divisionId)?.percentage;
  const share = calculation.plannedHours > 0 ? hours / calculation.plannedHours : finiteNonNegative(legacyPercentage) / 100;
  return {
    ...calculation,
    hours,
    annualLabourCost: calculation.annualLabourCost * share,
    expectedBillableHours: calculation.expectedBillableHours * share,
    directLabourCost: calculation.directLabourCost * share,
    overheadLabourCost: calculation.overheadLabourCost * share,
  };
}

export function splitLabourAllocationsEvenly(divisionIds: string[], plannedHours = 0): LabourDivisionAllocation[] {
  const uniqueDivisionIds = [...new Set(divisionIds)];
  if (uniqueDivisionIds.length === 0) return [];
  const totalHundredths = Math.round(finiteNonNegative(plannedHours) * 100);
  const baseHundredths = Math.floor(totalHundredths / uniqueDivisionIds.length);
  const remainder = totalHundredths - baseHundredths * uniqueDivisionIds.length;
  return uniqueDivisionIds.map((divisionId, index) => ({
    divisionId,
    hours: (baseHundredths + (index === uniqueDivisionIds.length - 1 ? remainder : 0)) / 100,
  }));
}

export function calculateBudgetLabourTotals(items: Array<Partial<BudgetDivisionPlanningItem>>) {
  const uniqueItems = [...new Map(items.filter((item) => item.category === 'labour').map((item) => [item.id, item])).values()];
  return uniqueItems.reduce((totals, item) => {
    const calculation = calculateDivisionLabour(item);
    return {
      itemCount: totals.itemCount + 1,
      annualLabourCost: totals.annualLabourCost + calculation.annualLabourCost,
      expectedBillableHours: totals.expectedBillableHours + calculation.expectedBillableHours,
      directLabourCost: totals.directLabourCost + calculation.directLabourCost,
      overheadLabourCost: totals.overheadLabourCost + calculation.overheadLabourCost,
    };
  }, { itemCount: 0, annualLabourCost: 0, expectedBillableHours: 0, directLabourCost: 0, overheadLabourCost: 0 });
}

export function allocateLabourCost(item: Partial<BudgetDivisionPlanningItem>) {
  const calculation = calculateDivisionLabour(item);
  return (item.divisionAllocations ?? []).map((allocation) => {
    const hours = allocation.hours !== undefined
      ? finiteNonNegative(allocation.hours)
      : calculation.plannedHours * (finiteNonNegative(allocation.percentage) / 100);
    const share = calculation.plannedHours > 0 ? hours / calculation.plannedHours : finiteNonNegative(allocation.percentage) / 100;
    return {
      divisionId: allocation.divisionId,
      hours,
      annualLabourCost: calculation.annualLabourCost * share,
      expectedBillableHours: calculation.expectedBillableHours * share,
      directLabourCost: calculation.directLabourCost * share,
      overheadLabourCost: calculation.overheadLabourCost * share,
    };
  });
}