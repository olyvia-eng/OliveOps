import type { Budget, BudgetDivision, BudgetDivisionPlanningItem, OverheadRecoveryAllocation, OverheadRecoveryPolicy } from '../../types';

export type RecoveryCategory = 'labour' | 'equipment' | 'materials' | 'subcontractors';
export interface RecoveryScope {
  totalOverhead: number;
  configured: boolean;
  valid: boolean;
  allocation: OverheadRecoveryAllocation;
  allocationTotal: number;
  pools: Record<RecoveryCategory, number>;
  denominators: Record<RecoveryCategory, number>;
  rates: Record<RecoveryCategory, number>;
  recoverableAmount: number;
  unrecoverableAmount: number;
  warnings: string[];
}
export function emptyRecoveryAllocation(): OverheadRecoveryAllocation;
export function recoveryAllocationTotal(allocation?: OverheadRecoveryAllocation): number;
export function recoveryAllocationIsValid(allocation?: OverheadRecoveryAllocation): boolean;
export function annualLabourCost(item: BudgetDivisionPlanningItem): number;
export function labourDivisionShare(item: BudgetDivisionPlanningItem, divisionId: string): number;
export function plannedBillableLabourHours(item: BudgetDivisionPlanningItem): number;
export function equipmentAnnualCost(item: BudgetDivisionPlanningItem): number;
export function equipmentDivisionAnnualCost(item: BudgetDivisionPlanningItem, divisionId: string): number;
export function buildOverheadRecoveryModel(input: { budget: Budget; divisions: BudgetDivision[]; planningItems: BudgetDivisionPlanningItem[] }): { divisions: Record<string, RecoveryScope> };
export function recoveryPerUnit(scope: RecoveryScope | undefined, category: RecoveryCategory, directCostPerUnit: number): number;
export function grossMarginRate(recoveredCostPerUnit: number, targetMarginPct: number): number;
export type { OverheadRecoveryPolicy };