import type { Budget, Employee, Expense, Invoice, Job, TimeEntry } from '../../types';

export type DivisionMonthlyMetricKey = 'revenue' | 'labourCost' | 'equipmentCost' | 'materialCost' | 'subcontractorCost' | 'overhead' | 'netProfit' | 'netProfitMargin';
export interface BudgetMonthPeriod { key: string; label: string; shortLabel: string; tabLabel: string; startDate: string; endDate: string; }
export interface DivisionMonthlyFinancialPeriod extends BudgetMonthPeriod {
  revenue: number;
  labourCost: number;
  equipmentCost: number;
  materialCost: number;
  subcontractorCost: number;
  overhead: number | null;
  netProfit: number | null;
  netProfitMargin: number | null;
}
export interface DivisionMonthlySourceStatus { availability: 'available' | 'partial' | 'unavailable'; note: string; }
export interface DivisionMonthlyFinancialResult {
  periods: BudgetMonthPeriod[];
  months: DivisionMonthlyFinancialPeriod[];
  sourceStatus: Record<Exclude<DivisionMonthlyMetricKey, 'netProfit' | 'netProfitMargin'>, DivisionMonthlySourceStatus>;
}
export interface DivisionMonthlyFinancialInput {
  budget: Budget;
  divisionId: string;
  jobs: Job[];
  invoices: Invoice[];
  timeEntries: TimeEntry[];
  employees: Employee[];
  expenses?: Expense[];
}
export function buildBudgetMonthPeriods(budget: Pick<Budget, 'fiscalYear' | 'startDate' | 'endDate'>): BudgetMonthPeriod[];
export function calculateDivisionMonthlyFinancials(input: DivisionMonthlyFinancialInput): DivisionMonthlyFinancialResult;
export function aggregateDivisionFinancialPeriods(months: DivisionMonthlyFinancialPeriod[], endIndex: number): DivisionMonthlyFinancialPeriod;
export function compareDivisionFinancialPeriods(selected: DivisionMonthlyFinancialPeriod, previous?: DivisionMonthlyFinancialPeriod | null): Record<DivisionMonthlyMetricKey, number | null>;
export const METRIC_KEYS: DivisionMonthlyMetricKey[];