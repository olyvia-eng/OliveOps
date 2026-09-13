import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateJobBill, calculateJobCostAnalysis } from '../src/utils/jobCostingModel.js';

const job = { id: 'job-a', originalEstimateSnapshot: { subtotal: 5000, workAreas: [{ id: 'area-a', contractRevenue: 5000, lineItems: [
  { category: 'labour', quantity: 10, averageLabourCost: 30 }, { category: 'equipment', quantity: 5, costRateAtEstimate: 20 },
  { category: 'material', quantity: 2, directCostPerUnit: 100 }, { category: 'subcontractor', plannedCost: 400 },
] }] } };

test('Job costing preserves snapshot estimates and aggregates transactional actuals', () => {
  const vendorBills = [calculateJobBill({ lineItems: [{ description: 'Stone', quantity: 2, unitCost: 60, workAreaId: 'area-a' }], taxRate: 10 }, 'vendor')];
  const subcontractorBills = [calculateJobBill({ lineItems: [{ description: 'Excavation', quantity: 1, unitCost: 250, workAreaId: 'area-a' }] }, 'subcontractor')];
  const result = calculateJobCostAnalysis({ job, equipmentUsage: [{ workAreaId: 'area-a', cost: 75 }], vendorBills, subcontractorBills });
  assert.deepEqual(result.categories.map((row) => row.estimated), [300, 100, 200, 400]);
  assert.deepEqual(result.categories.map((row) => row.actual), [0, 75, 132, 250]);
  assert.equal(result.summary.actualCostToDate, 457);
  assert.equal(result.categories[2].variance, 68);
});

test('current Job plan and catalog changes cannot alter the accepted Estimate baseline', () => {
  const changedJob = { ...job, operationalWorkAreas: [{ id: 'area-a', lineItems: [{ category: 'material', quantity: 100, unitCost: 999 }] }] };
  const result = calculateJobCostAnalysis({ job: changedJob });
  assert.deepEqual(result.categories.map((row) => row.estimated), [300, 100, 200, 400]);
  assert.equal(result.summary.estimatedTotalCost, 1000);
});

test('material comparisons join accepted estimates to actual purchases by Catalog ID', () => {
  const materialJob = structuredClone(job);
  materialJob.originalEstimateSnapshot.workAreas[0].lineItems[2].materialCatalogItemId = 'material-stone';
  Object.assign(materialJob.originalEstimateSnapshot.workAreas[0].lineItems[2], { itemName: 'Stone', unit: 't' });
  const vendorBill = calculateJobBill({ lineItems: [{ materialCatalogItemId: 'material-stone', description: 'Stone', quantity: 3, unit: 't', unitCost: 225, workAreaId: 'area-a' }] }, 'vendor');
  const result = calculateJobCostAnalysis({ job: materialJob, vendorBills: [vendorBill] });

  assert.deepEqual(result.materialComparisons, [{
    estimateMaterialSnapshotId: 'legacy:area-a:2', materialCatalogItemId: 'material-stone', description: 'Stone', workAreaId: 'area-a', workAreaName: undefined, unit: 't',
    estimatedQuantity: 2, estimatedUnitCost: 100, estimatedTotalCost: 200,
    actualQuantity: 3, actualUnitCost: 225, actualTotalCost: 675,
    remainingQuantity: -1, quantityVariance: 1, costVariance: 475,
  }]);
  assert.equal(result.categories.find((row) => row.category === 'material').actual, 675);
  assert.equal(materialJob.originalEstimateSnapshot.workAreas[0].lineItems[2].directCostPerUnit, 100);
});

