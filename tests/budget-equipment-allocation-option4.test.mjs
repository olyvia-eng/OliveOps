import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('budget equipment calculations use shared helper and live sell-rate preview pipeline', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /calculateEquipmentCostBreakdown/);
  assert.match(source, /calculateSuggestedEquipmentSellRate/);
  assert.match(source, /resolveEquipmentSellRatePreview\(equipmentSellRateOverride, suggestedEquipmentSellRate\)/);
  assert.match(source, /budgetSellRate=\{previewEquipmentSellRate\}/);
  assert.match(source, /defaultSellPrice: normalizedBudgetSellRate,/);
});

test('months used per year remains separate from grouped equipment allocation', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const sharedFormSource = readFileSync('src/components/equipment/EquipmentInfoForm.tsx', 'utf8');

  assert.match(source, /<EquipmentInfoForm/);
  assert.match(sharedFormSource, /Months Used Per Year/);
  assert.doesNotMatch(source, /Planning Months \(not used in allocation formula\)/);
  assert.doesNotMatch(source, /monthsUsedPerYear\s*\/\s*12/);
  assert.doesNotMatch(source, /normalizedMonthsUsedPerYear\s*\/\s*12/);
  assert.match(source, /Months allocated/);
  assert.match(source, /calculateAllocatedEquipmentCost/);
});

test('budget item API validates months used and allocation percent on budget entity', () => {
  const source = readFileSync('api/data.js', 'utf8');

  assert.match(source, /if \(entity === 'budget'\) \{\s*\n\s*const validationError = validateBudgetItemRecord\(/);
  assert.match(source, /Months used per year must be a whole number between 1 and 12\./);
  assert.match(source, /Equipment cost allocation percent must be zero or greater\./);
});

test('budget equipment editor removes linked catalog selector from add equipment form', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.doesNotMatch(source, /label="Linked Equipment Asset"/);
  assert.doesNotMatch(source, /Unlinked \(manual equipment row\)/);
  assert.doesNotMatch(source, /handleLinkedEquipmentSelect/);
});

test('equipment list rows no longer display allocation summary status badges', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.doesNotMatch(source, /Allocated \$\{allocationStatus\.totalAllocatedPercent\.toFixed\(1\)\}%/);
  assert.doesNotMatch(source, /Fully allocated/);
  assert.doesNotMatch(source, /Over by \$\{allocationStatus\.overAllocatedPercent\.toFixed\(1\)\}%/);
  assert.doesNotMatch(source, /unallocated/);
});

test('budget equipment tab renders split equipment planner and equipment catalog experience', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /Current Budget Equipment Plan/);
  assert.match(source, /Equipment Catalog/);
  assert.match(source, /Add existing equipment to this budget\./);
  assert.match(source, /Search equipment\.\.\./);
  assert.match(source, /Cost \/ Year/);
  assert.match(source, /Cost \/ Day/);
  assert.match(source, /Budget Sell Rate \/ Hr/);
  assert.match(source, /lg:grid-cols-\[minmax\(0,7fr\)_minmax\(300px,3fr\)\]/);
});

test('equipment catalog supports add state and remove-from-budget behavior without deleting equipment', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /This equipment is already included in this budget\./);
  assert.match(source, /Remove from Budget/);
  assert.match(source, /This removes the equipment from this budget only\./);
  assert.match(source, /All available equipment is included in this budget\./);
});

test('new equipment uses equipment budget row form and custom row CTA is removed', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /New Equipment/);
  assert.match(source, /openNewCategoryItem\('equipment'\)/);
  assert.match(source, /if \(!editing && form\.category === 'equipment' && !normalizedEquipmentId\) \{/);
  assert.match(source, /const created = await addEquipmentAsset\(\{/);
  assert.match(source, /setEquipmentInfoForm\(emptyEquipmentInfoFormValue\(\)\);/);
  assert.doesNotMatch(source, /Add Custom Equipment Row/);
  assert.doesNotMatch(source, /handleCreateEquipmentAndAddToBudget/);
  assert.doesNotMatch(source, /Create & Add/);
});

test('equipment add flow does not use first-item category lookup and preserves explicit add-vs-edit save branching', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.doesNotMatch(source, /items\.find\(\(item\) => item\.category === category\)/);
  assert.match(source, /const openNewCategoryItem = \(category: BudgetCategory\) => \{/);
  assert.match(source, /setEditing\(null\);/);
  assert.match(source, /if \(editing\) updateBudgetItem\(editing\.id, yearlyForm, allocationMonths\);/);
  assert.match(source, /else addBudgetItem\(yearlyForm, allocationMonths\);/);
  assert.match(source, /const addEquipmentToCurrentBudget = \(equipmentId: string\) => \{/);
  assert.match(source, /setModalOpen\(true\);/);
});

test('multi-row category summary cards no longer open ambiguous first-item editors', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.doesNotMatch(source, /openCategoryEditor\('revenue'\)/);
  assert.doesNotMatch(source, /openCategoryEditor\('materials'\)/);
  assert.doesNotMatch(source, /openCategoryEditor\('equipment'\)/);
  assert.doesNotMatch(source, /openCategoryEditor\('subcontractors'\)/);
  assert.doesNotMatch(source, /openCategoryEditor\('overhead'\)/);
});

test('budget equipment API validates tenant ownership and duplicate links', () => {
  const source = readFileSync('api/data.js', 'utf8');

  assert.match(source, /validateBudgetItemRelationships/);
  assert.match(source, /Linked equipment must belong to this business\./);
  assert.match(source, /already linked to this budget for the selected fiscal year/);
});
