import type { Budget, BudgetDivision, BudgetDivisionPlanningItem, BudgetRate, LineItemCategory } from '../../types';

export interface BudgetPricingRow {
  item: BudgetDivisionPlanningItem;
  key: string;
  divisionId?: string;
  divisionName?: string;
  type: LineItemCategory;
  rate?: BudgetRate;
  unit: string;
  costRate: number;
  overheadPerUnit: number;
  divisionOverheadPerUnit: number;
  companyOverheadPerUnit: number;
  recoveredCostPerUnit: number;
  targetMarginPct: number;
  recommendedRate: number;
  approvedRate: number;
  pricingStatus: 'approved' | 'recommended_not_approved' | 'unavailable';
}

export function buildBudgetPricingRows(input: {
  budget: Budget;
  divisions?: BudgetDivision[];
  planningItems: BudgetDivisionPlanningItem[];
  budgetRates: BudgetRate[];
  companyOverhead?: number;
}): BudgetPricingRow[];