test('material comparisons aggregate repeated purchases by exact Estimate line without crossing Work Areas', () => {
  const materialJob = { id: 'job-a', originalEstimateSnapshot: { subtotal: 1000, workAreas: [
    { id: 'front', name: 'Front', lineItems: [{ id: 'front-stone', category: 'material', materialCatalogItemId: 'stone', itemName: 'Stone', quantity: 10, unit: 't', directCostPerUnit: 20 }] },
    { id: 'back', name: 'Back', lineItems: [{ id: 'back-stone', category: 'material', materialCatalogItemId: 'stone', itemName: 'Stone', quantity: 5, unit: 't', directCostPerUnit: 25 }] },
  ] } };
  const vendorBills = [
    calculateJobBill({ lineItems: [{ estimateMaterialSnapshotId: 'front-stone', materialCatalogItemId: 'stone', description: 'Stone', quantity: 6, unit: 't', unitCost: 22, workAreaId: 'front' }] }, 'vendor'),
    calculateJobBill({ lineItems: [{ estimateMaterialSnapshotId: 'front-stone', materialCatalogItemId: 'stone', description: 'Stone', quantity: 7, unit: 't', unitCost: 24, workAreaId: 'front' }] }, 'vendor'),
  ];
  const result = calculateJobCostAnalysis({ job: materialJob, vendorBills });
  const front = result.materialComparisons.find((row) => row.estimateMaterialSnapshotId === 'front-stone');
  const back = result.materialComparisons.find((row) => row.estimateMaterialSnapshotId === 'back-stone');

  assert.deepEqual({ actualQuantity: front.actualQuantity, actualTotalCost: front.actualTotalCost, remainingQuantity: front.remainingQuantity, costVariance: front.costVariance }, { actualQuantity: 13, actualTotalCost: 300, remainingQuantity: -3, costVariance: 100 });
  assert.deepEqual({ actualQuantity: back.actualQuantity, actualTotalCost: back.actualTotalCost, remainingQuantity: back.remainingQuantity }, { actualQuantity: 0, actualTotalCost: 0, remainingQuantity: 5 });
});

test('bill totals are server calculated and invalid values are rejected', () => {
  const bill = calculateJobBill({ subtotal: 9999, total: 9999, taxRate: 13, lineItems: [{ quantity: 2, unitCost: 10 }] }, 'vendor');
  assert.equal(bill.subtotal, 20); assert.equal(bill.taxAmount, 2.6); assert.equal(bill.total, 22.6);
  assert.throws(() => calculateJobBill({ lineItems: [{ quantity: -1, unitCost: 10 }] }, 'vendor'), /quantity/);
  assert.throws(() => calculateJobBill({ lineItems: [{ quantity: 1, unitCost: -1 }] }, 'vendor'), /unit cost/);
});

test('overhead recovery, revenue/hour, and net profit are unavailable for Jobs priced without overhead-recovery rates', () => {
  const result = calculateJobCostAnalysis({ job });
  assert.equal(result.summary.estimatedOverheadRecovery, null);
  assert.equal(result.summary.overheadRecoveredToDate, null);
  assert.equal(result.summary.estimatedNetProfit, null);
  assert.equal(result.summary.netProfitAfterRecordedCosts, null);
  // Revenue/hour only needs labour hours and revenue, not overhead pricing, so it's still available.
  assert.equal(result.summary.estimatedRevenuePerHour, 500);
});

