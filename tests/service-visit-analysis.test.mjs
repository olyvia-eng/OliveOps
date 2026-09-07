import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateServiceVisitAnalysis } from '../src/utils/serviceVisitAnalysis.js';

test('Visit analysis uses closed Time Entry snapshots and explicitly linked actual costs', () => {
  const visit = { id: 'visit-a', status: 'completed' };
  const service = {
    billingType: 'per_visit',
    pricingSnapshot: {
      billingType: 'per_visit', estimatedVisits: 10,
      lineItems: [{ category: 'labour', quantity: 3, unitCost: 40, recoveredCostPerUnit: 50, sellPrice: 70, costScope: 'per_visit' }],
      perVisitPricing: { customPricePerVisit: 250 },
    },
  };
  const timeEntries = [
    { workType: 'job', serviceVisitId: 'visit-a', status: 'clocked_out', clockIn: '2027-05-13T12:00:00Z', clockOut: '2027-05-13T13:30:00Z', labourCostTotalSnapshot: 52 },
    { workType: 'job', serviceVisitId: 'visit-a', status: 'clocked_out', clockIn: '2027-05-13T12:05:00Z', clockOut: '2027-05-13T13:35:00Z', labourCostTotalSnapshot: 51 },
    { workType: 'job', serviceVisitId: 'visit-b', status: 'clocked_out', clockIn: '2027-05-13T12:00:00Z', clockOut: '2027-05-13T14:00:00Z', labourCostTotalSnapshot: 100 },
  ];
  const actualCosts = [
    { serviceVisitId: 'visit-a', category: 'equipment', total: 42 },
    { serviceVisitId: 'visit-b', category: 'material', total: 99 },
  ];

  const result = calculateServiceVisitAnalysis({ visit, service, timeEntries, actualCosts });

  assert.equal(result.actualLabourHours, 3);
  assert.equal(result.actualLabourCost, 103);
  assert.equal(result.actualEquipmentCost, 42);
  assert.equal(result.actualMaterialCost, 0);
  assert.equal(result.actualVisitCost, 145);
  assert.equal(result.estimatedCostPerVisit, 150);
  assert.equal(result.billableAmount, 250);
});