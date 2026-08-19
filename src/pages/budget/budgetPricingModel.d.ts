import type { Budget, BudgetDivisionPlanningItem, BudgetRate, LineItemCategory } from '../../types';

export interface BudgetPricingRow {
  item: BudgetDivisionPlanningItem;
  type: LineItemCategory;
  rate?: BudgetRate;
  unit: string;
  costRate: number;
  overheadPerUnit: number;
  recommendedRate: number;
  approvedRate: number;
  pricingStatus: 'approved' | 'recommended_not_approved' | 'unavailable';
}

export function buildBudgetPricingRows(input: {
  budget: Budget;
  planningItems: BudgetDivisionPlanningItem[];
  budgetRates: BudgetRate[];
  companyOverhead?: number;
}): BudgetPricingRow[];
