const CATEGORY_MAP = {
  labour: 'labour',
  equipment: 'equipment',
  materials: 'material',
  subcontractors: 'subcontractor',
};

const positiveNumber = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const sourceEntityId = (item) => {
  if (item.category === 'labour') return item.employeeId;
  if (item.category === 'equipment') return item.equipmentId;
  if (item.category === 'materials') return item.materialCatalogItemId;
  if (item.category === 'subcontractors') return item.vendorId;
  return undefined;
};

const sourceRateMatches = (item, rate) => {
  if (rate.budgetItemId && rate.budgetItemId === item.id) return true;
  if (item.category === 'labour') return Boolean(item.employeeId && rate.employeeId === item.employeeId);
  if (item.category === 'equipment') return Boolean(item.equipmentId && rate.equipmentId === item.equipmentId);
  if (item.category === 'materials') return Boolean(item.materialCatalogItemId && rate.materialCatalogItemId === item.materialCatalogItemId);
  if (item.category === 'subcontractors') return Boolean(item.vendorId && rate.vendorId === item.vendorId);
  return false;
};

const displayName = (item, entities) => {
  if (item.category === 'labour' && item.employeeId) return entities.employees.get(item.employeeId)?.name ?? item.name ?? item.description;
  if (item.category === 'equipment' && item.equipmentId) return entities.equipment.get(item.equipmentId)?.name ?? item.name ?? item.description;
  if (item.category === 'materials' && item.materialCatalogItemId) return entities.materials.get(item.materialCatalogItemId)?.name ?? item.name ?? item.description;
  return item.name ?? item.description;
};

const dedupeKey = (item) => {
  const sourceId = sourceEntityId(item);
  return sourceId ? `${item.category}:${sourceId}` : `${item.category}:budget-item:${item.id}`;
};

const itemDivisionIds = (item) => {
  if (item.category === 'labour' && Array.isArray(item.divisionAllocations)) return item.divisionAllocations.filter((allocation) => Number(allocation.hours ?? allocation.percentage ?? 0) > 0).map((allocation) => allocation.divisionId);
  if (item.category === 'equipment' && Array.isArray(item.equipmentDivisionAllocations)) return item.equipmentDivisionAllocations.filter((allocation) => Number(allocation.months ?? 0) > 0).map((allocation) => allocation.divisionId);
  return item.divisionId ? [item.divisionId] : [];
};

