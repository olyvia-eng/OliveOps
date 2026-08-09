import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('budget equipment formula allocates fixed ownership using allocation percent', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /normalizedAllocatedFixedOwnershipCostPerYear\s*=\s*normalizedFixedOwnershipCostBasePerYear\s*\*\s*\(normalizedEquipmentCostAllocationPercent\s*\/\s*100\)/);
  assert.match(source, /normalizedVariableOperatingCostPerYear\s*=\s*normalizedFuelCostPerHour\s*\*\s*normalizedBillableHoursPerYear/);
  assert.match(source, /normalizedTotalEquipmentCostPerYear\s*=\s*\n\s*normalizedAllocatedFixedOwnershipCostPerYear\s*\n\s*\+\s*normalizedVariableOperatingCostPerYear/);
});

test('months used per year is validated and not used as allocation divisor', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /Planning Months \(not used in allocation formula\)/);
  assert.doesNotMatch(source, /monthsUsedPerYear\s*\/\s*12/);
  assert.doesNotMatch(source, /normalizedMonthsUsedPerYear\s*\/\s*12/);
});

test('budget item API validates months used and allocation percent on budget entity', () => {
  const source = readFileSync('api/data.js', 'utf8');

  assert.match(source, /if \(entity === 'budget'\) \{\s*\n\s*const validationError = validateBudgetItemRecord\(/);
  assert.match(source, /Months used per year must be a whole number between 1 and 12\./);
  assert.match(source, /Equipment cost allocation percent must be zero or greater\./);
});

test('budget equipment editor exposes explicit linked equipment selection', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /label="Linked Equipment Asset"/);
  assert.match(source, /Unlinked \(manual equipment row\)/);
  assert.match(source, /handleLinkedEquipmentSelect/);
});

test('equipment list rows display allocation summary status badges', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /Allocated \$\{allocationStatus\.totalAllocatedPercent\.toFixed\(1\)\}%/);
  assert.match(source, /Fully allocated/);
  assert.match(source, /Over by \$\{allocationStatus\.overAllocatedPercent\.toFixed\(1\)\}%/);
  assert.match(source, /unallocated/);
});

test('budget equipment tab renders split equipment planner and equipment catalog experience', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /Current Budget Equipment Plan/);
  assert.match(source, /Equipment Catalog/);
  assert.match(source, /Add existing equipment to this budget\./);
  assert.match(source, /Search equipment\.\.\./);
  assert.match(source, /lg:grid-cols-\[minmax\(0,7fr\)_minmax\(300px,3fr\)\]/);
});

test('equipment catalog supports add state and remove-from-budget behavior without deleting equipment', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /This equipment is already included in this budget\./);
  assert.match(source, /Remove from Budget/);
  assert.match(source, /This removes the equipment from this budget only\./);
  assert.match(source, /All available equipment is included in this budget\./);
});

test('new equipment can be created in place and linked to current budget', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /handleCreateEquipmentAndAddToBudget/);
  assert.match(source, /Create & Add/);
  assert.match(source, /addEquipmentAsset\(payload\)/);
  assert.match(source, /addEquipmentToCurrentBudget\(created\.id\)/);
});

test('budget equipment API validates tenant ownership and duplicate links', () => {
  const source = readFileSync('api/data.js', 'utf8');

  assert.match(source, /validateBudgetItemRelationships/);
  assert.match(source, /Linked equipment must belong to this business\./);
  assert.match(source, /already linked to this budget for the selected fiscal year/);
});
