import type { EstimateLineItem, LineItemCategory } from '../types';

export interface EstimateSnapshotPricingInput {
  breakeven: number;
  targetMarginPct: number;
  customSellPrice?: number | null;
}

export interface EstimateSnapshotPricing {
  breakeven: number;
  targetMarginPct: number;
  calculatedSellPrice: number;
  customSellPrice: number | null;
  sellPrice: number;
  effectiveMarginPct: number;
}

export function calculateEstimateSnapshotPricing(input: EstimateSnapshotPricingInput): EstimateSnapshotPricing;

export function reorderEstimateLineItemsWithinCategory(
  lineItems: EstimateLineItem[],
  category: LineItemCategory,
  orderedIds: string[],
): { ok: boolean; lineItems: EstimateLineItem[] };

export function applyEstimateLineItemCostOverride(
  item: EstimateLineItem,
  value: number,
): { ok: boolean; lineItem: EstimateLineItem; error?: string };