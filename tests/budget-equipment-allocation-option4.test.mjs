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
