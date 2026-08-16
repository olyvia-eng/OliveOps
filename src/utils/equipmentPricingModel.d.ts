import type {
  EquipmentCostBreakdown,
  EquipmentPricingInput,
  EquipmentRatePricingBreakdown,
  EquipmentRatePricingInput,
  EquipmentSellRateInput,
} from './equipmentPricing';

export function calculateEquipmentCostBreakdownModel(input: EquipmentPricingInput): EquipmentCostBreakdown;
export function calculateEquipmentRatePricingModel(input: EquipmentRatePricingInput): EquipmentRatePricingBreakdown;
export function calculateSuggestedEquipmentSellRateModel(input: EquipmentSellRateInput): number;
export function resolveEquipmentSellRatePreviewModel(overrideSellRate: number | null, suggestedSellRate: number): number;
