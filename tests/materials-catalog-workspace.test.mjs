import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const catalogSource = readFileSync('src/pages/data-center/MaterialsCatalogSection.tsx', 'utf8');
const detailSource = readFileSync('src/pages/data-center/MaterialDetailPanel.tsx', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');

test('materials route uses the dedicated catalog workspace and removes the legacy analytics UI', () => {
  assert.match(routeSource, /<MaterialsCatalogSection\s*\/>/);
  for (const retiredText of ['Total Planned + Spent', 'Most Referenced', 'Active Material Rows', 'Highest Value']) {
    assert.doesNotMatch(routeSource, new RegExp(retiredText.replaceAll('+', '\\+')));
  }
  assert.doesNotMatch(routeSource, /material-catalog-form/);
});

test('catalog exposes URL-backed Equipment and Materials tabs instead of stacked sections', () => {
  assert.match(routeSource, /type CatalogTab = 'equipment' \| 'materials'/);
  assert.match(routeSource, /searchParams\.get\('catalog'\) === 'materials'/);
  assert.match(routeSource, /role="tablist" aria-label="Catalog type"/);
  assert.match(routeSource, /role="tab" aria-selected=\{activeCatalog === tab\.key\}/);
  assert.match(routeSource, /activeCatalog === 'materials'[\s\S]*<MaterialsCatalogSection \/>/);
  assert.match(routeSource, /activeCatalog === 'equipment'[\s\S]*<DetailWorkspace/);
});

test('materials catalog renders persisted records in a compact Equipment-style table', () => {
  assert.match(catalogSource, /state\.materialCatalogItems/);
  assert.match(catalogSource, /<table className="w-full min-w-\[720px\] text-sm">/);
  for (const heading of ['Material', 'Unit', 'Default Unit Cost', 'Allocated To']) {
    assert.match(catalogSource, new RegExp(`>${heading}<`));
  }
  assert.match(catalogSource, /\{formatCurrency\(material\.defaultUnitCost\)\}\/\{material\.unit\}/);
  assert.doesNotMatch(catalogSource, /estimateMentions|jobCostMentions|expenseMentions|referencedJobs/);
});

test('materials toolbar supports search, unit, and real allocation filters without fabricated status', () => {
  assert.match(catalogSource, /placeholder="Search materials\.\.\."/);
  assert.match(catalogSource, /aria-label="Filter by material unit"/);
  assert.match(catalogSource, /aria-label="Filter by material allocation"/);
  assert.match(catalogSource, /item\.category !== 'materials' \|\| !item\.materialCatalogItemId/);
  assert.match(catalogSource, /allocation\.budgetId === allocationFilter\.slice\(7\)/);
  assert.match(catalogSource, /allocation\.divisionId === allocationFilter\.slice\(9\)/);
  assert.doesNotMatch(catalogSource, /Filter by material status|SKU|Supplier|Cost Code/);
});

test('material rows open a URL-backed DetailWorkspace with selection state', () => {
  assert.match(catalogSource, /MATERIAL_WORKSPACE_QUERY/);
  assert.match(catalogSource, /readDetailWorkspaceQuery/);
  assert.match(catalogSource, /openDetailWorkspace/);
  assert.match(catalogSource, /closeDetailWorkspace/);
  assert.match(catalogSource, /setDetailWorkspaceMode/);
  assert.match(catalogSource, /setDetailWorkspaceTab/);
  assert.match(catalogSource, /aria-selected=\{workspace\.recordId === material\.id\}/);
  assert.match(detailSource, /'overview', label: 'Overview'/);
  assert.match(detailSource, /'budgets', label: 'Budgets'/);
});

test('add and edit use a modal containing only supported material fields', () => {
  assert.match(catalogSource, /title=\{editingId \? `Edit Material/);
  for (const field of ['Material Name', 'Unit', 'Default Unit Cost', 'Notes']) {
    assert.match(catalogSource, new RegExp(`label="${field}"`));
  }
  assert.match(catalogSource, /setForm\(\{ name: material\.name, unit: material\.unit, defaultUnitCost: material\.defaultUnitCost, notes: material\.notes \}\)/);
  assert.doesNotMatch(catalogSource, /label="(?:Status|SKU|Supplier|Cost Code)"/);
});

test('material saves await persistence, block duplicates, and preserve form state on failure', () => {
  assert.match(catalogSource, /if \(saveInFlight\.current\) return/);
  assert.match(catalogSource, /saveInFlight\.current = true/);
  assert.match(catalogSource, /if \(editingId\) await updateMaterialCatalogItem\(editingId, payload\)/);
  assert.match(catalogSource, /else await addMaterialCatalogItem\(payload\)/);
  assert.match(catalogSource, /catch \{\s*setSaveStatus\('failed'\);\s*setSaveError\(/);
  assert.match(catalogSource, /saveStatus === 'saving' \? 'Saving\.\.\.'/);
  assert.doesNotMatch(catalogSource, /catch \{[^}]*setForm\(emptyForm\(\)\)/s);
  assert.match(storeSource, /addMaterialCatalogItem: async \(item\) =>/);
  assert.match(storeSource, /updateMaterialCatalogItem: async \(id, data\) =>/);
});

test('materials catalog provides clean empty and filtered states', () => {
  assert.match(catalogSource, /title="No materials yet"/);
  assert.match(catalogSource, /description="Add commonly used materials so budgeting and estimating stay consistent\."/);
  assert.match(catalogSource, /title="No materials match these filters"/);
  assert.match(catalogSource, /onClick=\{clearFilters\}>Clear Filters/);
});

test('material detail shows actual allocation fields and supported record details', () => {
  for (const heading of ['Material Name', 'Unit', 'Default Unit Cost', 'Budget', 'Division', 'Planned Quantity', 'Unit Cost']) {
    assert.match(detailSource, new RegExp(`>${heading}<`));
  }
  assert.match(detailSource, /allocation\.budgetName/);
  assert.match(detailSource, /allocation\.divisionName/);
  assert.match(detailSource, /Delete Material/);
  assert.doesNotMatch(detailSource, /Status|SKU|Supplier|Cost Code/);
});
