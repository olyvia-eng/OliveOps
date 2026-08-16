import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const detailSource = readFileSync('src/pages/data-center/EquipmentDetailPanel.tsx', 'utf8');

test('equipment catalog uses a compact table instead of large equipment cards', () => {
  assert.match(catalogSource, /<table className="w-full min-w-\[940px\] text-sm">/);
  for (const heading of ['Equipment', 'ID / SKU', 'Type', 'Cost / Hour', 'Charge-Out Rate', 'Status', 'Allocated To']) {
    assert.match(catalogSource, new RegExp(`>${heading.replace('/', '\\/')}<`));
  }
  assert.doesNotMatch(catalogSource, /Recommended Rate/);
  assert.doesNotMatch(catalogSource, /Approved Charge-Out Rate/);
  assert.doesNotMatch(catalogSource, /const totalMonths|const totalCost|of 12 months/);
  assert.match(catalogSource, /Not calculated/);
  assert.match(catalogSource, /Not approved/);
});

test('equipment list has persistent search, type, ownership, and budget filters', () => {
  assert.match(catalogSource, /placeholder="Search equipment\.\.\."/);
  assert.match(catalogSource, /aria-label="Filter by equipment type"/);
  assert.match(catalogSource, /aria-label="Filter by ownership status"/);
  assert.match(catalogSource, /aria-label="Filter by budget"/);
  assert.match(catalogSource, /setEquipmentQuery/);
  assert.match(catalogSource, /setEquipmentTypeFilter/);
  assert.match(catalogSource, /setEquipmentStatusFilter/);
  assert.match(catalogSource, /setEquipmentBudgetFilter/);
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

test('equipment detail workspace provides overview, pricing, and budgets tabs', () => {
  assert.match(detailSource, /'overview', label: 'Overview'/);
  assert.match(detailSource, /'pricing', label: 'Pricing'/);
  assert.match(detailSource, /'budgets', label: 'Budgets'/);
  assert.match(detailSource, /<DetailWorkspaceHeader/);
  assert.match(detailSource, /<DetailWorkspaceTabs/);
  assert.match(detailSource, /onExpand=\{onExpand\}/);
  assert.match(detailSource, /onCollapse=\{onCollapse\}/);
  assert.match(detailSource, /onClose=\{onClose\}/);
});

test('allocation and pricing detail stays inside workspace tabs', () => {
  assert.match(detailSource, /Direct Cost \/ Hour/);
  assert.match(detailSource, /Overhead Recovery/);
  assert.match(detailSource, /Fully Burdened Cost/);
  assert.match(detailSource, /Target Margin/);
  assert.match(detailSource, /Recommended Charge-Out/);
  assert.match(detailSource, /Approved Charge-Out/);
  assert.match(detailSource, /Annual Cost Allocation/);
  assert.match(detailSource, /Annual Allocation/);
  assert.match(detailSource, /Recommended pricing has not been calculated yet/);
});