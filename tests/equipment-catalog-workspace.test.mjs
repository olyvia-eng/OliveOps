import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEquipmentCatalogPricingRows } from '../src/pages/data-center/equipmentCatalogPricingModel.js';

const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const detailSource = readFileSync('src/pages/data-center/EquipmentDetailPanel.tsx', 'utf8');

test('equipment pricing deduplicates semantic Budget and Division rows', () => {
  const rows = buildEquipmentCatalogPricingRows({
    budgets: [{ id: 'budget-1', name: '2027 Budget' }],
    budgetDivisions: [{ id: 'division-1', name: 'Hardscaping' }],
    pricingRates: [
      { id: 'legacy-old', budgetId: 'budget-1', category: 'equipment', unitCost: 20, recommendedSellPrice: 40, updatedAt: '2027-01-01T00:00:00Z' },
      { id: 'legacy-new', budgetId: 'budget-1', category: 'equipment', unitCost: 25, recommendedSellPrice: 50, updatedAt: '2027-02-01T00:00:00Z' },
      { id: 'division-unlinked', budgetId: 'budget-1', divisionId: 'division-1', category: 'equipment', unitCost: 30, recommendedSellPrice: 60 },
      { id: 'division-linked', budgetId: 'budget-1', divisionId: 'division-1', equipmentId: 'equipment-1', pricingVersion: 2, category: 'equipment', directCostPerUnit: 35, recommendedSellPrice: 70, customRate: 75 },
    ],
  });

  assert.deepEqual(rows.map((row) => [row.rate.id, row.divisionName, row.cost, row.calculatedRate]), [
    ['legacy-new', '2027 Budget · Legacy / Unassigned', 25, 50],
    ['division-linked', 'Hardscaping', 35, 70],
  ]);
  assert.equal(rows.find((row) => row.rate.id === 'division-linked').customRate, 75);
});

test('legacy equipment sell fields are not presented as explicit custom rates', () => {
  const [row] = buildEquipmentCatalogPricingRows({
    budgets: [{ id: 'budget-1', name: 'Budget' }],
    budgetDivisions: [],
    pricingRates: [{ id: 'legacy', budgetId: 'budget-1', category: 'equipment', recommendedSellPrice: 70, defaultSellPrice: 32.43 }],
  });
  assert.equal(row.customRate, null);
  assert.equal(row.estimateRate, 70);
});

test('equipment catalog is a compact direct-cost resource list', () => {
  assert.match(catalogSource, /<table className="w-full text-sm">/);
  for (const heading of ['Equipment', 'ID / SKU', 'Cost / Hour']) {
    assert.match(catalogSource, new RegExp(`>${heading.replace('/', '\\/')}<`));
  }
  for (const removed of ['>Type<', '>Calculated Rate<', '>Custom Rate<', '>Status<', '>Allocated To<']) assert.doesNotMatch(catalogSource, new RegExp(removed));
  assert.doesNotMatch(catalogSource, /recommendedSellPrice|customRate|division rates/);
  assert.match(catalogSource, /Not calculated/);
});

test('equipment list search does not require Budget, type, or ownership filters', () => {
  assert.match(catalogSource, /placeholder="Search equipment\.\.\."/);
  assert.match(catalogSource, /setEquipmentQuery/);
  assert.doesNotMatch(catalogSource, /setEquipmentTypeFilter|setEquipmentStatusFilter|setEquipmentBudgetFilter/);
});

test('equipment rows open the shared URL-backed DetailWorkspace and show selection state', () => {
  assert.match(catalogSource, /<DetailWorkspace/);
  assert.match(catalogSource, /readDetailWorkspaceQuery/);
  assert.match(catalogSource, /openDetailWorkspace/);
  assert.match(catalogSource, /closeDetailWorkspace/);
  assert.match(catalogSource, /setDetailWorkspaceMode/);
  assert.match(catalogSource, /setDetailWorkspaceTab/);
  assert.match(catalogSource, /workspace\.recordId === asset\.id \? 'bg-brand-50/);
  assert.match(catalogSource, /aria-selected=\{workspace\.recordId === asset\.id\}/);
});

test('equipment detail keeps operational overview and Budget participation', () => {
  assert.match(detailSource, /'overview', label: 'Overview'/);
  assert.match(detailSource, /'budgets', label: 'Budgets'/);
  assert.doesNotMatch(detailSource, /'pricing', label: 'Pricing'/);
  assert.match(detailSource, /<DetailWorkspaceHeader/);
  assert.match(detailSource, /<DetailWorkspaceTabs/);
  assert.match(detailSource, /onExpand=\{onExpand\}/);
  assert.match(detailSource, /onCollapse=\{onCollapse\}/);
  assert.match(detailSource, /onClose=\{onClose\}/);
});

test('operating cost and allocation detail stays inside operational tabs', () => {
  assert.match(detailSource, /Operating Costs/);
  assert.match(detailSource, /Annual Cost Allocation/);
  assert.match(detailSource, /Annual Allocation/);
  assert.doesNotMatch(detailSource, /Overhead Recovery|Breakeven|Calculated Rate|Estimate Rate/);
});