import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';
import { calculateEquipmentCostBreakdownModel } from '../src/utils/equipmentPricingModel.js';
import { deriveOperatingDays, synchronizeEquipmentUtilization } from '../src/utils/equipmentUtilizationModel.js';

const utilization = { sellableHoursPerYear: 1000, equipmentHoursPerDay: 8 };

test('existing annual-hours-only records derive Expected Operating Days without migration', () => {
  assert.equal(deriveOperatingDays(utilization.sellableHoursPerYear, utilization.equipmentHoursPerDay), 125);
  assert.equal(deriveOperatingDays(1200, 0), 0);
});

test('editing Annual Hours preserves Hours per Day and recalculates Operating Days', () => {
  assert.deepEqual(synchronizeEquipmentUtilization(utilization, 'operatingDays', 'annualHours', 1200, 125), {
    basis: 'annualHours',
    sellableHoursPerYear: 1200,
    equipmentHoursPerDay: 8,
    operatingDays: 150,
  });
});

test('editing Operating Days preserves Hours per Day and recalculates Annual Hours', () => {
  assert.deepEqual(synchronizeEquipmentUtilization(utilization, 'annualHours', 'operatingDays', 150, 125), {
    basis: 'operatingDays',
    sellableHoursPerYear: 1200,
    equipmentHoursPerDay: 8,
    operatingDays: 150,
  });
});

test('editing Hours per Day preserves the most recently edited annual utilization value', () => {
  const annualHoursBasis = synchronizeEquipmentUtilization(utilization, 'annualHours', 'hoursPerDay', 10, 125);
  assert.deepEqual(annualHoursBasis, {
    basis: 'annualHours',
    sellableHoursPerYear: 1000,
    equipmentHoursPerDay: 10,
    operatingDays: 100,
  });

  const operatingDaysBasis = synchronizeEquipmentUtilization(utilization, 'operatingDays', 'hoursPerDay', 10, 150);
  assert.deepEqual(operatingDaysBasis, {
    basis: 'operatingDays',
    sellableHoursPerYear: 1500,
    equipmentHoursPerDay: 10,
    operatingDays: 150,
  });
});

test('utilization synchronization rejects non-finite, negative, and invalid zero-divisor inputs', () => {
  assert.equal(synchronizeEquipmentUtilization(utilization, 'annualHours', 'annualHours', -1, 125).sellableHoursPerYear, 0);
  assert.equal(synchronizeEquipmentUtilization(utilization, 'annualHours', 'operatingDays', Number.NaN, 125).operatingDays, 0);
  assert.equal(synchronizeEquipmentUtilization(utilization, 'annualHours', 'operatingDays', Number.POSITIVE_INFINITY, 125).sellableHoursPerYear, 0);
  assert.deepEqual(synchronizeEquipmentUtilization(utilization, 'annualHours', 'hoursPerDay', 0, 125), {
    basis: 'annualHours',
    sellableHoursPerYear: 1000,
    equipmentHoursPerDay: 8,
    operatingDays: 125,
  });
});

test('editing Operating Days updates live costs through the existing annual-hours pricing input', () => {
  const synchronized = synchronizeEquipmentUtilization(utilization, 'annualHours', 'operatingDays', 150, 125);
  const costs = calculateEquipmentCostBreakdownModel({
    equipmentCostType: 'financed',
    equipmentPayment: 35000,
    equipmentPaymentFrequencyPerYear: 1,
    yearlyFuelCost: 0,
    yearlyInsuranceCost: 0,
    yearlyMaintenanceCost: 0,
    sellableHoursPerYear: synchronized.sellableHoursPerYear,
    equipmentHoursPerDay: synchronized.equipmentHoursPerDay,
  });

  assert.equal(costs.totalEquipmentCostPerYear, 35000);
  assert.ok(Math.abs(costs.totalCostPerHour - (35000 / 1200)) < 0.000001);
  assert.ok(Math.abs(costs.totalCostPerDay - (35000 / 150)) < 0.000001);
});

test('synchronized Annual Hours produce unchanged downstream Budget pricing', () => {
  const synchronized = synchronizeEquipmentUtilization(utilization, 'annualHours', 'operatingDays', 150, 125);
  const budget = { id: 'budget', targetMarginPct: 20 };
  const divisions = [{ id: 'division', budgetId: budget.id, name: 'Division', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 0, equipmentPercent: 100, materialsPercent: 0, subcontractorsPercent: 0 } } }];
  const equipment = { id: 'loader', budgetId: budget.id, category: 'equipment', plannedAmount: 35000, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'division', months: 12 }] };
  const pricingForHours = (sellableHoursPerYear) => buildBudgetPricingRows({ budget, divisions, planningItems: [{ ...equipment, sellableHoursPerYear }], budgetRates: [] })[0];
  const synchronizedPricing = pricingForHours(synchronized.sellableHoursPerYear);
  const existingPricing = pricingForHours(1200);

  assert.equal(synchronizedPricing.costRate, 35000 / 1200);
  assert.deepEqual(synchronizedPricing, existingPricing);
});