export function buildEstimatePricingCatalog({ budgetId, divisionId, includeAllDivisions = false, planningItems, budgetRates, employees = [], equipmentAssets = [], materialCatalogItems = [] }) {
  const entities = {
    employees: new Map(employees.map((item) => [item.id, item])),
    equipment: new Map(equipmentAssets.map((item) => [item.id, item])),
    materials: new Map(materialCatalogItems.map((item) => [item.id, item])),
  };
  const rates = budgetRates.filter((rate) => rate.budgetId === budgetId && rate.active !== false);
  const uniqueItems = new Map();

  for (const item of planningItems) {
    if (item.budgetId !== budgetId || !CATEGORY_MAP[item.category]) continue;
    const divisionIds = itemDivisionIds(item);
    if (!divisionId && !includeAllDivisions) {
      const key = dedupeKey(item);
      if (!uniqueItems.has(key)) uniqueItems.set(key, { item, divisionId: undefined });
      continue;
    }
    if (includeAllDivisions) {
      const legacyKey = `legacy:${dedupeKey(item)}`;
      if (!uniqueItems.has(legacyKey)) uniqueItems.set(legacyKey, { item, divisionId: undefined });
    }
    for (const itemDivisionId of divisionIds) {
      if (divisionId && itemDivisionId !== divisionId) continue;
      const key = `${itemDivisionId}:${dedupeKey(item)}`;
      if (!uniqueItems.has(key)) uniqueItems.set(key, { item, divisionId: itemDivisionId });
    }
  }

  const catalog = { labour: [], equipment: [], materials: [], subcontractors: [] };
  for (const { item, divisionId: itemDivisionId } of uniqueItems.values()) {
    const type = CATEGORY_MAP[item.category];
    const matchingRate = rates.find((rate) => rate.pricingVersion === 2 && rate.divisionId === itemDivisionId && rate.category === type && sourceRateMatches(item, rate))
      ?? rates.find((rate) => rate.pricingVersion !== 2 && !rate.divisionId && rate.category === type && sourceRateMatches(item, rate));
    const approvedRate = matchingRate ? positiveNumber(matchingRate.defaultSellPrice) : positiveNumber(item.approvedRate);
    const recommendedRate = matchingRate ? positiveNumber(matchingRate.recommendedSellPrice) : positiveNumber(item.recommendedRate);
    const costRate = matchingRate ? positiveNumber(matchingRate.unitCost) : positiveNumber(item.costRate);
    const pricingStatus = approvedRate ? 'approved' : recommendedRate ? 'recommended_not_approved' : 'unavailable';
    const sourceId = sourceEntityId(item);

    catalog[item.category].push({
      type,
      sourceEntityId: sourceId,
      budgetItemId: item.id,
      sourceRateId: matchingRate?.id,
      pricingRateUpdatedAt: matchingRate?.updatedAt,
      pricingVersion: matchingRate?.pricingVersion,
      divisionId: itemDivisionId,
      directCostPerUnit: matchingRate?.directCostPerUnit ?? costRate,
      divisionOverheadRecoveryPerUnit: matchingRate?.divisionOverheadRecoveryPerUnit ?? null,
      companyOverheadRecoveryPerUnit: matchingRate?.companyOverheadRecoveryPerUnit ?? null,
      recoveredCostPerUnit: matchingRate?.recoveredCostPerUnit ?? null,
      targetMarginPct: matchingRate?.targetMarginPercent ?? null,
      name: displayName(item, entities) || 'Unnamed item',
      description: item.description ?? '',
      costCode: item.costCode,
      unit: matchingRate?.unit || item.unit || (type === 'labour' || type === 'equipment' ? 'hr' : 'unit'),
      classification: item.labourClassification ?? item.classification,
      costRate,
      recommendedRate,
      approvedRate,
      pricingStatus,
    });
  }

  const aggregateLabourRates = rates.filter((rate) => rate.category === 'labour'
    && rate.pricingVersion === 2
    && typeof rate.divisionId === 'string'
    && rate.budgetItemId === `average-labour:${rate.divisionId}`
    && (!divisionId || rate.divisionId === divisionId));
  for (const rate of aggregateLabourRates) {
    if (catalog.labour.some((item) => item.budgetItemId === rate.budgetItemId && item.divisionId === rate.divisionId)) continue;
    const approvedRate = positiveNumber(rate.defaultSellPrice);
    const recommendedRate = positiveNumber(rate.recommendedSellPrice);
    catalog.labour.push({
      type: 'labour',
      sourceEntityId: undefined,
      budgetItemId: rate.budgetItemId,
      sourceRateId: rate.id,
      pricingRateUpdatedAt: rate.updatedAt,
      pricingVersion: rate.pricingVersion,
      divisionId: rate.divisionId,
      directCostPerUnit: rate.directCostPerUnit ?? positiveNumber(rate.unitCost),
      divisionOverheadRecoveryPerUnit: rate.divisionOverheadRecoveryPerUnit ?? null,
      companyOverheadRecoveryPerUnit: rate.companyOverheadRecoveryPerUnit ?? null,
      recoveredCostPerUnit: rate.recoveredCostPerUnit ?? null,
      targetMarginPct: rate.targetMarginPercent ?? null,
      name: 'Average Labour',
      description: rate.description ?? '',
      unit: rate.unit || 'hr',
      classification: 'billable',
      costRate: positiveNumber(rate.unitCost),
      recommendedRate,
      approvedRate,
      pricingStatus: approvedRate ? 'approved' : recommendedRate ? 'recommended_not_approved' : 'unavailable',
    });
  }

  for (const values of Object.values(catalog)) values.sort((left, right) => left.name.localeCompare(right.name));
  return { budgetId, ...catalog };
}

const catalogItems = (catalog) => [catalog.labour, catalog.equipment, catalog.materials, catalog.subcontractors].flat();
const estimateLineItems = (estimate) => [
  ...(Array.isArray(estimate.lineItems) ? estimate.lineItems : []),
  ...(Array.isArray(estimate.workAreas) ? estimate.workAreas.flatMap((area) => Array.isArray(area?.lineItems) ? area.lineItems : []) : []),
];

