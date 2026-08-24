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
  recoveredCostPerUnit: number;
  targetMarginPct: number;
  recommendedRate: number;
  calculatedRate: number;
  pricingAvailable: boolean;
  approvedRate: number;
  pricingStatus: 'approved' | 'recommended_not_approved' | 'unavailable';
  aggregateLabour?: boolean;
  billableHours?: number;
  annualCost?: number;
  divisionOverhead?: number;
  recoveryAllocationPct?: number;
  overheadPool?: number;
  recoveryDenominator?: number;
  recoveryRate?: number;
  recoveryUnavailable?: boolean;
  recoveryUnavailableReason?: 'configuration' | 'denominator';
  contributors?: Array<{ id: string; name: string; billableHours: number; annualCost: number }>;
}

export function buildBudgetPricingRows(input: {
  budget: Budget;
  divisions?: BudgetDivision[];
  planningItems: BudgetDivisionPlanningItem[];
  budgetRates: BudgetRate[];
}): BudgetPricingRow[];
