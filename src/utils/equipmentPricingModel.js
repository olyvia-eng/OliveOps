const normalizeNonNegative = (value) => {
  const candidate = Number(value ?? 0);
  if (!Number.isFinite(candidate)) return 0;
  return Math.max(0, candidate);
};

export function calculateEquipmentCostBreakdownModel(input) {
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
  const operatingDaysPerYear = equipmentHoursPerDay > 0 ? sellableHoursPerYear / equipmentHoursPerDay : 0;
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
    operatingDaysPerYear,
    monthsUsedPerYear,
    totalEquipmentCostPerYear,
    totalCostPerHour,
    totalCostPerDay,
  };
}

export function calculateEquipmentRatePricingModel(input) {
  const costRateHourly = normalizeNonNegative(input.costRateHourly);
  const overheadRecoveryHourly = normalizeNonNegative(input.overheadRecoveryHourly);
  const fullyBurdenedCostHourly = costRateHourly + overheadRecoveryHourly;
  const targetMarginPercent = Math.min(99, normalizeNonNegative(input.targetMarginPercent));
  const marginDivisor = 1 - targetMarginPercent / 100;
  const recommendedSellRate = fullyBurdenedCostHourly > 0 ? fullyBurdenedCostHourly / marginDivisor : 0;
  const approvedRate = input.chargeOutRate == null ? recommendedSellRate : normalizeNonNegative(input.chargeOutRate);
  const estimatedMarginPercent = approvedRate > 0
    ? ((approvedRate - fullyBurdenedCostHourly) / approvedRate) * 100
    : 0;

  return {
    costRateHourly,
    overheadRecoveryHourly,
    fullyBurdenedCostHourly,
    targetMarginPercent,
    recommendedSellRate,
    chargeOutRate: approvedRate,
    estimatedMarginPercent,
    meetsTargetMargin: approvedRate >= recommendedSellRate,
  };
}

export function calculateSuggestedEquipmentSellRateModel(input) {
  const costPerHour = normalizeNonNegative(input.costPerHour);
  const equipmentOverheadRecoveryPerHour = normalizeNonNegative(input.equipmentOverheadRecoveryPerHour);
  const marginDivisor = Math.max(0.01, Number.isFinite(input.marginDivisor) ? input.marginDivisor : 0.01);
  if (costPerHour <= 0) return 0;
  return (costPerHour + equipmentOverheadRecoveryPerHour) / marginDivisor;
}

export function resolveEquipmentSellRatePreviewModel(overrideSellRate, suggestedSellRate) {
  if (overrideSellRate == null) return suggestedSellRate;
  return normalizeNonNegative(overrideSellRate);
}
