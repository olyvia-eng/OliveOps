export function activeDivisionsForBudget(divisions, budgetId) {
  if (!budgetId) return [];
  return divisions
    .filter((division) => division.budgetId === budgetId && division.status === 'active')
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export function resolveEstimateDivisionId(currentDivisionId, activeDivisions) {
  if (activeDivisions.length === 1) return activeDivisions[0].id;
  return activeDivisions.some((division) => division.id === currentDivisionId) ? currentDivisionId : '';
}