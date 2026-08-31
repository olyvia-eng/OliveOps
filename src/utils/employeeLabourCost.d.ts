import type { BudgetDivisionPlanningItem, Employee } from '../types';

export const DEFAULT_PAYROLL_BURDEN_PCT: number;
export const DEFAULT_ANNUAL_PAID_HOURS: number;

export interface EmployeeLabourCostContext {
  regularHours?: number;
  overtimeHours?: number;
  overtimeMultiplier?: number;
  expectedBillablePct?: number;
  classification?: 'billable' | 'overhead';
  fieldProducingPct?: number;
}

export interface ResolvedEmployeeCostInputs {
  compType: 'hourly' | 'salaried';
  hourlyRate: number;
  annualSalary: number;
  payrollBurdenPct: number;
  benefitsExtraCost: number;
  bonus: number;
}

export function resolveEmployeeCostInputs(employee: Employee, legacy?: Partial<BudgetDivisionPlanningItem>): ResolvedEmployeeCostInputs;
export function resolveFieldProducingPct(value: unknown, labourClassification?: 'billable' | 'overhead'): number;
export function applyEmployeeCostInputs(item: BudgetDivisionPlanningItem, employee?: Employee): BudgetDivisionPlanningItem;
export function calculateLabourCostFromInputs(inputs: ResolvedEmployeeCostInputs, context?: EmployeeLabourCostContext): ResolvedEmployeeCostInputs & {
  regularHours: number;
  regularWageCost: number;
  overtimeWageCost: number;
  payrollBurdenCost: number;
  employerCost: number;
  annualLabourCost: number;
  employerCostPerPaidHour: number;
  labourCostPerPaidHour: number;
  fieldProducingPct: number;
  overheadPct: number;
  fieldProducingHours: number;
  expectedBillableHours: number;
  directLabourCost: number;
  overheadLabourCost: number;
  directCostPerBillableHour: number;
};
export function calculateEmployeeLabourCost(employee: Employee, context?: EmployeeLabourCostContext): ReturnType<typeof calculateLabourCostFromInputs>;