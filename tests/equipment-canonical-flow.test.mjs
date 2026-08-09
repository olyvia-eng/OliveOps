import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('catalog and budget both use shared canonical equipment form', () => {
  const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(catalogSource, /from '\.\.\/\.\.\/components\/equipment\/EquipmentAssetForm'/);
  assert.match(catalogSource, /<EquipmentAssetForm value=\{form\} onChange=\{setForm\} \/>/);

  assert.match(budgetSource, /from '\.\.\/\.\.\/components\/equipment\/EquipmentAssetForm'/);
  assert.match(budgetSource, /Canonical Equipment Asset/);
  assert.match(budgetSource, /<EquipmentAssetForm/);
  assert.match(budgetSource, /createCatalogEquipmentOnSave/);
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

  assert.match(source, /if \(defaultCategory === 'equipment'\) \{\s*\n\s*openNewCategoryItem\('equipment', \{ createCatalogAssetOnSave: true \}\);/);
  assert.match(source, /const equipmentInfoDefaultsFromAsset = \(asset: EquipmentAsset\) => \{/);
  assert.match(source, /const equipmentDefaults = equipmentInfoDefaultsFromAsset\(selected\);/);
});
