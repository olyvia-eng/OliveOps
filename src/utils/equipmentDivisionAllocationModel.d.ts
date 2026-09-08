import type { BudgetDivisionPlanningItem, EquipmentDivisionAllocation } from '../types';

export function equipmentDivisionAllocation(
  item: Partial<BudgetDivisionPlanningItem> | null | undefined,
  divisionId: string,
): EquipmentDivisionAllocation | undefined;
export function equipmentMonthsForDivision(
  item: Partial<BudgetDivisionPlanningItem> | null | undefined,
  divisionId: string,
): number;
export function isEquipmentAllocatedToDivision(
  item: Partial<BudgetDivisionPlanningItem> | null | undefined,
  divisionId: string,
): boolean;
export function removeEquipmentDivisionAllocation(
  item: Partial<BudgetDivisionPlanningItem> | null | undefined,
  divisionId: string,
): EquipmentDivisionAllocation[] | null;