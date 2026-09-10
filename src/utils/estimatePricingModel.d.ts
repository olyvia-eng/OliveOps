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

export function applyEstimateLineSnapshotPricing<T extends EstimateLineItem>(
  lineItem: T,
  input?: {
    targetMarginPct?: number;
    customSellPrice?: number | null;
    quantity?: number;
    costScope?: 'per_visit' | 'service_period';
  },
): T;

export function estimateLineWorkers(item: Partial<EstimateLineItem>): number;

export function estimateLineEffectiveQuantity(item: Partial<EstimateLineItem>): number;

export function reorderEstimateLineItemsWithinCategory(
  lineItems: EstimateLineItem[],
  category: LineItemCategory,
  orderedIds: string[],
): { ok: boolean; lineItems: EstimateLineItem[] };

export function applyEstimateLineItemCostOverride(
  item: EstimateLineItem,
  value: number,
): { ok: boolean; lineItem: EstimateLineItem; error?: string };