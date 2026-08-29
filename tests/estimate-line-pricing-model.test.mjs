import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEstimateSnapshotPricing } from '../src/utils/estimatePricingModel.js';

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