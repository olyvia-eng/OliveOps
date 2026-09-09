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

export function reorderEstimateLineItemsWithinCategory(lineItems, category, orderedIds) {
  const categoryItems = lineItems.filter((item) => item.category === category);
  const categoryIds = new Set(categoryItems.map((item) => item.id));
  if (orderedIds.length !== categoryItems.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !categoryIds.has(id))) {
    return { ok: false, lineItems };
  }

  const itemsById = new Map(categoryItems.map((item) => [item.id, item]));
  const reordered = orderedIds.map((id, sortOrder) => ({ ...itemsById.get(id), sortOrder }));
  let categoryIndex = 0;
  return {
    ok: true,
    lineItems: lineItems.map((item) => item.category === category ? reordered[categoryIndex++] : item),
  };
}

export function applyEstimateLineItemCostOverride(item, value) {
  if (item.category === 'labour') {
    return { ok: false, lineItem: item, error: 'Labour cost is calculated from the pricing snapshot.' };
  }
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, lineItem: item, error: 'Cost must be a number greater than or equal to zero.' };
  }

  const sourceCost = item.sourceUnitCostAtEstimate ?? item.unitCost;
  const overheadRecovery = item.divisionOverheadRecoveryPerUnit !== undefined || item.companyOverheadRecoveryPerUnit !== undefined
    ? Math.max(0, finiteNumber(item.divisionOverheadRecoveryPerUnit)) + Math.max(0, finiteNumber(item.companyOverheadRecoveryPerUnit))
    : Math.max(0, finiteNumber(item.recoveredCostPerUnit ?? item.breakevenRate, item.unitCost) - item.unitCost);
  const breakeven = value + overheadRecovery;
  const hasMarginSnapshot = item.estimateTargetMarginPct != null || item.targetMarginPct != null;
  const targetMarginPct = item.estimateTargetMarginPct ?? item.targetMarginPct ?? 0;
  const customSellPrice = item.estimateCustomSellPrice ?? (hasMarginSnapshot ? null : item.sellPrice);
  const pricing = calculateEstimateSnapshotPricing({ breakeven, targetMarginPct, customSellPrice });
  const quantity = Math.max(0, finiteNumber(item.quantity));
  const lineItem = {
    ...item,
    unitCost: value,
    sourceUnitCostAtEstimate: sourceCost,
    estimateUnitCostOverride: value,
    directCostPerUnit: value,
    recoveredCostPerUnit: breakeven,
    calculatedRateAtEstimate: pricing.calculatedSellPrice,
    estimateRateAtEstimate: pricing.sellPrice,
    estimateCustomSellPrice: pricing.customSellPrice,
    sellPrice: pricing.sellPrice,
    total: quantity * pricing.sellPrice,
  };
  if (item.category === 'equipment') {
    Object.assign(lineItem, {
      costRateAtEstimate: value,
      chargeOutRateAtEstimate: pricing.sellPrice,
      estimatedCost: quantity * value,
      estimatedSell: quantity * pricing.sellPrice,
    });
  }
  return { ok: true, lineItem };
}