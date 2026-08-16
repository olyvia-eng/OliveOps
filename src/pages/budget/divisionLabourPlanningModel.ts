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
  return (allocations ?? []).reduce((sum, allocation) => sum + finiteNonNegative(allocation.percentage), 0);
}

export function allocateLabourCost(item: Partial<BudgetDivisionPlanningItem>) {
  const calculation = calculateDivisionLabour(item);
  return (item.divisionAllocations ?? []).map((allocation) => ({
    ...allocation,
    annualLabourCost: calculation.annualLabourCost * (finiteNonNegative(allocation.percentage) / 100),
    expectedBillableHours: calculation.expectedBillableHours * (finiteNonNegative(allocation.percentage) / 100),
    directLabourCost: calculation.directLabourCost * (finiteNonNegative(allocation.percentage) / 100),
    overheadLabourCost: calculation.overheadLabourCost * (finiteNonNegative(allocation.percentage) / 100),
  }));
}