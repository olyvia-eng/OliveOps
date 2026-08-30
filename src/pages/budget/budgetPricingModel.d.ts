import type { Budget, BudgetDivision, BudgetDivisionPlanningItem, BudgetRate, Employee, EquipmentAsset, LabourClass, LineItemCategory } from '../../types';

export interface BudgetPricingRow {
  item: BudgetDivisionPlanningItem & { labourClassId?: string };
  key: string;
  divisionId?: string;
  divisionName?: string;
  type: LineItemCategory;
  rate?: BudgetRate;
  unit: string;
  costRate: number;
  overheadPerUnit: number;
  divisionOverheadPerUnit: number;
  recoveredCostPerUnit: number;
  breakeven: number;
  targetMarginPct: number;
  profit: number;
  recommendedRate: number;
  calculatedRate: number;
  customRate: number | null;
  estimateRate: number;
  pricingAvailable: boolean;
  approvedRate?: number;
  pricingStatus?: 'approved' | 'recommended_not_approved' | 'unavailable';
  labourClassPricing?: boolean;
  billableHours?: number;
  annualCost?: number;
  divisionOverhead?: number;
  recoveryAllocationPct?: number;
  overheadPool?: number;
  recoveryDenominator?: number;
  recoveryRate?: number;
  recoveryUnavailable?: boolean;
  recoveryUnavailableReason?: 'configuration' | 'denominator';
  contributors?: Array<{ id: string; employeeId?: string; name: string; billableHours: number; annualCost: number }>;
}

export function buildBudgetPricingRows(input: {
  budget: Budget;
  divisions?: BudgetDivision[];
  planningItems: BudgetDivisionPlanningItem[];
  budgetRates: BudgetRate[];
  employees?: Employee[];
  equipmentAssets?: EquipmentAsset[];
  labourClasses?: LabourClass[];
}): BudgetPricingRow[];

export function prepareBudgetPricingInputs(input: {
  planningItems: BudgetDivisionPlanningItem[];
  employees?: Employee[];
}): BudgetDivisionPlanningItem[];

export interface BudgetLabourPricingDiagnosticEmployee {
  employeeId?: string;
  employeeName: string;
  divisionId: string;
  divisionName: string;
  labourClassId?: string | null;
  billableHours: number;
  assigned: boolean;
}

export function buildBudgetLabourPricingDiagnostics(input: {
  budget: Budget;
  divisions?: BudgetDivision[];
  planningItems: BudgetDivisionPlanningItem[];
  employees?: Employee[];
  labourClasses?: LabourClass[];
}): {
  hasPlannedLabour: boolean;
  plannedEmployeeCount: number;
  hasAssignedProductiveLabour: boolean;
  unassignedEmployees: BudgetLabourPricingDiagnosticEmployee[];
};
