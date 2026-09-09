import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEquipmentCatalogPricingRows } from '../src/pages/data-center/equipmentCatalogPricingModel.js';
import { buildEquipmentBudgetRelationshipRows } from '../src/pages/data-center/equipmentBudgetRelationshipModel.js';

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
  for (const heading of ['Equipment', 'ID / SKU', 'Direct Cost']) {
    assert.match(catalogSource, new RegExp(`>${heading.replace('/', '\\/')}<`));
  }
  assert.match(catalogSource, /costUnit/);
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

test('Budget-specific equipment assumptions stay in Budgets instead of the Catalog overview', () => {
  assert.doesNotMatch(detailSource, /<h2[^>]*>Operating Costs<\/h2>|<h2[^>]*>Utilization<\/h2>/);
  assert.match(detailSource, /Annual Equipment Cost/);
  assert.match(detailSource, /Expected Operating Hours/);
  assert.match(detailSource, /Cost per Operating Hour/);
  assert.match(detailSource, /Allocated Annual Cost/);
  assert.doesNotMatch(detailSource, /Overhead Recovery|Breakeven|Calculated Rate|Estimate Rate/);
});

test('Catalog finds exact-linked planning rows across Divisions and keeps annual Budgets distinct', () => {
  const rows = buildEquipmentBudgetRelationshipRows({
    equipmentId: 'equipment-1',
    budgets: [
      { id: 'budget-2026', name: '2026 Annual Budget', fiscalYear: '2026' },
      { id: 'budget-2027', name: '2027 Annual Budget', fiscalYear: '2027' },
    ],
    budgetDivisions: [
      { id: 'land', budgetId: 'budget-2026', name: 'Landscaping' },
      { id: 'snow', budgetId: 'budget-2026', name: 'Snow Removal' },
      { id: 'foreign', budgetId: 'another-budget', name: 'Foreign Division' },
    ],
    planningItems: [
      {
        id: 'plan-2026', budgetId: 'budget-2026', category: 'equipment', equipmentId: 'equipment-1',
        plannedAmount: 35000, sellableHoursPerYear: 1000, equipmentHoursPerDay: 8,
        equipmentDivisionAllocations: [{ divisionId: 'land', months: 8 }, { divisionId: 'snow', months: 4 }],
      },
      { id: 'plan-2027', budgetId: 'budget-2027', category: 'equipment', equipmentId: 'equipment-1', plannedAmount: 42000, equipmentDivisionAllocations: [] },
      { id: 'same-name-other-tenant', budgetId: 'budget-2026', category: 'equipment', equipmentId: 'equipment-2', name: 'Excavator', plannedAmount: 99999 },
      { id: 'cross-budget-division', budgetId: 'budget-2026', category: 'equipment', equipmentId: 'equipment-3', equipmentDivisionAllocations: [{ divisionId: 'foreign', months: 12 }] },
    ],
  });

  assert.deepEqual(rows.map((row) => row.budget?.name), ['2027 Annual Budget', '2026 Annual Budget']);
  assert.deepEqual(rows[1].divisions.map((allocation) => [allocation.division?.name, allocation.months, allocation.annualCost]), [
    ['Landscaping', 8, 35000 * 8 / 12],
    ['Snow Removal', 4, 35000 * 4 / 12],
  ]);
  assert.equal(rows[1].annualHours, 1000);
  assert.equal(rows[1].costPerHour, 35);
  assert.equal(rows[1].operatingDays, 125);
  assert.equal(rows.some((row) => row.id === 'same-name-other-tenant'), false);
});

test('Catalog relationship model preserves correctly-linked legacy Budget allocations without duplicating current rows', () => {
  const input = {
    equipmentId: 'equipment-1',
    budgets: [{ id: 'budget-1', name: 'Annual Budget', fiscalYear: '2026' }],
    budgetDivisions: [],
    planningItems: [{ id: 'current-plan', budgetId: 'budget-1', category: 'equipment', equipmentId: 'equipment-1', plannedAmount: 24000 }],
    budgetItems: [{ id: 'legacy-item', budgetId: 'budget-1', category: 'equipment', equipmentId: 'equipment-1', budgeted: 18000, sellableHoursPerYear: 900 }],
    legacyAllocations: [{ id: 'legacy-allocation', equipmentId: 'equipment-1', budgetId: 'budget-1', budgetItemId: 'legacy-item', monthsAllocated: 12 }],
  };
  const rows = buildEquipmentBudgetRelationshipRows(input);
  assert.deepEqual(rows.map((row) => row.source).sort(), ['legacy', 'planning']);

  const noDuplicate = buildEquipmentBudgetRelationshipRows({
    ...input,
    legacyAllocations: [{ id: 'duplicate-allocation', equipmentId: 'equipment-1', budgetId: 'budget-1', budgetItemId: 'current-plan', monthsAllocated: 12 }],
    budgetItems: [{ id: 'current-plan', budgetId: 'budget-1', category: 'equipment', equipmentId: 'equipment-1', budgeted: 24000 }],
  });
  assert.equal(noDuplicate.length, 1);
});

test('Catalog page builds equipment Budget rows from active planning items by stable equipment ID', () => {
  assert.match(catalogSource, /budgetDivisionPlanningItems/);
  assert.match(catalogSource, /buildEquipmentBudgetRelationshipRows/);
  assert.match(catalogSource, /equipmentId: selectedEquipment\.id/);
});