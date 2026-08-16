import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEquipmentAllocationGroups,
  calculateAllocatedEquipmentCost,
  calculateEquipmentAllocationSummary,
  calculateGroupedEquipmentAllocationDraft,
  normalizeAllocatedMonths,
} from '../src/utils/equipmentAllocation.js';

const allocation = (id, groupId, budgetId, monthsAllocated) => ({
  id,
  equipmentId: 'equipment-1',
  budgetGroupId: groupId,
  budgetId,
  budgetItemId: `item-${id}`,
  monthsAllocated,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('fractional months calculate live allocated equipment cost', () => {
  assert.equal(normalizeAllocatedMonths(2.5), 2.5);
  assert.equal(calculateAllocatedEquipmentCost(60_000, 4), 20_000);
  assert.equal(calculateAllocatedEquipmentCost(60_000, 2.5), 12_500);
});

test('remaining and suggested months exclude the allocation being edited', () => {
  const allocations = [
    allocation('snow', 'group-2026', 'snow', 4),
    allocation('landscaping', 'group-2026', 'landscaping', 6),
  ];
  const summary = calculateEquipmentAllocationSummary({
    allocations,
    budgetGroupId: 'group-2026',
    equipmentId: 'equipment-1',
    annualCost: 60_000,
    excludeAllocationId: 'landscaping',
  });
  assert.equal(summary.totalMonthsAllocated, 4);
  assert.equal(summary.remainingMonths, 8);
  assert.equal(summary.suggestedMonths, 8);
  assert.equal(summary.unallocatedCost, 40_000);
});

test('over-allocation is warned but remains calculable', () => {
  const summary = calculateEquipmentAllocationSummary({
    allocations: [
      allocation('snow', 'group-2026', 'snow', 8),
      allocation('landscaping', 'group-2026', 'landscaping', 6),
    ],
    budgetGroupId: 'group-2026',
    equipmentId: 'equipment-1',
    annualCost: 60_000,
  });
  assert.equal(summary.totalMonthsAllocated, 14);
  assert.equal(summary.overAllocatedMonths, 2);
  assert.equal(summary.isOverAllocated, true);
  assert.equal(summary.remainingMonths, 0);
});

test('allocations never leak across groups or years', () => {
  const allocations = [
    allocation('snow-2026', 'group-2026', 'snow', 4),
    allocation('snow-2027', 'group-2027', 'snow-next', 9),
  ];
  const summary = calculateEquipmentAllocationSummary({
    allocations,
    budgetGroupId: 'group-2026',
    equipmentId: 'equipment-1',
    annualCost: 60_000,
  });
  assert.equal(summary.totalMonthsAllocated, 4);
  assert.equal(summary.remainingMonths, 8);
});

test('catalog summaries remain separated by Budget Group', () => {
  const groups = buildEquipmentAllocationGroups({
    allocations: [
      allocation('snow-2026', 'group-2026', 'snow', 4),
      allocation('snow-2027', 'group-2027', 'snow-next', 9),
    ],
    budgetGroups: [
      { id: 'group-2026', name: '2026', year: '2026', budgetIds: ['snow'], createdAt: '', updatedAt: '' },
      { id: 'group-2027', name: '2027', year: '2027', budgetIds: ['snow-next'], createdAt: '', updatedAt: '' },
    ],
    budgets: [
      { id: 'snow', name: 'Snow', fiscalYear: '2026' },
      { id: 'snow-next', name: 'Snow', fiscalYear: '2027' },
    ],
    equipmentId: 'equipment-1',
    annualCost: 60_000,
  });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].totalMonthsAllocated, 4);
  assert.equal(groups[1].totalMonthsAllocated, 9);
});

test('annual equipment cost responsibility is always allocated over twelve months', () => {
  assert.equal(calculateAllocatedEquipmentCost(24_000, 7), 14_000);
  assert.equal(calculateAllocatedEquipmentCost(24_000, 5), 10_000);
  assert.equal(
    calculateAllocatedEquipmentCost(24_000, 7) + calculateAllocatedEquipmentCost(24_000, 5),
    24_000,
  );
});

test('grouped allocation drafts recalculate rows, totals, and remaining months live', () => {
  const summary = calculateGroupedEquipmentAllocationDraft(68_940, [
    { budgetItemId: 'snow', monthsAllocated: 5 },
    { budgetItemId: 'landscaping', monthsAllocated: 7 },
  ]);
  assert.equal(summary.rows[0].allocatedCost, 28_725);
  assert.equal(summary.rows[1].allocatedCost, 40_215);
  assert.equal(summary.totalMonthsAllocated, 12);
  assert.equal(summary.remainingMonths, 0);
  assert.equal(summary.overAllocatedMonths, 0);
  assert.equal(summary.totalAllocatedCost, 68_940);
});

test('grouped allocation drafts expose incomplete and over-allocated states without normalization', () => {
  const incomplete = calculateGroupedEquipmentAllocationDraft(60_000, [
    { budgetItemId: 'snow', monthsAllocated: 4 },
    { budgetItemId: 'landscaping', monthsAllocated: 5 },
  ]);
  assert.equal(incomplete.totalMonthsAllocated, 9);
  assert.equal(incomplete.remainingMonths, 3);
  assert.equal(incomplete.totalAllocatedCost, 45_000);

  const over = calculateGroupedEquipmentAllocationDraft(60_000, [
    { budgetItemId: 'snow', monthsAllocated: 7 },
    { budgetItemId: 'landscaping', monthsAllocated: 7 },
  ]);
  assert.equal(over.totalMonthsAllocated, 14);
  assert.equal(over.overAllocatedMonths, 2);
  assert.equal(over.totalAllocatedCost, 70_000);
});