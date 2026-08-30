import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateJobPlan,
  cloneJobPlan,
  createJobOnlyPlanLine,
} from '../src/utils/jobPlanModel.js';

const convertedArea = () => ({
  id: 'job-area-1',
  sourceEstimateWorkAreaId: 'estimate-area-1',
  name: 'Driveway',
  description: 'Install gravel',
  status: 'not_started',
  sortOrder: 0,
  lineItems: [{
    id: 'job-line-1',
    sourceEstimateLineItemId: 'estimate-line-1',
    category: 'material',
    itemName: 'Gravel',
    description: '',
    quantity: 20,
    unit: 'tonne',
    unitCost: 40,
    sellPrice: 55,
    contractRevenue: 1100,
    total: 1100,
  }],
});

test('Job plan cost changes reduce margin without changing sold revenue', () => {
  const area = convertedArea();
  area.lineItems[0].unitCost = 48;

  const plan = calculateJobPlan([area]);

  assert.equal(plan.currentPlannedCost, 960);
  assert.equal(plan.currentContractRevenue, 1100);
  assert.equal(plan.currentExpectedProfit, 140);
  assert.ok(Math.abs(plan.currentExpectedMarginPct - (140 / 1100) * 100) < 0.000001);
  assert.equal(plan.operationalWorkAreas[0].lineItems[0].total, 1100);
});

test('Job plan quantity changes do not recalculate sold revenue', () => {
  const area = convertedArea();
  area.lineItems[0].quantity = 25;

  const plan = calculateJobPlan([area]);

  assert.equal(plan.currentPlannedCost, 1000);
  assert.equal(plan.currentContractRevenue, 1100);
  assert.equal(plan.operationalWorkAreas[0].lineItems[0].contractRevenue, 1100);
});

test('new Job-only resources contribute cost and zero contract revenue', () => {
  const line = createJobOnlyPlanLine({
    id: 'job-line-new',
    category: 'equipment',
    itemName: 'Plate Compactor',
    quantity: 3,
    unit: 'hr',
    unitCost: 30,
    sellPrice: 50,
    recommendedSellPriceAtAddition: 50,
    total: 150,
  });
  const plan = calculateJobPlan([{ ...convertedArea(), lineItems: [line] }]);

  assert.equal(plan.currentPlannedCost, 90);
  assert.equal(plan.currentContractRevenue, 0);
  assert.equal(plan.currentExpectedProfit, -90);
  assert.equal(plan.operationalWorkAreas[0].lineItems[0].recommendedSellPriceAtAddition, 50);
});

test('original and operational plans remain independent deep copies', () => {
  const original = [convertedArea()];
  const operational = cloneJobPlan(original);
  operational[0].description = 'Changed operational scope';
  operational[0].lineItems[0].unitCost = 48;

  assert.equal(original[0].description, 'Install gravel');
  assert.equal(original[0].lineItems[0].unitCost, 40);
});