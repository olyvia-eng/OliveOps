import type { BudgetRate, EquipmentAsset, Estimate, EstimateLineItem, EstimatePricingCatalogItem, EstimateTemplate, EstimateWorkArea, LineItem, LineItemCategory } from '../types';
import { generateId } from './index';
import { createDefaultEstimateWorkAreaModel, legacyEstimateWorkAreaIdModel } from './estimateWorkAreaIdentity.js';

const DEFAULT_AREA_NAME = 'General';

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeCategory(value: unknown): LineItemCategory {
  if (value === 'material' || value === 'equipment' || value === 'labour' || value === 'subcontractor') {
    return value;
  }
  return 'labour';
}

function normalizeEstimateLineItem(item: Partial<EstimateLineItem> & { id?: string; description?: string }): EstimateLineItem {
  const quantity = Math.max(0, asNumber(item.quantity, 0));
  const unitCost = Math.max(0, asNumber(item.unitCost, 0));
  const markupPercent = Math.max(0, asNumber(item.markupPercent, asNumber(item.markup, 0)));
  const sellPrice = item.sellPrice !== undefined ? Math.max(0, asNumber(item.sellPrice, 0)) : unitCost * (1 + markupPercent / 100);
  const total = quantity * sellPrice;
  const estimatedCost = quantity * unitCost;

  return {
    id: item.id ?? generateId(),
    category: normalizeCategory(item.category),
    labourClassId: item.labourClassId,
    labourClassName: item.labourClassName,
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    sourceBudgetId: item.sourceBudgetId,
    sourceBudgetItemId: item.sourceBudgetItemId,
    sourceEntityId: item.sourceEntityId,
    sourceRateId: item.sourceRateId,
    pricingRateUpdatedAt: item.pricingRateUpdatedAt,
    pricingVersion: item.pricingVersion,
    divisionId: item.divisionId,
    directCostPerUnit: item.directCostPerUnit,
    divisionOverheadRecoveryPerUnit: item.divisionOverheadRecoveryPerUnit,
    companyOverheadRecoveryPerUnit: item.companyOverheadRecoveryPerUnit,
    recoveredCostPerUnit: item.recoveredCostPerUnit,
    targetMarginPct: item.targetMarginPct,
    recommendedRateAtEstimate: item.recommendedRateAtEstimate,
    divisionName: item.divisionName,
    averageLabourCost: item.averageLabourCost,
    overheadRecoveryPerHour: item.overheadRecoveryPerHour,
    breakevenRate: item.breakevenRate,
    calculatedRateAtEstimate: item.calculatedRateAtEstimate,
    customRateAtEstimate: item.customRateAtEstimate,
    estimateRateAtEstimate: item.estimateRateAtEstimate,
    sourceCategory: normalizeCategory(item.sourceCategory ?? item.category),
    equipmentId: item.equipmentId,
    equipmentName: item.equipmentName,
    costRateAtEstimate: item.costRateAtEstimate !== undefined ? Math.max(0, asNumber(item.costRateAtEstimate, unitCost)) : undefined,
    chargeOutRateAtEstimate: item.chargeOutRateAtEstimate !== undefined ? Math.max(0, asNumber(item.chargeOutRateAtEstimate, sellPrice)) : undefined,
    estimatedCost: item.category === 'equipment' ? Math.max(0, asNumber(item.estimatedCost, estimatedCost)) : item.estimatedCost,
    estimatedSell: item.category === 'equipment' ? Math.max(0, asNumber(item.estimatedSell, total)) : item.estimatedSell,
    itemName: typeof item.itemName === 'string' && item.itemName.trim() ? item.itemName : (typeof item.description === 'string' ? item.description : ''),
    description: typeof item.description === 'string' ? item.description : '',
    quantity,
    unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit : 'unit',
    unitCost,
    markupPercent,
    sellPrice,
    total,
    markup: markupPercent,
  };
}

export function createEmptyEstimateLineItem(category: LineItemCategory = 'labour'): EstimateLineItem {
  return {
    id: generateId(),
    category,
    itemName: '',
    description: '',
    quantity: 1,
    unit: category === 'labour' || category === 'equipment' ? 'hr' : 'unit',
    unitCost: 0,
    markupPercent: 0,
    sellPrice: 0,
    total: 0,
    markup: 0,
  };
}

