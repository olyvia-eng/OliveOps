const nonNegative = (value, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
);

export const DEFAULT_PAYROLL_BURDEN_PCT = 18;
export const DEFAULT_ANNUAL_PAID_HOURS = 2080;

export function resolveEmployeeCostInputs(employee, legacy) {
  const compensationType = employee.compensationType === 'salary' ? 'salaried' : 'hourly';
  return {
    compType: compensationType,
    hourlyRate: compensationType === 'hourly' ? nonNegative(employee.hourlyRate) : nonNegative(legacy?.hourlyRate),
    annualSalary: compensationType === 'salaried' ? nonNegative(employee.hourlyRate) : nonNegative(legacy?.annualSalary),
    payrollBurdenPct: employee.payrollBurdenPct !== undefined
      ? nonNegative(employee.payrollBurdenPct)
      : nonNegative(legacy?.payrollBurdenPct ?? legacy?.labourBurdenPct, DEFAULT_PAYROLL_BURDEN_PCT),
    benefitsExtraCost: employee.benefitsExtraCost !== undefined
      ? nonNegative(employee.benefitsExtraCost)
      : nonNegative(legacy?.benefitsExtraCost),
    bonus: employee.bonus !== undefined ? nonNegative(employee.bonus) : nonNegative(legacy?.bonus),
  };
}

export function applyEmployeeCostInputs(item, employee) {
  if (!employee || item.category !== 'labour' || item.employeeId !== employee.id) return item;
  return { ...item, ...resolveEmployeeCostInputs(employee, item) };
}

export function calculateEmployeeLabourCost(employee, context = {}) {
  const regularHours = nonNegative(context.regularHours, DEFAULT_ANNUAL_PAID_HOURS);
  const overtimeHours = nonNegative(context.overtimeHours);
  const overtimeMultiplier = Math.max(1, nonNegative(context.overtimeMultiplier, 1.5));
  const expectedBillablePct = Math.min(100, nonNegative(context.expectedBillablePct, 100));
  const inputs = resolveEmployeeCostInputs(employee);
  const regularWageCost = inputs.compType === 'salaried' ? inputs.annualSalary : inputs.hourlyRate * regularHours;
  const overtimeWageCost = inputs.compType === 'salaried' ? 0 : inputs.hourlyRate * overtimeHours * overtimeMultiplier;
  const payrollBurdenCost = (regularWageCost + overtimeWageCost) * (inputs.payrollBurdenPct / 100);
  const employerCost = payrollBurdenCost + inputs.benefitsExtraCost + inputs.bonus;
  const annualLabourCost = regularWageCost + overtimeWageCost + employerCost;
  const expectedBillableHours = regularHours * (expectedBillablePct / 100);

  return {
    ...inputs,
    regularHours,
    regularWageCost,
    overtimeWageCost,
    payrollBurdenCost,
    employerCost,
    annualLabourCost,
    employerCostPerPaidHour: regularHours > 0 ? employerCost / regularHours : 0,
    labourCostPerPaidHour: regularHours > 0 ? annualLabourCost / regularHours : 0,
    expectedBillableHours,
    directCostPerBillableHour: expectedBillableHours > 0 ? annualLabourCost / expectedBillableHours : 0,
  };
}