test('overhead recovery, revenue/hour, and net profit compare the accepted Estimate to work actually delivered', () => {
  const overheadJob = {
    id: 'job-overhead',
    originalEstimateSnapshot: {
      subtotal: 2000,
      workAreas: [{
        id: 'area-a',
        contractRevenue: 2000,
        lineItems: [
          { category: 'labour', quantity: 10, averageLabourCost: 30, overheadRecoveryPerHour: 5 },
          { category: 'equipment', quantity: 5, costRateAtEstimate: 20, divisionOverheadRecoveryPerUnit: 4, companyOverheadRecoveryPerUnit: 1 },
          { category: 'material', quantity: 2, directCostPerUnit: 100 },
          { category: 'subcontractor', plannedCost: 400 },
        ],
      }],
    },
  };
  const timeEntries = [{
    id: 'entry-1', employeeId: 'emp-1', jobIds: ['job-overhead'], workAreaId: 'area-a', workType: 'job', status: 'clocked_out',
    clockIn: '2026-01-01T08:00:00.000Z', clockOut: '2026-01-01T13:00:00.000Z', breakMinutes: 0, labourCostRateSnapshot: 30,
  }];
  const equipmentUsage = [{ workAreaId: 'area-a', cost: 50 }];
  const result = calculateJobCostAnalysis({ job: overheadJob, timeEntries, equipmentUsage });

  // Estimated: 10hr labour @ $5/hr + 5 equipment units @ $5/unit ($4 division + $1 company) = 50 + 25.
  assert.equal(result.summary.estimatedOverheadRecovery, 75);
  // Actual: only half the estimated labour hours (5 of 10) and half the estimated equipment cost
  // ($50 of $100) have been delivered, so only half of each category's estimated recovery is
  // realized: 50*0.5 + 25*0.5 = 37.5. Materials/subcontractors carried no overhead rate at all, so
  // they contribute nothing either way.
  assert.equal(result.summary.overheadRecoveredToDate, 37.5);

  assert.equal(result.summary.estimatedRevenuePerHour, 200); // $2000 / 10 estimated hours
  assert.equal(result.summary.actualRevenuePerHour, 400); // $2000 / 5 actual hours

  // Estimated total cost = 300 + 100 + 200 + 400 = 1000; gross profit 1000; net of $75 overhead = 925.
  assert.equal(result.summary.estimatedGrossProfit, 1000);
  assert.equal(result.summary.estimatedNetProfit, 925);
  assert.ok(Math.abs(result.summary.estimatedNetMargin - 46.25) < 0.001);

  // Actual cost to date = 150 (labour) + 50 (equipment) = 200; gross profit to date 1800; net of
  // $37.50 recovered overhead = 1762.50.
  assert.equal(result.summary.grossProfitAfterRecordedCosts, 1800);
  assert.equal(result.summary.netProfitAfterRecordedCosts, 1762.5);
});

test('overhead recovery is scope-aware and unavailable for the unallocated scope, like the rest of the baseline', () => {
  const overheadJob = {
    id: 'job-overhead-scope',
    originalEstimateSnapshot: {
      subtotal: 1000,
      workAreas: [{ id: 'area-a', contractRevenue: 1000, lineItems: [{ category: 'labour', quantity: 4, averageLabourCost: 30, overheadRecoveryPerHour: 5 }] }],
    },
  };
  const areaScoped = calculateJobCostAnalysis({ job: overheadJob, scopeWorkAreaId: 'area-a' });
  const unallocated = calculateJobCostAnalysis({ job: overheadJob, scopeWorkAreaId: 'unallocated' });
  assert.equal(areaScoped.summary.estimatedOverheadRecovery, 20);
  assert.equal(unallocated.summary.estimatedOverheadRecovery, null);
});

test('Work Area actuals reconcile without duplicating records', () => {
  const bill = calculateJobBill({ taxRate: 10, lineItems: [{ quantity: 1, unitCost: 25, workAreaId: 'area-a' }, { quantity: 1, unitCost: 15 }] }, 'vendor');
  const whole = calculateJobCostAnalysis({ job, vendorBills: [bill] });
  const area = calculateJobCostAnalysis({ job, vendorBills: [bill], scopeWorkAreaId: 'area-a' });
  const unallocated = calculateJobCostAnalysis({ job, vendorBills: [bill], scopeWorkAreaId: 'unallocated' });
  assert.equal(whole.categories[2].actual, 44);
  assert.equal(area.categories[2].actual, 27.5);
  assert.equal(unallocated.categories[2].actual, 16.5);
  assert.equal(whole.categories[2].actual, area.categories[2].actual + unallocated.categories[2].actual);
});