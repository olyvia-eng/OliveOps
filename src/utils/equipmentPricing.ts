import type { EquipmentAsset, EquipmentCostType } from '../types';
import {
  calculateEquipmentCostBreakdownModel,
  calculateEquipmentRatePricingModel,
  calculateSuggestedEquipmentSellRateModel,
  resolveEquipmentSellRatePreviewModel,
} from './equipmentPricingModel.js';

export interface EquipmentPricingInput {
  equipmentCostType: EquipmentCostType;
  equipmentPayment: number;
  equipmentPaymentFrequencyPerYear: number;
  averageFuelPrice: number;
  averageFuelBurnPerHour: number;
  yearlyInsuranceCost: number;
  yearlyMaintenanceCost: number;
  sellableHoursPerYear: number;
  equipmentHoursPerDay: number;
  monthsUsedPerYear: number;
}

export interface EquipmentCostBreakdown {
  paymentPerPeriod: number;
  paymentFrequencyPerYear: number;
  annualPayments: number;
  fuelPricePerUnit: number;
  fuelBurnPerHour: number;
  fuelCostPerHour: number;
  annualFuelCost: number;
  annualInsuranceCost: number;
  annualMaintenanceCost: number;
  sellableHoursPerYear: number;
  equipmentHoursPerDay: number;
  operatingDaysPerYear: number;
  monthsUsedPerYear: number;
  totalEquipmentCostPerYear: number;
  totalCostPerHour: number;
  totalCostPerDay: number;
}

export interface EquipmentSellRateInput {
  costPerHour: number;
  equipmentOverheadRecoveryPerHour: number;
  marginDivisor: number;
}

export interface EquipmentRatePricingInput {
  costRateHourly: number;
  overheadRecoveryHourly: number;
  targetMarginPercent: number;
  chargeOutRate?: number | null;
}

export interface EquipmentRatePricingBreakdown {
  costRateHourly: number;
  overheadRecoveryHourly: number;
  fullyBurdenedCostHourly: number;
  targetMarginPercent: number;
  recommendedSellRate: number;
  chargeOutRate: number;
  estimatedMarginPercent: number;
  meetsTargetMargin: boolean;
}

export function calculateEquipmentCostBreakdown(input: EquipmentPricingInput): EquipmentCostBreakdown {
  return calculateEquipmentCostBreakdownModel(input) as EquipmentCostBreakdown;
}

export function calculateEquipmentRatePricing(input: EquipmentRatePricingInput): EquipmentRatePricingBreakdown {
  return calculateEquipmentRatePricingModel(input) as EquipmentRatePricingBreakdown;
}

export function calculateSuggestedEquipmentSellRate(input: EquipmentSellRateInput): number {
  return calculateSuggestedEquipmentSellRateModel(input) as number;
}

export function resolveEquipmentSellRatePreview(overrideSellRate: number | null, suggestedSellRate: number): number {
  return resolveEquipmentSellRatePreviewModel(overrideSellRate, suggestedSellRate) as number;
}

export function resolveEquipmentCostRate(equipment: EquipmentAsset): number | null {
  if (typeof equipment.costRateHourly === 'number' && equipment.costRateHourly > 0) return equipment.costRateHourly;
  const hasModernFuelInputs = equipment.averageFuelPrice !== undefined || equipment.averageFuelBurnPerHour !== undefined;
  if (!hasModernFuelInputs && equipment.hourlyCost > 0) return equipment.hourlyCost;
  return null;
}
