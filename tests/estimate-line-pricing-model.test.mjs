import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateEstimateSnapshotPricing, estimateLineEffectiveQuantity, estimateLineWorkers } from '../src/utils/estimatePricingModel.js';
import { applyEstimateLineItemCostOverride, reorderEstimateLineItemsWithinCategory } from '../src/utils/estimatePricingModel.js';

test('Estimate snapshot pricing uses gross margin and guards the divisor', () => {
  assert.deepEqual(calculateEstimateSnapshotPricing({ breakeven: 80, targetMarginPct: 20 }), {
    breakeven: 80, targetMarginPct: 20, calculatedSellPrice: 100, customSellPrice: null, sellPrice: 100, effectiveMarginPct: 20,
  });
  const guarded = calculateEstimateSnapshotPricing({ breakeven: 10, targetMarginPct: 100 });
  assert.equal(guarded.targetMarginPct, 99);
  assert.ok(Number.isFinite(guarded.sellPrice));
});

test('custom Estimate sell price is authoritative and reset restores calculated pricing', () => {
  const custom = calculateEstimateSnapshotPricing({ breakeven: 80, targetMarginPct: 20, customSellPrice: 120 });
  assert.equal(custom.sellPrice, 120);
  assert.ok(Math.abs(custom.effectiveMarginPct - 33.3333333333) < 0.000001);
  const reset = calculateEstimateSnapshotPricing({ breakeven: 80, targetMarginPct: 20, customSellPrice: null });
  assert.equal(reset.sellPrice, 100);
  assert.equal(reset.customSellPrice, null);
});

const line = (id, category, sortOrder, overrides = {}) => ({
  id, category, sortOrder, itemName: id, description: '', quantity: 2, unit: 'unit', unitCost: 40,
  sourceUnitCostAtEstimate: 40, directCostPerUnit: 40, divisionOverheadRecoveryPerUnit: 10,
  companyOverheadRecoveryPerUnit: 5, recoveredCostPerUnit: 55, targetMarginPct: 20,
  estimateTargetMarginPct: 25, sellPrice: 73.3333333333, total: 146.6666666666, markupPercent: 0,
  ...overrides,
});

test('line items reorder only inside their category and persist stable sortOrder', () => {
  for (const category of ['labour', 'equipment', 'material', 'subcontractor']) {
    const original = [line(`${category}-a`, category, 0), line('other-a', category === 'labour' ? 'equipment' : 'labour', 0), line(`${category}-b`, category, 1)];
    const reordered = reorderEstimateLineItemsWithinCategory(original, category, [`${category}-b`, `${category}-a`]);
    assert.equal(reordered.ok, true);
    assert.deepEqual(reordered.lineItems.map((item) => item.id), [`${category}-b`, 'other-a', `${category}-a`]);
    assert.deepEqual(reordered.lineItems.filter((item) => item.category === category).map((item) => item.sortOrder), [0, 1]);
  }
  const original = [line('labour-a', 'labour', 0), line('equipment-a', 'equipment', 0)];
  const crossCategory = reorderEstimateLineItemsWithinCategory(original, 'labour', ['equipment-a', 'labour-a']);
  assert.equal(crossCategory.ok, false);
  assert.strictEqual(crossCategory.lineItems, original);
});

test('legacy line item order is preserved and receives category-local fallback order', () => {
  const source = readFileSync('src/utils/estimateModel.ts', 'utf8');
  assert.match(source, /const categoryIndexes: Record<LineItemCategory, number>/);
  assert.match(source, /normalizeEstimateLineItem\(item, categoryIndexes\[category\]\)/);
  assert.doesNotMatch(source, /area\.lineItems\.sort/);
});

test('Equipment, Material, and Subcontractor cost overrides recalculate canonical snapshot pricing', () => {
  for (const category of ['equipment', 'material', 'subcontractor']) {
    const source = line(`${category}-a`, category, 0);
    const result = applyEstimateLineItemCostOverride(source, 60);
    assert.equal(result.ok, true);
    assert.equal(result.lineItem.sourceUnitCostAtEstimate, 40);
    assert.equal(result.lineItem.estimateUnitCostOverride, 60);
    assert.equal(result.lineItem.unitCost, 60);
    assert.equal(result.lineItem.recoveredCostPerUnit, 75);
    assert.equal(result.lineItem.calculatedRateAtEstimate, 100);
    assert.equal(result.lineItem.sellPrice, 100);
    assert.equal(result.lineItem.total, 200);
    assert.equal(source.unitCost, 40, 'source snapshot must not be mutated');
  }
});

test('cost override preserves custom price mode and rejects Labour, negative, NaN, and Infinity', () => {
  const custom = applyEstimateLineItemCostOverride(line('material-a', 'material', 0, { estimateCustomSellPrice: 125 }), 60);
  assert.equal(custom.lineItem.sellPrice, 125);
  assert.equal(custom.lineItem.recoveredCostPerUnit, 75);
  const customItem = applyEstimateLineItemCostOverride(line('custom-material', 'material', 0, {
    recoveredCostPerUnit: undefined,
    targetMarginPct: undefined,
    estimateTargetMarginPct: undefined,
    estimateCustomSellPrice: undefined,
    sellPrice: 90,
  }), 60);
  assert.equal(customItem.lineItem.sellPrice, 90);
  assert.equal(customItem.lineItem.estimateCustomSellPrice, 90);
  assert.equal(applyEstimateLineItemCostOverride(line('labour-a', 'labour', 0), 60).ok, false);
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const source = line('material-a', 'material', 0);
    const result = applyEstimateLineItemCostOverride(source, invalid);
    assert.equal(result.ok, false);
    assert.strictEqual(result.lineItem, source);
  }
});

test('Labour effective quantity is worker-hours with a legacy one-worker default', () => {
  assert.equal(estimateLineWorkers({ category: 'labour', quantity: 40 }), 1);
  assert.equal(estimateLineEffectiveQuantity({ category: 'labour', quantity: 40 }), 40);
  assert.equal(estimateLineEffectiveQuantity({ category: 'labour', workers: 2, quantity: 40 }), 80);
  assert.equal(estimateLineEffectiveQuantity({ category: 'material', workers: 8, quantity: 40 }), 40);
});