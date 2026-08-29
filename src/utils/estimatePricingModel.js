const finiteNumber = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function calculateEstimateSnapshotPricing(input) {
  const breakeven = Math.max(0, finiteNumber(input.breakeven));
  const targetMarginPct = Math.min(99, Math.max(0, finiteNumber(input.targetMarginPct)));
  const calculatedSellPrice = breakeven > 0 ? breakeven / (1 - targetMarginPct / 100) : 0;
  const customSellPrice = input.customSellPrice == null ? null : Math.max(0, finiteNumber(input.customSellPrice));
  const sellPrice = customSellPrice ?? calculatedSellPrice;
  const effectiveMarginPct = sellPrice > 0 ? ((sellPrice - breakeven) / sellPrice) * 100 : 0;
  return { breakeven, targetMarginPct, calculatedSellPrice, customSellPrice, sellPrice, effectiveMarginPct };
}