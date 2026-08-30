import type { BudgetFinancials } from './budgetFinancialModel';

export type AnalysisValueMode = 'dollars' | 'percent';
export interface AnalysisSummaryLine {
  key: 'revenue' | 'labour' | 'equipment' | 'materials' | 'subcontractors' | 'overhead' | 'targetProfit';
  label: string;
  amount: number;
  percentOfRevenue: number | null;
}
export type AnalysisChartSegment = Omit<AnalysisSummaryLine, 'key'> & {
  key: Exclude<AnalysisSummaryLine['key'], 'revenue'>;
  widthPct: number;
};
export interface BudgetAnalysisSummary {
  revenue: number;
  lines: AnalysisSummaryLine[];
  chartSegments: AnalysisChartSegment[];
  chartTotal: number;
  revenueMarkerPct: number;
  totalPlannedCosts: number;
  currentProfit: number;
  currentProfitMarginPct: number | null;
  targetNetProfit: number;
  targetNetProfitPct: number;
  requiredRevenue: number;
  additionalRevenueNeeded: number;
  shortfall: number;
  surplusAfterTarget: number;
  feasible: boolean;
}
export const MAX_TARGET_MARGIN_PCT: number;
export function normalizeTargetMargin(value: number | null | undefined): number;
export function isValidTargetMarginInput(value: unknown): boolean;
export function formatTargetMarginPercent(value: number | null | undefined): string;
export function targetMarginFromDollars(targetProfit: number, revenue: number): number;
export function buildBudgetAnalysisSummary(financials: BudgetFinancials, targetMarginPct: number | null | undefined): BudgetAnalysisSummary;