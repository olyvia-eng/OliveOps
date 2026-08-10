import type { EquipmentCostType } from '../types';

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

const normalizeNonNegative = (value: number | undefined) => {
  const candidate = Number(value ?? 0);
  if (!Number.isFinite(candidate)) return 0;
  return Math.max(0, candidate);
};

export function calculateEquipmentCostBreakdown(input: EquipmentPricingInput): EquipmentCostBreakdown {
  const paymentPerPeriod = input.equipmentCostType === 'owned'
    ? 0
    : normalizeNonNegative(input.equipmentPayment);
  const paymentFrequencyPerYear = input.equipmentCostType === 'owned'
    ? 0
    : normalizeNonNegative(input.equipmentPaymentFrequencyPerYear);
  const annualPayments = paymentPerPeriod * paymentFrequencyPerYear;

  const fuelPricePerUnit = normalizeNonNegative(input.averageFuelPrice);
  const fuelBurnPerHour = normalizeNonNegative(input.averageFuelBurnPerHour);
  const fuelCostPerHour = fuelPricePerUnit * fuelBurnPerHour;

  const annualInsuranceCost = normalizeNonNegative(input.yearlyInsuranceCost);
  const annualMaintenanceCost = normalizeNonNegative(input.yearlyMaintenanceCost);

  const sellableHoursPerYear = normalizeNonNegative(input.sellableHoursPerYear);
  const equipmentHoursPerDay = normalizeNonNegative(input.equipmentHoursPerDay);
  const monthsUsedPerYear = Math.max(1, Math.min(12, Math.round(normalizeNonNegative(input.monthsUsedPerYear) || 1)));

  const annualFuelCost = fuelCostPerHour * sellableHoursPerYear;
  const totalEquipmentCostPerYear = annualPayments + annualFuelCost + annualInsuranceCost + annualMaintenanceCost;
  const totalCostPerHour = sellableHoursPerYear > 0 ? totalEquipmentCostPerYear / sellableHoursPerYear : 0;
  const totalCostPerDay = totalCostPerHour * equipmentHoursPerDay;

  return {
    paymentPerPeriod,
    paymentFrequencyPerYear,
    annualPayments,
    fuelPricePerUnit,
    fuelBurnPerHour,
    fuelCostPerHour,
    annualFuelCost,
    annualInsuranceCost,
    annualMaintenanceCost,
    sellableHoursPerYear,
    equipmentHoursPerDay,
    monthsUsedPerYear,
    totalEquipmentCostPerYear,
    totalCostPerHour,
    totalCostPerDay,
  };
}

export function calculateSuggestedEquipmentSellRate(input: EquipmentSellRateInput): number {
  const costPerHour = normalizeNonNegative(input.costPerHour);
  const equipmentOverheadRecoveryPerHour = normalizeNonNegative(input.equipmentOverheadRecoveryPerHour);
  const marginDivisor = Math.max(0.01, Number.isFinite(input.marginDivisor) ? input.marginDivisor : 0.01);
  if (costPerHour <= 0) return 0;
  return (costPerHour + equipmentOverheadRecoveryPerHour) / marginDivisor;
}

export function resolveEquipmentSellRatePreview(overrideSellRate: number | null, suggestedSellRate: number): number {
  if (overrideSellRate == null) return suggestedSellRate;
  const normalizedOverride = normalizeNonNegative(overrideSellRate);
  return normalizedOverride;
}
