export const BUDGET_DIVISIONS: readonly [
  'company_wide',
  'earthworks',
  'septic',
  'landscaping',
  'other',
];

export type BudgetDivisionValue = (typeof BUDGET_DIVISIONS)[number];

export const BUDGET_DIVISION_LABELS: Record<BudgetDivisionValue, string>;

export function normalizeBudgetDivision(
  value: unknown,
  options?: { allowLegacyAliases?: boolean }
): BudgetDivisionValue | null;

export function isValidBudgetDivision(value: unknown): value is BudgetDivisionValue;

export function toBudgetDivisionLabel(value: unknown): string;
