import type { BudgetRate, Estimate, EstimateLineItem, EstimateTemplate, EstimateWorkArea, LineItem, LineItemCategory } from '../types';
import { generateId } from './index';

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

  return {
    id: item.id ?? generateId(),
    category: normalizeCategory(item.category),
    sourceBudgetId: item.sourceBudgetId,
    sourceRateId: item.sourceRateId,
    sourceCategory: normalizeCategory(item.sourceCategory ?? item.category),
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

export function normalizeEstimateWorkAreas(estimate: Pick<Estimate, 'workAreas' | 'lineItems'>): EstimateWorkArea[] {
  const rawWorkAreas = estimate.workAreas;
  if (
    Array.isArray(rawWorkAreas)
    && rawWorkAreas.length > 0
    && typeof rawWorkAreas[0] === 'object'
    && rawWorkAreas[0] !== null
  ) {
    return (rawWorkAreas as EstimateWorkArea[]).map((area, index) => ({
      id: typeof area.id === 'string' && area.id ? area.id : generateId(),
      name: typeof area.name === 'string' && area.name.trim() ? area.name : `${DEFAULT_AREA_NAME} ${index + 1}`,
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

  return [{
    id: generateId(),
    name: legacyAreaNames[0] ?? DEFAULT_AREA_NAME,
    description: '',
    sortOrder: 0,
    lineItems: legacyLineItems,
  }];
}

export function flattenWorkAreaLineItems(workAreas: EstimateWorkArea[]): EstimateLineItem[] {
  return workAreas
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((area) => area.lineItems.map((item) => normalizeEstimateLineItem(item)));
}

export function createNewEstimateWorkArea(workAreas: EstimateWorkArea[]): EstimateWorkArea {
  const sortOrder = workAreas.length;

  return {
    id: generateId(),
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
