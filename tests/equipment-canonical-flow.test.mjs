import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('catalog and budget both use shared equipment fields with context-specific extensions', () => {
  const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const equipmentFormSource = readFileSync('src/components/equipment/EquipmentInfoForm.tsx', 'utf8');
  const equipmentFormModelSource = readFileSync('src/components/equipment/equipmentFormModel.ts', 'utf8');

  assert.match(catalogSource, /from '\.\.\/\.\.\/components\/equipment\/EquipmentInfoForm'/);
  assert.match(catalogSource, /<EquipmentInfoForm/);
  assert.match(catalogSource, /context="catalog"/);

  assert.match(budgetSource, /from '\.\.\/\.\.\/components\/equipment\/EquipmentInfoForm'/);
  assert.match(budgetSource, /<EquipmentInfoForm/);
  assert.match(budgetSource, /context="budget"/);
  assert.match(budgetSource, /identityReadOnly=\{Boolean\(form\.equipmentId\)\}/);
  assert.doesNotMatch(budgetSource, /Equipment Record/);
  assert.doesNotMatch(budgetSource, /Budget Equipment Planning/);
  assert.doesNotMatch(budgetSource, /createCatalogEquipmentOnSave/);

  assert.match(equipmentFormSource, /Equipment Details/);
  assert.match(equipmentFormSource, /export function EquipmentFormFields/);
  assert.match(equipmentFormSource, /equipmentCostType === 'rental' \? 'Rental Cost' : 'Annual Costs'/);
  assert.match(equipmentFormSource, /Budget Planning/);
  assert.match(equipmentFormSource, /Catalog identity is read-only here/);
  assert.match(equipmentFormSource, /Payment Frequency \(# per year\)/);
  assert.match(equipmentFormSource, /Yearly Fuel Cost/);
  assert.doesNotMatch(equipmentFormSource, /Fuel Price Unit/);
  assert.doesNotMatch(equipmentFormSource, /Fuel Burned per Hour/);
  assert.match(equipmentFormSource, /Yearly Insurance Cost/);
  assert.match(equipmentFormSource, /Yearly Maintenance Cost/);
  assert.match(equipmentFormSource, /Expected Operating Hours \/ Year/);
  assert.match(equipmentFormSource, /Expected Operating Hours \/ Day/);
  assert.doesNotMatch(equipmentFormSource, /Months Used Per Year/);
  assert.match(equipmentFormSource, /Annual Equipment Cost/);
  assert.match(equipmentFormSource, /Cost per Operating Hour/);
  assert.match(equipmentFormSource, /Cost per Operating Day/);
  assert.doesNotMatch(equipmentFormSource, /Budget Sell Rate \/ Charge-Out Rate/);
  assert.doesNotMatch(equipmentFormSource, /label="Status"/);
  assert.doesNotMatch(equipmentFormSource, /label="Purchase Date"/);
  assert.doesNotMatch(equipmentFormSource, /label="Purchase Price"/);
  assert.doesNotMatch(equipmentFormSource, /label="Serial Number"/);
  assert.match(equipmentFormModelSource, /EquipmentInfoFormValue/);
});

test('catalog and budget equipment use the same wide modal while allocations remain Budget-only', () => {
  const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const modalSource = readFileSync('src/components/ui/index.tsx', 'utf8');

  assert.match(catalogSource, /size="large"/);
  assert.match(budgetSource, /size=\{form\.category === 'equipment' \? 'large' : 'default'\}/);
  assert.match(modalSource, /size === 'large' \? 'max-w-5xl'/);
  assert.match(modalSource, /max-h-\[90vh\] flex flex-col/);
  assert.match(modalSource, /overflow-y-auto flex-1/);
  assert.match(budgetSource, /Allocate Annual Equipment Cost/);
  assert.doesNotMatch(catalogSource, /Allocate Annual Equipment Cost/);
});

test('shared equipment validation and normalization are used by both save paths', () => {
  const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const equipmentFormSource = readFileSync('src/components/equipment/equipmentFormModel.ts', 'utf8');

  assert.match(equipmentFormSource, /validateEquipmentInfoForm/);
  assert.match(equipmentFormSource, /normalizeEquipmentInfoForm/);
  assert.match(equipmentFormSource, /Select a valid equipment classification/);
  assert.match(equipmentFormSource, /Select a valid ownership \/ source/);
  assert.match(equipmentFormSource, /must be zero or greater/);
  assert.match(catalogSource, /validateEquipmentInfoForm\(form\)/);
  assert.match(catalogSource, /normalizeEquipmentInfoForm\(form\)/);
  assert.match(budgetSource, /validateEquipmentInfoForm\(equipmentInfoForm\)/);
  assert.match(budgetSource, /normalizeEquipmentInfoForm\(equipmentInfoForm\)/);
});

test('equipment modal actions describe catalog, existing Budget, and new Budget saves', () => {
  const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(catalogSource, /Add to Catalog/);
  assert.match(catalogSource, /Save Changes/);
  assert.match(budgetSource, /Add to Budget/);
  assert.match(budgetSource, /Save Equipment/);
  assert.match(budgetSource, /Edit Equipment/);
});

test('one active shared component owns equipment core and annual cost inputs', () => {
  const formSource = readFileSync('src/components/equipment/EquipmentInfoForm.tsx', 'utf8');

  assert.match(formSource, /Name \/ Equipment \*/);
  assert.match(formSource, /Cost Code/);
  assert.match(formSource, /Billable Equipment/);
  assert.match(formSource, /Overhead Equipment/);
  assert.match(formSource, /Owned/);
  assert.match(formSource, /Financed/);
  assert.match(formSource, /Leased/);
  assert.match(formSource, /Rental/);
  assert.match(formSource, /Rental Unit/);
  assert.match(formSource, />Payment</);
  assert.match(formSource, /Payment Frequency \(# per year\)/);
  assert.match(formSource, /Yearly Fuel Cost/);
  assert.match(formSource, /Yearly Insurance Cost/);
  assert.match(formSource, /Yearly Maintenance Cost/);
});

test('equipment asset type includes permanent economics fields', () => {
  const source = readFileSync('src/types/index.ts', 'utf8');

  assert.match(source, /purchasePrice\?: number;/);
  assert.match(source, /equipmentPayment\?: number;/);
  assert.match(source, /equipmentPaymentFrequencyPerYear\?: number;/);
  assert.match(source, /fuelPriceUnit\?: 'L' \| 'gal';/);
  assert.match(source, /averageFuelPrice\?: number;/);
  assert.match(source, /averageFuelBurnPerHour\?: number;/);
  assert.match(source, /yearlyInsuranceCost\?: number;/);
  assert.match(source, /yearlyMaintenanceCost\?: number;/);
});

test('api and repository validate and persist canonical economics', () => {
  const apiSource = readFileSync('api/data.js', 'utf8');
  const repoSource = readFileSync('api/_lib/authRepo.js', 'utf8');

  assert.match(apiSource, /Equipment purchase price must be zero or greater\./);
  assert.match(apiSource, /Equipment payment must be zero or greater\./);
  assert.match(apiSource, /Equipment payment frequency must be zero or greater\./);
  assert.match(apiSource, /Average fuel price must be zero or greater\./);
  assert.match(apiSource, /Average fuel burned per hour must be zero or greater\./);
  assert.match(apiSource, /Yearly insurance cost must be zero or greater\./);
  assert.match(apiSource, /Yearly maintenance cost must be zero or greater\./);

  assert.match(repoSource, /purchasePrice: item\.purchasePrice/);
  assert.match(repoSource, /equipmentPayment: item\.equipmentPayment/);
  assert.match(repoSource, /equipmentPaymentFrequencyPerYear: item\.equipmentPaymentFrequencyPerYear/);
  assert.match(repoSource, /fuelPriceUnit: item\.fuelPriceUnit/);
  assert.match(repoSource, /averageFuelPrice: item\.averageFuelPrice/);
  assert.match(repoSource, /averageFuelBurnPerHour: item\.averageFuelBurnPerHour/);
  assert.match(repoSource, /yearlyInsuranceCost: item\.yearlyInsuranceCost/);
  assert.match(repoSource, /yearlyMaintenanceCost: item\.yearlyMaintenanceCost/);
});

test('budget equipment add paths prefer canonical creation/linking', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(source, /if \(defaultCategory === 'equipment'\) \{\s*\n\s*openNewCategoryItem\('equipment'\);/);
  assert.match(source, /if \(!editing && form\.category === 'equipment' && !normalizedEquipmentId\) \{/);
  assert.match(source, /const created = await addEquipmentAsset\(\{/);
  assert.match(source, /const equipmentInfoDefaultsFromAsset = \(asset: EquipmentAsset\) => \{/);
  assert.match(source, /const equipmentDefaults = equipmentInfoDefaultsFromAsset\(selected\);/);
  assert.match(source, /equipmentId,/);
  assert.match(source, /setModalOpen\(true\);/);
  assert.doesNotMatch(source, /normalizedCostCode = normalizedCostCode \|\| createdEquipmentAssetPayload\.serialNumber/);
});

test('budget planning save creates at most one catalog asset and does not overwrite linked global fields', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const saveSource = source.slice(source.indexOf('const handleSave = async () =>'), source.indexOf('const set = (key:', source.indexOf('const handleSave = async () =>')));

  assert.equal((saveSource.match(/addEquipmentAsset\(/g) ?? []).length, 1);
  assert.doesNotMatch(saveSource, /updateEquipmentAsset\(/);
  assert.match(saveSource, /equipmentId: normalizedEquipmentId/);
  assert.match(saveSource, /else addBudgetItem\(yearlyForm, allocationMonths\)/);
  assert.match(source, /const yearlyFuelCost = b\.yearlyFuelCost\s*\?\?/);
  assert.match(source, /fuelCostPerHour/);
  assert.match(source, /monthlyInsuranceCost/);
  assert.match(source, /monthlyMaintenanceCost/);
});