export function applyAuthoritativeEstimatePricing({ existingEstimate, nextEstimate, catalog }) {
  const existingById = new Map(estimateLineItems(existingEstimate).map((item) => [item.id, item]));
  const pricingByBudgetItemId = new Map(catalogItems(catalog).map((item) => [`${item.divisionId ?? ''}:${item.budgetItemId}`, item]));

  const apply = (item) => {
    if (!item?.sourceBudgetItemId) return { ok: true, item };
    const existing = existingById.get(item.id);
    if (existing?.sourceBudgetItemId === item.sourceBudgetItemId) return { ok: true, item };
    if (item.sourceBudgetId !== catalog.budgetId || nextEstimate.pricingBudgetId !== catalog.budgetId) {
      return { ok: false, error: 'Estimate pricing must come from its selected Pricing Budget.' };
    }
    const pricing = pricingByBudgetItemId.get(`${item.divisionId ?? ''}:${item.sourceBudgetItemId}`)
      ?? pricingByBudgetItemId.get(`:${item.sourceBudgetItemId}`);
    if (!pricing || pricing.pricingStatus !== 'approved' || !(pricing.approvedRate > 0)) {
      return { ok: false, error: 'The selected Budget item does not have approved pricing.' };
    }
    if (item.sourceEntityId && item.sourceEntityId !== pricing.sourceEntityId) {
      return { ok: false, error: 'Estimate pricing source identity is invalid.' };
    }
    const unitCost = Math.max(0, pricing.costRate ?? 0);
    const sellPrice = pricing.approvedRate;
    const quantity = Math.max(0, Number(item.quantity ?? 0));
    const markupPercent = unitCost > 0 ? Math.max(0, ((sellPrice / unitCost) - 1) * 100) : 0;
    return { ok: true, item: {
      ...item,
      category: pricing.type,
      sourceBudgetId: catalog.budgetId,
      sourceBudgetItemId: pricing.budgetItemId,
      sourceEntityId: pricing.sourceEntityId,
      sourceRateId: pricing.sourceRateId,
      pricingRateUpdatedAt: pricing.pricingRateUpdatedAt,
      pricingVersion: pricing.pricingVersion,
      divisionId: pricing.divisionId,
      directCostPerUnit: pricing.directCostPerUnit ?? unitCost,
      divisionOverheadRecoveryPerUnit: pricing.divisionOverheadRecoveryPerUnit ?? undefined,
      companyOverheadRecoveryPerUnit: pricing.companyOverheadRecoveryPerUnit ?? undefined,
      recoveredCostPerUnit: pricing.recoveredCostPerUnit ?? undefined,
      targetMarginPct: pricing.targetMarginPct ?? undefined,
      recommendedRateAtEstimate: pricing.recommendedRate ?? undefined,
      equipmentId: pricing.type === 'equipment' ? pricing.sourceEntityId : undefined,
      equipmentName: pricing.type === 'equipment' ? pricing.name : undefined,
      itemName: pricing.name,
      unit: pricing.unit,
      unitCost,
      sellPrice,
      markupPercent,
      markup: markupPercent,
      total: quantity * sellPrice,
      ...(pricing.type === 'equipment' ? {
        costRateAtEstimate: unitCost,
        chargeOutRateAtEstimate: sellPrice,
        estimatedCost: quantity * unitCost,
        estimatedSell: quantity * sellPrice,
      } : {}),
    } };
  };

  let error = null;
  const mapItems = (items) => items.map((item) => {
    const result = apply(item);
    if (!result.ok) error = result.error;
    return result.item ?? item;
  });
  const estimate = {
    ...nextEstimate,
    lineItems: Array.isArray(nextEstimate.lineItems) ? mapItems(nextEstimate.lineItems) : nextEstimate.lineItems,
    workAreas: Array.isArray(nextEstimate.workAreas) ? nextEstimate.workAreas.map((area) => (
      area && typeof area === 'object' && Array.isArray(area.lineItems) ? { ...area, lineItems: mapItems(area.lineItems) } : area
    )) : nextEstimate.workAreas,
  };
  return error ? { ok: false, error } : { ok: true, estimate };
}
