import type { BudgetDivision, ID } from '../../types';

export function activeDivisionsForBudget(divisions: BudgetDivision[], budgetId: ID | ''): BudgetDivision[];
export function resolveEstimateDivisionId(currentDivisionId: ID | '', activeDivisions: BudgetDivision[]): ID | '';