export function calculateEstimateLineItem(item: EstimateLineItem, options?: { recalculateSellPrice?: boolean }): EstimateLineItem {
  if (!options?.recalculateSellPrice) {
    return normalizeEstimateLineItem(item);
  }

  const quantity = Math.max(0, asNumber(item.quantity, 0));
  const unitCost = Math.max(0, asNumber(item.unitCost, 0));
  const markupPercent = Math.max(0, asNumber(item.markupPercent, asNumber(item.markup, 0)));
  const sellPrice = unitCost * (1 + markupPercent / 100);

  return normalizeEstimateLineItem({
    ...item,
    quantity,
    unitCost,
    markupPercent,
    sellPrice,
    markup: markupPercent,
  });
}

export function applyBudgetRateToEstimateLineItem(lineItem: EstimateLineItem, rate: BudgetRate): EstimateLineItem {
  const sellPrice = rate.defaultSellPrice > 0
    ? rate.defaultSellPrice
    : rate.unitCost * (1 + rate.defaultMarkupPercent / 100);

  return calculateEstimateLineItem({
    ...lineItem,
    category: rate.category,
    sourceBudgetId: rate.budgetId,
    sourceRateId: rate.id,
    sourceCategory: rate.category,
    itemName: rate.itemName,
    description: rate.description,
    unit: rate.unit,
    unitCost: rate.unitCost,
    markupPercent: rate.defaultMarkupPercent,
    sellPrice,
    markup: rate.defaultMarkupPercent,
  });
}

export function applyEstimatePricingToLineItem(lineItem: EstimateLineItem, budgetId: string, pricing: EstimatePricingCatalogItem): EstimateLineItem {
  if (!pricing.pricingAvailable || !(pricing.sellRate && pricing.sellRate > 0)) return lineItem;
  const unitCost = Math.max(0, pricing.costRate ?? 0);
  const sellPrice = pricing.sellRate;

  return calculateEstimateLineItem({
    ...lineItem,
    category: pricing.type,
    sourceBudgetId: budgetId,
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
    labourClassId: pricing.type === 'labour' ? pricing.labourClassId : undefined,
    labourClassName: pricing.type === 'labour' ? pricing.name : undefined,
    employeeId: undefined,
    employeeName: undefined,
    divisionName: pricing.divisionName,
    averageLabourCost: pricing.type === 'labour' ? pricing.averageLabourCost ?? unitCost : undefined,
    overheadRecoveryPerHour: pricing.type === 'labour' ? pricing.overheadRecoveryPerHour ?? undefined : undefined,
    breakevenRate: pricing.type === 'labour' ? pricing.breakevenRate ?? undefined : undefined,
    calculatedRateAtEstimate: pricing.calculatedRate ?? undefined,
    customRateAtEstimate: pricing.customRate ?? null,
    estimateRateAtEstimate: pricing.estimateRate ?? sellPrice,
    equipmentId: pricing.type === 'equipment' ? pricing.sourceEntityId : undefined,
    equipmentName: pricing.type === 'equipment' ? pricing.name : undefined,
    itemName: pricing.name,
    description: pricing.description,
    unit: pricing.unit,
    unitCost,
    sellPrice,
    markupPercent: 0,
    markup: 0,
    costRateAtEstimate: pricing.type === 'equipment' ? unitCost : undefined,
    chargeOutRateAtEstimate: pricing.type === 'equipment' ? sellPrice : undefined,
  });
}

