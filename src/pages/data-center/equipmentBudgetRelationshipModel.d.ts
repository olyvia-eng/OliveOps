import type { Budget, BudgetDivision, BudgetDivisionPlanningItem, BudgetItem, EquipmentBudgetAllocation } from '../../types';

export interface EquipmentBudgetRelationshipRow {
  id: string;
  budgetId: string;
  budget?: Budget;
  annualCost: number;
  annualHours: number;
  hoursPerDay: number;
  operatingDays: number | null;
  costPerHour: number | null;
  divisions: Array<{
    divisionId: string | null;
    division?: BudgetDivision | null;
    months: number;
    annualCost: number;
  }>;
  source: 'planning' | 'legacy';
}

export function buildEquipmentBudgetRelationshipRows(input: {
  equipmentId: string;
  planningItems: BudgetDivisionPlanningItem[];
  budgets: Budget[];
  budgetDivisions: BudgetDivision[];
  budgetItems?: BudgetItem[];
  legacyAllocations?: EquipmentBudgetAllocation[];
}): EquipmentBudgetRelationshipRow[];
