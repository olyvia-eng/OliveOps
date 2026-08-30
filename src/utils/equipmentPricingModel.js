const normalizeNonNegative = (value) => {
  const candidate = Number(value ?? 0);
  if (!Number.isFinite(candidate)) return 0;
  return Math.max(0, candidate);
};

export function calculateEquipmentCostBreakdownModel(input) {
  const usesPaymentCapitalCost = input.equipmentCostType !== 'owned' && input.equipmentCostType !== 'rental';
  const replacementInputsComplete = input.equipmentCostType === 'owned'
    && Number.isFinite(input.expectedReplacementCost)
    && Number.isFinite(input.expectedResaleValue)
    && Number.isFinite(input.remainingUsefulMonths)
    && input.expectedReplacementCost >= 0
    && input.expectedResaleValue >= 0
    && input.expectedResaleValue <= input.expectedReplacementCost
    && input.remainingUsefulMonths > 0;
  const paymentPerPeriod = usesPaymentCapitalCost
    ? normalizeNonNegative(input.equipmentPayment)
    : 0;
  const paymentFrequencyPerYear = usesPaymentCapitalCost
    ? normalizeNonNegative(input.equipmentPaymentFrequencyPerYear)
    : 0;
  const annualPayments = paymentPerPeriod * paymentFrequencyPerYear;
  const monthlyReplacementReserve = replacementInputsComplete
    ? (input.expectedReplacementCost - input.expectedResaleValue) / input.remainingUsefulMonths
    : 0;
  const annualReplacementReserve = monthlyReplacementReserve * 12;
  const fuelPricePerUnit = normalizeNonNegative(input.averageFuelPrice);
  const fuelBurnPerHour = normalizeNonNegative(input.averageFuelBurnPerHour);
  const fuelCostPerHour = fuelPricePerUnit * fuelBurnPerHour;
  const annualInsuranceCost = normalizeNonNegative(input.yearlyInsuranceCost);
  const annualMaintenanceCost = normalizeNonNegative(input.yearlyMaintenanceCost);
  const sellableHoursPerYear = normalizeNonNegative(input.sellableHoursPerYear);
  const equipmentHoursPerDay = normalizeNonNegative(input.equipmentHoursPerDay);
  const operatingDaysPerYear = equipmentHoursPerDay > 0 ? sellableHoursPerYear / equipmentHoursPerDay : 0;
  const annualFuelCost = input.yearlyFuelCost == null
    ? fuelCostPerHour * sellableHoursPerYear
    : normalizeNonNegative(input.yearlyFuelCost);
  const totalEquipmentCostPerYear = annualPayments + annualReplacementReserve + annualFuelCost + annualInsuranceCost + annualMaintenanceCost;
  const totalCostPerHour = sellableHoursPerYear > 0 ? totalEquipmentCostPerYear / sellableHoursPerYear : 0;
  const totalCostPerDay = totalCostPerHour * equipmentHoursPerDay;

  return {
    paymentPerPeriod,
    paymentFrequencyPerYear,
    annualPayments,
    monthlyReplacementReserve,
    annualReplacementReserve,
    fuelPricePerUnit,
    fuelBurnPerHour,
    fuelCostPerHour,
    annualFuelCost,
    annualInsuranceCost,
    annualMaintenanceCost,
    sellableHoursPerYear,
    equipmentHoursPerDay,
    operatingDaysPerYear,
    totalEquipmentCostPerYear,
    totalCostPerHour,
    totalCostPerDay,
  };
}

export function calculateAnnualEquipmentCostModel(input) {
  if (input.plannedAmount !== undefined) return normalizeNonNegative(input.plannedAmount);
  if (input.equipmentCostType === 'rental' || input.costType === 'rental') return normalizeNonNegative(input.rentalCost);
  return calculateEquipmentCostBreakdownModel({
    ...input,
    equipmentCostType: input.equipmentCostType ?? input.costType,
    equipmentPaymentFrequencyPerYear: input.equipmentPaymentFrequencyPerYear ?? input.paymentFrequencyPerYear,
    sellableHoursPerYear: input.sellableHoursPerYear ?? input.utilizationHours,
  }).totalEquipmentCostPerYear;
}

export function resolveEquipmentClassificationModel(item, equipmentAsset) {
  return equipmentAsset?.equipmentClassification === 'overhead' || equipmentAsset?.equipmentClassification === 'billable'
    ? equipmentAsset.equipmentClassification
    : item.classification === 'overhead' ? 'overhead' : 'billable';
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
