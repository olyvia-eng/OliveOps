import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('catalog and budget both use shared restored equipment info form', () => {
  const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const equipmentFormSource = readFileSync('src/components/equipment/EquipmentInfoForm.tsx', 'utf8');

  assert.match(catalogSource, /from '\.\.\/\.\.\/components\/equipment\/EquipmentInfoForm'/);
  assert.match(catalogSource, /<EquipmentInfoForm/);

  assert.match(budgetSource, /from '\.\.\/\.\.\/components\/equipment\/EquipmentInfoForm'/);
  assert.match(budgetSource, /<EquipmentInfoForm/);
  assert.doesNotMatch(budgetSource, /Equipment Record/);
  assert.doesNotMatch(budgetSource, /Budget Equipment Planning/);
  assert.doesNotMatch(budgetSource, /createCatalogEquipmentOnSave/);

  assert.match(equipmentFormSource, /Equipment Details/);
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
  assert.match(source, /setModalOpen\(true\);/);
  assert.doesNotMatch(source, /normalizedCostCode = normalizedCostCode \|\| createdEquipmentAssetPayload\.serialNumber/);
});
