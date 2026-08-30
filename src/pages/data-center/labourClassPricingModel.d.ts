import type { Budget, BudgetDivision, BudgetDivisionPlanningItem, BudgetRate, Employee, EquipmentAsset, LabourClass } from '../../types';

export interface LabourClassDivisionPricing {
  budgetId: string;
  budgetName: string;
  divisionId: string;
  divisionName: string;
  employeeCount: number;
  plannedBillableHours: number;
  annualLabourCost: number;
  averageLabourCost: number | null;
  overheadRecovery: number | null;
  breakeven: number | null;
  targetMarginPct: number | null;
  profit: number | null;
  calculatedRate: number | null;
  customRate: number | null;
  estimateRate: number | null;
  pricingAvailable: boolean;
  unavailableReason?: string;
  contributors: Array<{ employeeId: string; employeeName: string; plannedBillableHours: number; annualLabourCost: number }>;
}

export type LabourClassCatalogRow = LabourClass & {
  employees: Employee[];
  employeeCount: number;
  divisionCount: number;
  averageLabourCost: number | null;
  pricing: LabourClassDivisionPricing[];
};

export function buildLabourClassCatalog(input: {
  labourClasses: LabourClass[];
  employees: Employee[];
  budgets: Budget[];
  divisions: BudgetDivision[];
  planningItems: BudgetDivisionPlanningItem[];
  budgetRates: BudgetRate[];
  equipmentAssets?: EquipmentAsset[];
}): LabourClassCatalogRow[];