export function applyEquipmentAssetToEstimateLineItem(lineItem: EstimateLineItem, asset: EquipmentAsset): EstimateLineItem {
  const costRate = Math.max(0, asNumber(asset.costRateHourly, asNumber(asset.hourlyCost, 0)));
  const chargeOutRate = Math.max(0, asNumber(asset.chargeOutRate, 0));
  const quantity = Math.max(0, asNumber(lineItem.quantity, 0));

  return calculateEstimateLineItem({
    ...lineItem,
    category: 'equipment',
    sourceCategory: 'equipment',
    equipmentId: asset.id,
    equipmentName: asset.name,
    itemName: asset.name,
    description: asset.type || 'Company equipment',
    unit: 'hr',
    unitCost: costRate,
    sellPrice: chargeOutRate,
    markupPercent: costRate > 0 ? Math.max(0, ((chargeOutRate / costRate) - 1) * 100) : 0,
    markup: costRate > 0 ? Math.max(0, ((chargeOutRate / costRate) - 1) * 100) : 0,
    costRateAtEstimate: costRate,
    chargeOutRateAtEstimate: chargeOutRate,
    estimatedCost: quantity * costRate,
    estimatedSell: quantity * chargeOutRate,
  });
}

function fromLegacyLineItem(lineItem: LineItem): EstimateLineItem {
  return normalizeEstimateLineItem({
    id: lineItem.id,
    category: lineItem.category,
    itemName: lineItem.description,
    description: lineItem.description,
    quantity: lineItem.quantity,
    unit: lineItem.unit,
    unitCost: lineItem.unitCost,
    markupPercent: lineItem.markup,
    total: lineItem.total,
  });
}

function legacyWorkAreaId(estimateId: string | undefined, identity: string): string {
  return legacyEstimateWorkAreaIdModel(estimateId, identity, generateId);
}

export function normalizeEstimateWorkAreas(estimate: Pick<Estimate, 'id' | 'workAreas' | 'lineItems'> | Pick<Estimate, 'workAreas' | 'lineItems'>): EstimateWorkArea[] {
  const rawWorkAreas = estimate.workAreas;
  const estimateId = 'id' in estimate ? estimate.id : undefined;
  if (
    Array.isArray(rawWorkAreas)
    && rawWorkAreas.length > 0
    && typeof rawWorkAreas[0] === 'object'
    && rawWorkAreas[0] !== null
  ) {
    return (rawWorkAreas as EstimateWorkArea[]).map((area, index) => ({
      id: typeof area.id === 'string' && area.id
        ? area.id
        : legacyWorkAreaId(estimateId, JSON.stringify({
          name: area.name,
          description: area.description,
          sortOrder: area.sortOrder,
          lineItemIds: Array.isArray(area.lineItems) ? area.lineItems.map((item) => item.id) : [],
        })),
      name: typeof area.name === 'string' && area.name.trim() ? area.name : `${DEFAULT_AREA_NAME} ${index + 1}`,
      divisionId: area.divisionId,
      description: typeof area.description === 'string' ? area.description : '',
      sortOrder: asNumber(area.sortOrder, index),
      lineItems: Array.isArray(area.lineItems)
        ? area.lineItems.map((item) => normalizeEstimateLineItem(item))
        : [],
    }));
  }

  const legacyLineItems = Array.isArray(estimate.lineItems)
    ? estimate.lineItems.map((item) => {
      if (item && typeof item === 'object' && 'markupPercent' in item) {
        return normalizeEstimateLineItem(item as EstimateLineItem);
      }
      return fromLegacyLineItem(item as LineItem);
    })
    : [];

  const legacyAreaNames = Array.isArray(rawWorkAreas)
    ? rawWorkAreas.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  if (legacyAreaNames.length === 0 && legacyLineItems.length === 0) return [];

  return [{
    id: legacyWorkAreaId(estimateId, JSON.stringify({ names: legacyAreaNames, lineItemIds: legacyLineItems.map((item) => item.id) })),
    name: legacyAreaNames[0] ?? DEFAULT_AREA_NAME,
    description: '',
    sortOrder: 0,
    lineItems: legacyLineItems,
  }];
}

export function createDefaultEstimateWorkArea(): EstimateWorkArea {
  return createDefaultEstimateWorkAreaModel(generateId);
}

export function flattenWorkAreaLineItems(workAreas: EstimateWorkArea[]): EstimateLineItem[] {
  return workAreas
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((area) => area.lineItems.map((item) => normalizeEstimateLineItem(item)));
}

export function createNewEstimateWorkArea(workAreas: EstimateWorkArea[], divisionId?: string): EstimateWorkArea {
  const sortOrder = workAreas.length;

  return {
    id: generateId(),
    divisionId,
    name: `Work Area ${sortOrder + 1}`,
    description: '',
    sortOrder,
    lineItems: [],
  };
}

