import type {
  EquipmentCostBreakdown,
  EquipmentPricingInput,
  EquipmentRatePricingBreakdown,
  EquipmentRatePricingInput,
  EquipmentSellRateInput,
} from './equipmentPricing';
import type { EquipmentAsset, EquipmentClassification, EquipmentCostType } from '../types';

export function calculateEquipmentCostBreakdownModel(input: EquipmentPricingInput): EquipmentCostBreakdown;
export function calculateAnnualEquipmentCostModel(input: Partial<EquipmentPricingInput> & { costType?: EquipmentCostType; plannedAmount?: number; paymentFrequencyPerYear?: number; utilizationHours?: number; rentalCost?: number }): number;
export function resolveEquipmentClassificationModel(item: { classification?: EquipmentClassification }, equipmentAsset?: EquipmentAsset): EquipmentClassification;
export function calculateEquipmentRatePricingModel(input: EquipmentRatePricingInput): EquipmentRatePricingBreakdown;
export function calculateSuggestedEquipmentSellRateModel(input: EquipmentSellRateInput): number;
export function resolveEquipmentSellRatePreviewModel(overrideSellRate: number | null, suggestedSellRate: number): number;
