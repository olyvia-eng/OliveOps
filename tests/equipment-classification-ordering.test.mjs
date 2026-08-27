import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isCompleteEquipmentOrder } from '../api/_lib/authRepo.js';
import { buildCombinedBudgetViewModel } from '../src/pages/budget/combinedBudgetModel.js';

test('equipment order accepts only the complete budget-specific row set', () => {
  assert.equal(isCompleteEquipmentOrder(['a', 'b', 'c'], ['c', 'a', 'b']), true);
  assert.equal(isCompleteEquipmentOrder(['a', 'b', 'c'], ['a', 'b']), false);
  assert.equal(isCompleteEquipmentOrder(['a', 'b'], ['a', 'a']), false);
  assert.equal(isCompleteEquipmentOrder(['a', 'b'], ['a', 'other']), false);
});

test('equipment ordering is owner/admin-only and uses one atomic transaction', () => {
  const endpointSource = readFileSync('api/budget-equipment-order.js', 'utf8');
  const repoSource = readFileSync('api/_lib/authRepo.js', 'utf8');
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.match(endpointSource, /requireSession\(req, res, \['owner', 'admin'\]\)/);
  assert.match(repoSource, /new TransactWriteCommand/);
  assert.match(repoSource, /Equipment order must include every equipment row in this budget exactly once/);
  assert.match(budgetSource, /onKeyDown/);
  assert.match(budgetSource, /event\.key === 'ArrowUp' \|\| event\.key === 'ArrowDown'/);
  assert.match(budgetSource, /draggable/);
});

test('overhead equipment moves from direct equipment totals into overhead once', () => {
  const result = buildCombinedBudgetViewModel({
    budgetIds: ['a', 'b'],
    budgets: [
      { id: 'a', name: 'A', division: 'company_wide', fiscalYear: '2026', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'B', division: 'snow', fiscalYear: '2026', createdAt: '2026-01-02T00:00:00.000Z' },
    ],
    budgetItems: [
      { id: 'billable', budgetId: 'a', category: 'equipment', equipmentClassification: 'billable', description: 'Loader', budgeted: 12000, actual: 1000, period: '2026-01' },
      { id: 'overhead', budgetId: 'a', category: 'equipment', equipmentClassification: 'overhead', description: 'Shop Truck', budgeted: 6000, actual: 500, period: '2026-01' },
    ],
    employees: [],
    labourBudgetPlans: [],
    revenueSalesGoals: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.totalsByCategory.equipment.budgeted, 12000);
  assert.equal(result.totalsByCategory.overhead.budgeted, 6000);
  assert.equal(result.grouped.equipment.length, 2);
  assert.equal(result.categoryRows.find((row) => row.category === 'equipment').budgeted, 12000);
  assert.equal(result.categoryRows.find((row) => row.category === 'overhead').budgeted, 6000);
  assert.equal(result.combinedExpenseBudgeted, 18000);
});

test('overhead equipment has no charge-out workflow or new Estimate candidate', () => {
  const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
  const detailSource = readFileSync('src/pages/data-center/EquipmentDetailPanel.tsx', 'utf8');
  const estimateSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
  const estimateCatalogSource = readFileSync('api/_lib/estimatePricingCatalog.js', 'utf8');

  assert.match(budgetSource, /filter\(\(item\) => item\.equipmentClassification !== 'overhead'\)/);
  assert.match(detailSource, /Overhead Equipment/);
  assert.doesNotMatch(detailSource, /'pricing', label: 'Pricing'|Charge-out pricing/);
  assert.match(estimateSource, /if \(asset\.equipmentClassification === 'overhead'\) continue/);
  assert.match(estimateCatalogSource, /isOverheadEquipment\(item, entities\.equipment\)/);
  assert.match(estimateSource, /visibleCatalogCandidates = useMemo/);
  assert.match(estimateSource, /Custom \{CATEGORY_ADD_LABEL\[catalogCategory\]\}/);
});
