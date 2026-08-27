import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalogPageSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const labourSource = readFileSync('src/pages/data-center/LabourCatalogSection.tsx', 'utf8');
const materialDetailSource = readFileSync('src/pages/data-center/MaterialDetailPanel.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const businessSource = readFileSync('api/business.js', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

test('Catalog is a Budget-independent resource and direct-cost library', () => {
  assert.doesNotMatch(catalogPageSource, /useCatalogPricing|catalog-pricing|pricingBudgetId/);
  assert.match(catalogPageSource, /<LabourCatalogSection \/>/);
  assert.match(catalogPageSource, /<MaterialsCatalogSection \/>/);
  assert.match(catalogPageSource, /Cost \/ Hour/);
  assert.doesNotMatch(catalogPageSource, /Calculated Rate|Custom Rate|Estimate Rate|Allocated To/);
});

test('Catalog uses Labour Classes and material costs without universal selling economics', () => {
  assert.match(labourSource, /buildLabourClassCatalog/);
  assert.match(labourSource, /Avg Labour Cost/);
  assert.doesNotMatch(labourSource, /CatalogPriceSheet|Estimate Rate|Calculated Rate/);
  assert.match(materialDetailSource, /Default Unit Cost/);
  assert.doesNotMatch(materialDetailSource, /CatalogPriceSheet|Estimate Price|Calculated Price/);
});

test('global Business Pricing Budget UI and writes are retired', () => {
  assert.doesNotMatch(appSource, /PricingSettingsPage|settings\/pricing/);
  assert.doesNotMatch(businessSource, /req\.body\?\.pricingBudgetId|getBudgetForBusiness/);
});

test('new Estimates require explicit Budget selection and ignore the dormant Business field', () => {
  assert.doesNotMatch(estimatesSource, /companyPricingBudgetId|fetch\('\/api\/business'/);
  assert.match(estimatesSource, /pricingBudgetId: ''/);
  assert.match(estimatesSource, /!createForm\.pricingBudgetId/);
  assert.match(estimatesSource, /pricingBudgetId: createForm\.pricingBudgetId/);
});