export function computeWorkAreaSubtotal(workArea: EstimateWorkArea): number {
  return workArea.lineItems.reduce((sum, item) => sum + asNumber(item.total, 0), 0);
}

export function computeWorkAreaEstimatedCost(workArea: EstimateWorkArea): number {
  return workArea.lineItems.reduce((sum, item) => {
    const quantity = asNumber(item.quantity, 0);
    const unitCost = asNumber(item.unitCost, 0);
    return sum + (quantity * unitCost);
  }, 0);
}

export function getEstimateLinePricingEconomics(item: EstimateLineItem) {
  const quantity = Math.max(0, asNumber(item.quantity, 0));
  const cost = Math.max(0, asNumber(item.unitCost, 0));
  const price = Math.max(0, asNumber(item.sellPrice, 0));
  const snapshotBreakeven = item.recoveredCostPerUnit ?? item.breakevenRate;
  const breakeven = snapshotBreakeven == null ? null : Math.max(0, asNumber(snapshotBreakeven, 0));
  const profitPercent = item.targetMarginPct == null ? null : Math.max(0, asNumber(item.targetMarginPct, 0));
  const snapshotCalculatedPrice = item.calculatedRateAtEstimate ?? item.recommendedRateAtEstimate;
  const calculatedPrice = snapshotCalculatedPrice == null ? null : Math.max(0, asNumber(snapshotCalculatedPrice, 0));

  return {
    cost,
    breakeven,
    totalCost: quantity * cost,
    profitPercent,
    calculatedPrice,
    price,
    totalPrice: quantity * price,
    isBelowBreakeven: breakeven !== null && price < breakeven,
  };
}

export function computeWorkAreaCategoryCostTotals(workArea: EstimateWorkArea): Record<LineItemCategory, number> {
  return workArea.lineItems.reduce<Record<LineItemCategory, number>>((accumulator, item) => {
    const quantity = asNumber(item.quantity, 0);
    const unitCost = asNumber(item.unitCost, 0);
    accumulator[item.category] += quantity * unitCost;
    return accumulator;
  }, {
    labour: 0,
    equipment: 0,
    material: 0,
    subcontractor: 0,
  });
}

export function computeWorkAreaCategorySellTotals(workArea: EstimateWorkArea): Record<LineItemCategory, number> {
  return workArea.lineItems.reduce<Record<LineItemCategory, number>>((accumulator, item) => {
    accumulator[item.category] += asNumber(item.total, 0);
    return accumulator;
  }, {
    labour: 0,
    equipment: 0,
    material: 0,
    subcontractor: 0,
  });
}

export function computeEstimateSubtotal(workAreas: EstimateWorkArea[]): number {
  return workAreas.reduce((sum, area) => sum + computeWorkAreaSubtotal(area), 0);
}

export function computeEstimateTax(subtotal: number, taxRate: number): number {
  return subtotal * (Math.max(0, asNumber(taxRate, 0)) / 100);
}

export function computeEstimateTotal(subtotal: number, tax: number): number {
  return subtotal + tax;
}

export function normalizeTemplateWorkAreas(template: Pick<EstimateTemplate, 'workAreas' | 'lineItems'>): EstimateWorkArea[] {
  if (Array.isArray(template.workAreas) && template.workAreas.length > 0) {
    return normalizeEstimateWorkAreas({ workAreas: template.workAreas, lineItems: [] });
  }

  const lineItems = Array.isArray(template.lineItems)
    ? template.lineItems.map((lineItem) => normalizeEstimateLineItem({
      ...(lineItem as Partial<EstimateLineItem>),
      itemName: (lineItem as { itemName?: string; description?: string }).itemName ?? (lineItem as { description?: string }).description ?? '',
      description: (lineItem as { description?: string }).description ?? '',
      markupPercent: (lineItem as { markupPercent?: number; markup?: number }).markupPercent ?? (lineItem as { markup?: number }).markup ?? 0,
    }))
    : [];

  return [{
    id: generateId(),
    name: DEFAULT_AREA_NAME,
    description: '',
    sortOrder: 0,
    lineItems,
  }];
}
