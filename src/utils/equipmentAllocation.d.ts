import type { Budget, BudgetGroup, EquipmentBudgetAllocation } from '../types';

export const EQUIPMENT_ALLOCATION_CAPACITY_MONTHS: 12;

export function normalizeAllocatedMonths(value: number): number;
export function calculateAllocatedEquipmentCost(annualCost: number, monthsAllocated: number): number;
export function getEquipmentAllocationsForGroup(
  allocations: EquipmentBudgetAllocation[],
  budgetGroupId: string,
  equipmentId?: string,
): EquipmentBudgetAllocation[];

export interface EquipmentAllocationSummary {
  allocations: EquipmentBudgetAllocation[];
  totalMonthsAllocated: number;
  remainingMonths: number;
  suggestedMonths: number;
  overAllocatedMonths: number;
  isOverAllocated: boolean;
  allocatedCost: number;
  unallocatedCost: number;
}

export function calculateEquipmentAllocationSummary(input: {
  allocations: EquipmentBudgetAllocation[];
  budgetGroupId: string;
  equipmentId: string;
  annualCost: number;
  excludeAllocationId?: string;
}): EquipmentAllocationSummary;

export function buildEquipmentAllocationGroups(input: {
  allocations: EquipmentBudgetAllocation[];
  budgetGroups: BudgetGroup[];
  budgets: Budget[];
  equipmentId: string;
  annualCost: number;
}): Array<EquipmentAllocationSummary & {
  group: BudgetGroup;
  rows: Array<{
    allocation: EquipmentBudgetAllocation;
    budget: Budget | null;
    allocatedCost: number;
  }>;
}>;