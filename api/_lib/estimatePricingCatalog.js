import { buildBudgetPricingRows } from '../../src/pages/budget/budgetPricingModel.js';

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

export function buildEstimatePricingCatalog({ budget, budgetId = budget?.id, divisions, divisionId, includeAllDivisions = false, planningItems, budgetRates, employees = [], equipmentAssets = [], materialCatalogItems = [] }) {
  const entities = {
    employees: new Map(employees.map((item) => [item.id, item])),
    equipment: new Map(equipmentAssets.map((item) => [item.id, item])),
    materials: new Map(materialCatalogItems.map((item) => [item.id, item])),
  };
  const rates = budgetRates.filter((rate) => rate.budgetId === budgetId && rate.active !== false);
  const calculatedRows = budget?.planningModel === 'divisions_v1' && Array.isArray(divisions)
    ? buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates, employees })
    : [];
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
    const calculatedRow = itemDivisionId ? calculatedRows.find((row) => row.divisionId === itemDivisionId
      && row.type === type
      && (item.category === 'labour' ? row.aggregateLabour : row.item.id === item.id)) : undefined;
    const matchingRate = calculatedRow?.rate
      ?? rates.find((rate) => rate.pricingVersion === 2 && rate.divisionId === itemDivisionId && rate.category === type && sourceRateMatches(item, rate))
      ?? rates.find((rate) => rate.pricingVersion !== 2 && !rate.divisionId && rate.category === type && sourceRateMatches(item, rate));
    const usesCalculatedPricing = Boolean(calculatedRow);
    const recommendedRate = usesCalculatedPricing ? positiveNumber(calculatedRow.calculatedRate) : matchingRate ? positiveNumber(matchingRate.recommendedSellPrice) : positiveNumber(item.recommendedRate);
    const approvedRate = usesCalculatedPricing ? null : matchingRate ? positiveNumber(matchingRate.defaultSellPrice) : positiveNumber(item.approvedRate);
    const sellRate = usesCalculatedPricing ? recommendedRate : approvedRate;
    const costRate = usesCalculatedPricing ? positiveNumber(calculatedRow.costRate) : matchingRate ? positiveNumber(matchingRate.unitCost) : positiveNumber(item.costRate);
    const pricingAvailable = usesCalculatedPricing ? calculatedRow.pricingAvailable : Boolean(sellRate);
    const pricingStatus = usesCalculatedPricing ? pricingAvailable ? 'calculated' : 'unavailable' : approvedRate ? 'approved' : recommendedRate ? 'recommended_not_approved' : 'unavailable';
    const sourceId = sourceEntityId(item);

    catalog[item.category].push({
      type,
      sourceEntityId: sourceId,
      budgetItemId: item.id,
      sourceRateId: usesCalculatedPricing ? undefined : matchingRate?.id,
      pricingRateUpdatedAt: usesCalculatedPricing ? budget.updatedAt : matchingRate?.updatedAt,
      pricingVersion: usesCalculatedPricing ? 2 : matchingRate?.pricingVersion,
      divisionId: itemDivisionId,
      directCostPerUnit: usesCalculatedPricing ? calculatedRow.costRate : matchingRate?.directCostPerUnit ?? costRate,
      divisionOverheadRecoveryPerUnit: usesCalculatedPricing ? calculatedRow.divisionOverheadPerUnit : matchingRate?.divisionOverheadRecoveryPerUnit ?? null,
      companyOverheadRecoveryPerUnit: usesCalculatedPricing ? 0 : matchingRate?.companyOverheadRecoveryPerUnit ?? null,
      recoveredCostPerUnit: usesCalculatedPricing ? calculatedRow.recoveredCostPerUnit : matchingRate?.recoveredCostPerUnit ?? null,
      targetMarginPct: usesCalculatedPricing ? calculatedRow.targetMarginPct : matchingRate?.targetMarginPercent ?? null,
      name: displayName(item, entities) || 'Unnamed item',
      description: item.description ?? '',
      costCode: item.costCode,
      unit: matchingRate?.unit || item.unit || (type === 'labour' || type === 'equipment' ? 'hr' : 'unit'),
      classification: item.labourClassification ?? item.classification,
      costRate,
      recommendedRate,
      approvedRate,
      sellRate,
      pricingAvailable,
      pricingStatus,
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

const preservePricingSnapshot = (existing, next) => {
  const quantity = Math.max(0, Number(next.quantity ?? 0));
  const unitCost = Math.max(0, Number(existing.unitCost ?? 0));
  const sellPrice = Math.max(0, Number(existing.sellPrice ?? 0));
  return {
    ...next,
    category: existing.category,
    sourceBudgetId: existing.sourceBudgetId,
    sourceBudgetItemId: existing.sourceBudgetItemId,
    sourceEntityId: existing.sourceEntityId,
    sourceRateId: existing.sourceRateId,
    pricingRateUpdatedAt: existing.pricingRateUpdatedAt,
    pricingVersion: existing.pricingVersion,
    divisionId: existing.divisionId,
    directCostPerUnit: existing.directCostPerUnit,
    divisionOverheadRecoveryPerUnit: existing.divisionOverheadRecoveryPerUnit,
    companyOverheadRecoveryPerUnit: existing.companyOverheadRecoveryPerUnit,
    recoveredCostPerUnit: existing.recoveredCostPerUnit,
    targetMarginPct: existing.targetMarginPct,
    recommendedRateAtEstimate: existing.recommendedRateAtEstimate,
    equipmentId: existing.equipmentId,
    equipmentName: existing.equipmentName,
    itemName: existing.itemName,
    unit: existing.unit,
    unitCost,
    sellPrice,
    markupPercent: existing.markupPercent,
    markup: existing.markup,
    total: quantity * sellPrice,
    ...(existing.category === 'equipment' ? {
      costRateAtEstimate: existing.costRateAtEstimate ?? unitCost,
      chargeOutRateAtEstimate: existing.chargeOutRateAtEstimate ?? sellPrice,
      estimatedCost: quantity * unitCost,
      estimatedSell: quantity * sellPrice,
    } : {}),
  };
};

export function applyAuthoritativeEstimatePricing({ existingEstimate, nextEstimate, catalog }) {
  const existingById = new Map(estimateLineItems(existingEstimate).map((item) => [item.id, item]));
  const pricingByBudgetItemId = new Map(catalogItems(catalog).map((item) => [`${item.divisionId ?? ''}:${item.budgetItemId}`, item]));

  const apply = (item) => {
    if (!item?.sourceBudgetItemId) return { ok: true, item };
    const existing = existingById.get(item.id);
    if (existing?.sourceBudgetItemId === item.sourceBudgetItemId) return { ok: true, item: preservePricingSnapshot(existing, item) };
    if (item.sourceBudgetId !== catalog.budgetId || nextEstimate.pricingBudgetId !== catalog.budgetId) {
      return { ok: false, error: 'Estimate pricing must come from its selected Pricing Budget.' };
    }
    const pricing = pricingByBudgetItemId.get(`${item.divisionId ?? ''}:${item.sourceBudgetItemId}`)
      ?? pricingByBudgetItemId.get(`:${item.sourceBudgetItemId}`);
    if (!pricing?.pricingAvailable || !(pricing.sellRate > 0)) {
      return { ok: false, error: 'The selected Budget item does not have calculated pricing.' };
    }
    if (item.sourceEntityId && item.sourceEntityId !== pricing.sourceEntityId) {
      return { ok: false, error: 'Estimate pricing source identity is invalid.' };
    }
    const unitCost = Math.max(0, pricing.costRate ?? 0);
    const sellPrice = pricing.sellRate;
    const quantity = Math.max(0, Number(item.quantity ?? 0));
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
      markupPercent: 0,
      markup: 0,
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
