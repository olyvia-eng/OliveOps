import type { Budget, BudgetDivision, BudgetRate } from '../../types';

export type EquipmentCatalogPricingRow = {
  rate: BudgetRate;
  divisionName: string;
  cost: number | null;
  overheadRecovery: number | null;
  breakeven: number | null;
  targetMarginPct: number | null;
  profit: number | null;
  calculatedRate: number | null;
  customRate: number | null;
  estimateRate: number | null;
};

export function buildEquipmentCatalogPricingRows(input: {
  pricingRates: BudgetRate[];
  budgetDivisions: BudgetDivision[];
  budgets: Budget[];
}): EquipmentCatalogPricingRow[];
