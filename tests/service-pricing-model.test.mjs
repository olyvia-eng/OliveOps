import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateServiceEconomics, calculateServiceEstimateTotals, formatServiceFrequency, validateServicePricing } from '../src/utils/servicePricingModel.js';

const line = (category, quantity, direct, recovered, sell, costScope = 'per_visit') => ({ id: `${category}-${costScope}`, category, itemName: category, description: '', quantity, unit: 'hr', unitCost: direct, directCostPerUnit: direct, recoveredCostPerUnit: recovered, calculatedRateAtEstimate: sell, sellPrice: sell, total: quantity * sell, markupPercent: 0, costScope, pricingReadiness: 'priced' });
const service = (billingType, overrides = {}) => ({ id: billingType, name: billingType, description: '', sortOrder: 0, scheduleType: 'recurring', billingType, startDate: '2027-04-01', endDate: '2027-10-01', frequency: { interval: 1, unit: 'week' }, estimatedVisits: 20, lineItems: [line('labour', 2, 30, 45, 75), line('equipment', 1, 20, 30, 50), line('material', 10, 2, 2.5, 4), line('subcontractor', 1, 100, 120, 160, 'service_period')], ...overrides });

test('calculates all resource categories per visit and counts service-period costs once', () => {
  const result = calculateServiceEconomics(service('contract'));
  assert.deepEqual(result.categories, { labour: 90, equipment: 30, material: 25, subcontractor: 0 });
  assert.equal(result.directCostPerVisit, 100);
  assert.equal(result.overheadPerVisit, 45);
  assert.equal(result.loadedCostPerVisit, 145);
  assert.equal(result.recommendedPricePerVisit, 240);
  assert.equal(result.servicePeriodCost, 120);
  assert.equal(result.estimatedCost, 3020);
  assert.equal(result.recommendedContractValue, 4960);
  const legacy = calculateServiceEconomics({ ...service('per_visit'), lineItems: [{ ...line('labour', 2, 30, 45, 75), directCostPerUnit: undefined, recoveredCostPerUnit: undefined, calculatedRateAtEstimate: undefined, recommendedRateAtEstimate: undefined }] });
  assert.equal(legacy.directCostPerVisit, 60);
  assert.equal(legacy.effectivePricePerVisit, 150);
});

test('contract override is fixed while per-visit and T&M revenue remain projected', () => {
  const contract = service('contract', { contractPricing: { customContractPrice: 5200 } });
  const perVisit = service('per_visit', { estimatedVisits: 10, perVisitPricing: { customPricePerVisit: 260, oneTimeCharge: 200 } });
  const timeAndMaterial = service('time_and_material', { estimatedVisits: 5 });
  const totals = calculateServiceEstimateTotals([contract, perVisit, timeAndMaterial], 13);
  assert.equal(calculateServiceEconomics(contract).contractedRevenue, 5200);
  assert.equal(calculateServiceEconomics(perVisit).projectedPerVisitRevenue, 2800);
  assert.equal(calculateServiceEconomics(timeAndMaterial).projectedTimeAndMaterialRevenue, 1360);
  assert.equal(totals.contractedRevenue, 5200);
  assert.equal(totals.projectedPerVisitRevenue, 2800);
  assert.equal(totals.projectedTimeAndMaterialRevenue, 1360);
  assert.equal(totals.estimatedRevenue, 9360);
  assert.equal(totals.estimatedTax, 1216.8);
});

test('custom visit price resets to canonical line pricing when null', () => {
  assert.equal(calculateServiceEconomics(service('contract', { pricing: { customPricePerVisit: 275 } })).effectivePricePerVisit, 275);
  assert.equal(calculateServiceEconomics(service('contract', { pricing: { customPricePerVisit: null } })).effectivePricePerVisit, 240);
});

test('one-time and recurrence labels remain canonical and zero revenue margin is safe', () => {
  const oneTime = service('per_visit', { scheduleType: 'one_time', estimatedVisits: 40 });
  assert.equal(calculateServiceEconomics(oneTime).estimatedVisits, 1);
  assert.equal(formatServiceFrequency(oneTime), 'One time');
  assert.equal(formatServiceFrequency({ scheduleType: 'recurring', frequency: { interval: 2, unit: 'week' } }), 'Every 2 weeks');
  assert.equal(calculateServiceEconomics({ ...oneTime, lineItems: [], perVisitPricing: { customPricePerVisit: 0 } }).estimatedMarginPercent, 0);
});

test('pricing validation rejects incomplete sell configuration and negative resources', () => {
  assert.match(validateServicePricing({ ...service('contract'), contractPricing: { customContractPrice: -1 } }), /Contract Price/);
  assert.match(validateServicePricing({ ...service('per_visit'), lineItems: [line('labour', -1, 30, 45, 75)] }), /quantity/);
  assert.match(validateServicePricing({ ...service('time_and_material'), lineItems: [] }), /priced resource/);
});