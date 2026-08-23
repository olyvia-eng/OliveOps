import type { BudgetDivisionPlanningItem, OverheadDivisionAllocation } from '../../types';

export function overheadAllocationTotal(allocations?: OverheadDivisionAllocation[]): number;
export function overheadAllocationsAreValid(allocations?: OverheadDivisionAllocation[]): boolean;
export function splitOverheadAllocationsEvenly(divisionIds: string[]): OverheadDivisionAllocation[];
export function overheadAllocationForDivision(item: Partial<BudgetDivisionPlanningItem>, divisionId: string): number;
export function overheadAllocatedAmount(item: Partial<BudgetDivisionPlanningItem>, divisionId: string): number;