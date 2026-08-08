import type { Budget, BudgetItem, Employee, LabourBudgetPlan, RevenueSalesGoal, EquipmentCostType } from '../../types';

export interface CombinedBudgetItem extends BudgetItem {
  sourceBudgetId: string;
  sourceBudgetName: string;
  sourceBudgetDivision: string;
}

export interface CombinedLabourPlannerRow {
  budgetId: string;
  budgetName: string;
  budgetDivision: string;
  employee: Employee;
  plan: LabourBudgetPlan;
  roleTitle: string;
  hoursPerYear: number;
  billablePct: number;
  annualBillableHours: number;
  overtimeHoursYear: number;
  payrollBurdenPct: number;
  totalEmployeeCostPerYear: number;
}

export interface CombinedRevenueGoalRow {
  budgetId: string;
  budgetName: string;
  budgetDivision: string;
  goalRevenue: number;
  workingDays: number;
}

export interface CombinedBudgetCategoryRow {
  category: string;
  budgeted: number;
  actual: number;
  variance: number;
  count: number;
}

export interface CombinedBudgetViewModelSuccess {
  ok: true;
  fiscalYear: string;
  selectedBudgets: Budget[];
  categoryRows: CombinedBudgetCategoryRow[];
  categoryAnalysisRows: CombinedBudgetCategoryRow[];
  totalsByCategory: {
    revenue: { budgeted: number; actual: number };
    labour: { budgeted: number; actual: number };
    materials: { budgeted: number; actual: number };
    equipment: { budgeted: number; actual: number };
    subcontractors: { budgeted: number; actual: number };
    overhead: { budgeted: number; actual: number };
  };
  equipmentByCostType: Record<EquipmentCostType, { budgeted: number; actual: number }>;
  combinedItems: CombinedBudgetItem[];
  grouped: Record<string, CombinedBudgetItem[]>;
  labourPlannerRows: CombinedLabourPlannerRow[];
  labourTotals: {
    annualLabourCost: number;
    annualRevenueGenerated: number;
    grossProfitGenerated: number;
    billableHoursYear: number;
  };
  revenueGoalRows: CombinedRevenueGoalRow[];
  combinedRevenueBudgeted: number;
  combinedExpenseBudgeted: number;
  combinedGrossProfit: number;
  combinedGrossMargin: number;
  combinedRevenueGoal: number;
  sharedWorkingDays: number | null;
  revenuePerDayNeeded: number | null;
  hasPotentialOverlapWarning: boolean;
}

export interface CombinedBudgetViewModelFailure {
  ok: false;
  code: 'NO_IDS' | 'MISSING_BUDGET' | 'TOO_FEW' | 'MIXED_FISCAL_YEARS';
  error: string;
}

export function buildCombinedBudgetViewModel(input: {
  budgetIds: string[];
  budgets: Budget[];
  budgetItems: BudgetItem[];
  labourBudgetPlans: LabourBudgetPlan[];
  revenueSalesGoals: RevenueSalesGoal[];
  employees: Employee[];
}): CombinedBudgetViewModelSuccess | CombinedBudgetViewModelFailure;

export function formatBudgetTabLabel(value: string): string;
export function normalizeEquipmentCostType(value: string | undefined): EquipmentCostType;
export function toOptionLabel(value: string): string;
