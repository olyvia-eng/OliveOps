import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalogPageSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const priceSheetSource = readFileSync('src/pages/data-center/CatalogPriceSheet.tsx', 'utf8');
const labourSource = readFileSync('src/pages/data-center/LabourCatalogSection.tsx', 'utf8');
const materialDetailSource = readFileSync('src/pages/data-center/MaterialDetailPanel.tsx', 'utf8');
const subcontractorSource = readFileSync('src/pages/data-center/SubcontractorCatalogSection.tsx', 'utf8');
const pricingSettingsSource = readFileSync('src/pages/settings/PricingSettingsPage.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');

test('Catalog categories share one server-fed current price book', () => {
  assert.match(catalogPageSource, /const catalogPricing = useCatalogPricing\(\)/);
  assert.match(catalogPageSource, /<EquipmentDetailPanel[\s\S]*catalogPricing=\{catalogPricing\.pricing\}/);
  for (const component of ['LabourCatalogSection', 'MaterialsCatalogSection', 'SubcontractorCatalogSection']) {
    assert.match(catalogPageSource, new RegExp(`<${component}[\\s\\S]*pricing=\\{catalogPricing\\.pricing\\}`));
  }
  assert.match(priceSheetSource, /selected\.profit/);
  assert.doesNotMatch(priceSheetSource, /calculatedRate\s*[-+*/]|recoveredCostPerUnit\s*[-+*/]|targetMarginPct\s*[-+*/]/);
});

test('Catalog detail pricing filters authoritative rows by canonical resource identity', () => {
  assert.match(labourSource, /item\.labourClassId === row\.id \|\| item\.sourceEntityId === row\.id/);
  assert.match(materialDetailSource, /item\.sourceEntityId === material\.id/);
  assert.match(subcontractorSource, /item\.sourceEntityId \?\? item\.budgetItemId/);
  assert.match(priceSheetSource, /status === 'unconfigured'/);
  assert.match(priceSheetSource, /status === 'invalid'/);
  assert.match(priceSheetSource, /Pricing Division/);
  assert.match(priceSheetSource, /Used for new Estimates\./);
});

test('Pricing Budget selection persists only from the explicit save action', () => {
  assert.match(pricingSettingsSource, /const save = async \(\) =>/);
  assert.match(pricingSettingsSource, /method: 'PATCH'/);
  assert.match(pricingSettingsSource, /onClick=\{\(\) => void save\(\)\}/);
  assert.doesNotMatch(pricingSettingsSource, /onChange=\{[^}]*fetch\(/s);
  assert.match(pricingSettingsSource, /Existing Estimates are not repriced\./);
});

test('new Estimates default to the eligible company Pricing Budget without rewriting existing Estimates', () => {
  assert.match(estimatesSource, /fetch\('\/api\/business'/);
  assert.match(estimatesSource, /setCompanyPricingBudgetId\(eligible \? configuredId : ''\)/);
  assert.match(estimatesSource, /setCreateForm\(\{[\s\S]*pricingBudgetId: companyPricingBudgetId,[\s\S]*\}\)/);
  assert.doesNotMatch(estimatesSource, /updateEstimate\([^)]*companyPricingBudgetId/);
});