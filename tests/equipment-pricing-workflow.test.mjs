import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateEquipmentCostBreakdownModel,
  calculateEquipmentRatePricingModel,
} from '../src/utils/equipmentPricingModel.js';
import { redactEquipmentPricingForSession } from '../api/_lib/authorization.js';

const budgetSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
const formSource = readFileSync('src/components/equipment/EquipmentInfoForm.tsx', 'utf8');
const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const estimateBuilderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const estimateModelSource = readFileSync('src/utils/estimateModel.ts', 'utf8');
const conversionSource = readFileSync('api/estimates.js', 'utf8');
const dataApiSource = readFileSync('api/data.js', 'utf8');
const repoSource = readFileSync('api/_lib/authRepo.js', 'utf8');

const costInput = {
  equipmentCostType: 'financed',
  equipmentPayment: 2000,
  equipmentPaymentFrequencyPerYear: 12,
  averageFuelPrice: 3,
  averageFuelBurnPerHour: 5,
  yearlyInsuranceCost: 4000,
  yearlyMaintenanceCost: 6000,
  sellableHoursPerYear: 1200,
  equipmentHoursPerDay: 8,
  monthsUsedPerYear: 12,
};

test('equipment costing calculates annual, daily, and hourly operating cost', () => {
  const result = calculateEquipmentCostBreakdownModel(costInput);

  assert.equal(result.annualPayments, 24000);
  assert.equal(result.annualFuelCost, 18000);
  assert.equal(result.totalEquipmentCostPerYear, 52000);
  assert.equal(result.operatingDaysPerYear, 150);
  assert.ok(Math.abs(result.totalCostPerDay - 346.6666666667) < 0.000001);
  assert.ok(Math.abs(result.totalCostPerHour - 43.3333333333) < 0.000001);
});

test('equipment costing handles zero utilization and recalculates from changed inputs', () => {
  const zeroUtilization = calculateEquipmentCostBreakdownModel({ ...costInput, sellableHoursPerYear: 0, equipmentHoursPerDay: 0 });
  assert.equal(zeroUtilization.totalCostPerHour, 0);
  assert.equal(zeroUtilization.totalCostPerDay, 0);
  assert.equal(zeroUtilization.operatingDaysPerYear, 0);

  const recalculated = calculateEquipmentCostBreakdownModel({ ...costInput, equipmentPayment: 2500 });
  assert.equal(recalculated.totalEquipmentCostPerYear, 58000);
  assert.ok(Math.abs(recalculated.totalCostPerHour - 48.3333333333) < 0.000001);
});

test('recommended equipment rate applies overhead and target gross margin, not markup', () => {
  const pricing = calculateEquipmentRatePricingModel({
    costRateHourly: 43.09,
    overheadRecoveryHourly: 12.4,
    targetMarginPercent: 20,
  });

  assert.equal(pricing.fullyBurdenedCostHourly, 55.49);
  assert.ok(Math.abs(pricing.recommendedSellRate - 69.3625) < 0.000001);
  assert.ok(Math.abs(pricing.estimatedMarginPercent - 20) < 0.000001);
  assert.equal(pricing.meetsTargetMargin, true);
  assert.notEqual(pricing.recommendedSellRate, pricing.fullyBurdenedCostHourly * 1.2);
});

test('final charge-out override reports below-target pricing health without blocking it', () => {
  const pricing = calculateEquipmentRatePricingModel({
    costRateHourly: 43.09,
    overheadRecoveryHourly: 12.4,
    targetMarginPercent: 20,
    chargeOutRate: 60,
  });

  assert.equal(pricing.chargeOutRate, 60);
  assert.equal(pricing.meetsTargetMargin, false);
  assert.ok(Math.abs(pricing.estimatedMarginPercent - 7.5166666667) < 0.000001);
});

test('equipment cost entry contains no sell rate and pricing is owned by Analysis', () => {
  assert.doesNotMatch(formSource, /Budget Sell Rate|Charge-Out Rate/);
  assert.doesNotMatch(budgetSource, /budgetSellRate=|onBudgetSellRateChange|showBudgetSellRate/);
  assert.match(formSource, /Annual Equipment Cost/);
  assert.match(formSource, /Cost per Operating Day/);
  assert.match(formSource, /Cost per Operating Hour/);
  assert.match(budgetSource, /Pricing & Analysis/);
  assert.match(budgetSource, /Equipment Pricing/);
  assert.match(budgetSource, /Use Recommended/);
  assert.match(budgetSource, /Below recommended rate/);
});

test('approved rate is saved to budget pricing and synchronized to the catalog', () => {
  assert.match(budgetSource, /recommendedSellPrice: pricing\.recommendedSellRate/);
  assert.match(budgetSource, /defaultSellPrice: chargeOutRate/);
  assert.match(budgetSource, /updateEquipmentAsset\(row\.asset\.id/);
  assert.match(catalogSource, /Cost Rate/);
  assert.match(catalogSource, /Recommended Rate/);
  assert.match(catalogSource, /Approved Charge-Out Rate/);
  assert.match(repoSource, /costRateHourly: Number\(item\.costRateHourly \?\? item\.hourlyCost \?\? 0\)/);
  assert.match(repoSource, /chargeOutRate: Number\(item\.chargeOutRate \?\? item\.recommendedSellRate \?\? 0\)/);
});

test('non-financial roles cannot receive internal pricing or modify protected rates', () => {
  const [redacted] = redactEquipmentPricingForSession({ role: 'foreman' }, [{
    id: 'eq-1',
    hourlyCost: 5,
    costRateHourly: 43.09,
    recommendedSellRate: 69.36,
    chargeOutRate: 70,
  }]);
  assert.equal(redacted.costRateHourly, undefined);
  assert.equal(redacted.recommendedSellRate, undefined);
  assert.equal(redacted.chargeOutRate, 70);
  assert.match(dataApiSource, /Only owner\/admin can change equipment pricing\./);
  assert.match(dataApiSource, /changesEquipmentPricing\(data\)/);
});

test('estimate equipment uses catalog charge-out and snapshots cost and sell values', () => {
  assert.match(estimateBuilderSource, /approvedChargeOutRate/);
  assert.match(estimateBuilderSource, /applyEquipmentAssetToEstimateLineItem/);
  assert.match(estimateBuilderSource, /legacy budget rate/);
  assert.match(estimateModelSource, /costRateAtEstimate: costRate/);
  assert.match(estimateModelSource, /chargeOutRateAtEstimate: chargeOutRate/);
  assert.match(estimateModelSource, /estimatedCost: quantity \* costRate/);
  assert.match(estimateModelSource, /estimatedSell: quantity \* chargeOutRate/);
});

test('estimate-to-job conversion preserves accepted equipment financial snapshots', () => {
  assert.match(conversionSource, /equipmentId: rawLineItem\.equipmentId/);
  assert.match(conversionSource, /costRateAtEstimate: rawLineItem\.costRateAtEstimate/);
  assert.match(conversionSource, /chargeOutRateAtEstimate: rawLineItem\.chargeOutRateAtEstimate/);
  assert.match(conversionSource, /estimatedCost: toNumber\(rawLineItem\.estimatedCost, quantity \* unitCost\)/);
  assert.match(conversionSource, /estimatedSell: toNumber\(rawLineItem\.estimatedSell, total\)/);
  assert.match(conversionSource, /originalEstimateSnapshot: snapshot/);
});
