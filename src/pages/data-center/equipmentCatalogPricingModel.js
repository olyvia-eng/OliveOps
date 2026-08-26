const numberOrNull = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const priority = (rate) => (rate.equipmentId ? 4 : 0) + (rate.pricingVersion === 2 ? 2 : 0) + (rate.divisionId ? 1 : 0);

export function buildEquipmentCatalogPricingRows({ pricingRates, budgetDivisions, budgets }) {
  const selected = new Map();
  for (const rate of pricingRates) {
    const key = `${rate.budgetId}:${rate.divisionId || 'legacy'}`;
    const current = selected.get(key);
    const newer = Date.parse(rate.updatedAt || '') > Date.parse(current?.updatedAt || '');
    if (!current || priority(rate) > priority(current) || (priority(rate) === priority(current) && newer)) selected.set(key, rate);
  }

  return [...selected.values()].map((rate) => {
    const division = budgetDivisions.find((item) => item.id === rate.divisionId);
    const budget = budgets.find((item) => item.id === rate.budgetId);
    const cost = numberOrNull(rate.directCostPerUnit) ?? numberOrNull(rate.unitCost);
    const overheadRecovery = numberOrNull(rate.divisionOverheadRecoveryPerUnit) ?? numberOrNull(rate.overheadRecoveryPerUnit);
    const breakeven = numberOrNull(rate.recoveredCostPerUnit) ?? (cost !== null && overheadRecovery !== null ? cost + overheadRecovery : null);
    const calculatedRate = numberOrNull(rate.recommendedSellPrice);
    const customRate = numberOrNull(rate.defaultSellPrice) && rate.defaultSellPrice > 0 ? rate.defaultSellPrice : null;
    return {
      rate,
      divisionName: division?.name ?? `${budget?.name ?? 'Legacy Budget'} · Legacy / Unassigned`,
      cost,
      overheadRecovery,
      breakeven,
      targetMarginPct: numberOrNull(rate.targetMarginPercent),
      profit: calculatedRate !== null && breakeven !== null ? calculatedRate - breakeven : null,
      calculatedRate,
      customRate,
      estimateRate: customRate ?? calculatedRate,
    };
  }).sort((left, right) => left.divisionName.localeCompare(right.divisionName));
}
