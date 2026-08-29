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