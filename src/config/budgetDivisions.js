export const BUDGET_DIVISIONS = Object.freeze([
  'company_wide',
  'earthworks',
  'septic',
  'landscaping',
  'other',
]);

export const BUDGET_DIVISION_LABELS = Object.freeze({
  company_wide: 'Company Wide',
  earthworks: 'Earthworks',
  septic: 'Septic',
  landscaping: 'Landscaping',
  other: 'Other',
});

const LEGACY_BUDGET_DIVISION_ALIASES = Object.freeze({
  construction: 'earthworks',
  'company-wide': 'company_wide',
  'company wide': 'company_wide',
  companywide: 'company_wide',
});

function normalizeDivisionToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeBudgetDivision(value, options = {}) {
  const { allowLegacyAliases = true } = options;
  const token = normalizeDivisionToken(value);
  if (!token) return null;

  const canonicalCandidate = token.replace(/[\s-]+/g, '_');
  if (BUDGET_DIVISIONS.includes(canonicalCandidate)) {
    return canonicalCandidate;
  }

  if (!allowLegacyAliases) return null;

  const aliased = LEGACY_BUDGET_DIVISION_ALIASES[token];
  if (aliased && BUDGET_DIVISIONS.includes(aliased)) {
    return aliased;
  }

  return null;
}

export function isValidBudgetDivision(value) {
  return normalizeBudgetDivision(value, { allowLegacyAliases: false }) !== null;
}

export function toBudgetDivisionLabel(value) {
  const normalized = normalizeBudgetDivision(value);
  return normalized ? BUDGET_DIVISION_LABELS[normalized] : 'Invalid Division';
}
