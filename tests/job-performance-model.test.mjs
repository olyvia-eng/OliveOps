import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateJobPerformance } from '../src/utils/jobPerformanceModel.js';

const job = {
  id: 'job-a', contractValue: 5254.46, currentContractRevenue: 5254.46, actualCosts: [],
  originalEstimateSnapshot: {
    subtotal: 5254.46,
    taxRate: 13,
    taxAmount: 683.0798,
    total: 5937.5398,
    estimatedCost: 3460,
    estimatedProfit: 1794.46,
    estimatedMarginPct: 34.1509,
    workAreas: [
      { id: 'area-a', name: 'Excavation', estimatedRevenue: 3000, lineItems: [
        { id: 'snapshot-labour-a', category: 'labour', description: 'Labour', quantity: 50, unit: 'hr', unitCost: 47.2, plannedCost: 2360 },
        { id: 'snapshot-material-a', category: 'material', description: 'Stone', quantity: 2, unit: 't', unitCost: 200, plannedCost: 400 },
      ] },
      { id: 'area-b', name: 'Grading', estimatedRevenue: 2254.46, lineItems: [
        { id: 'snapshot-equipment-b', category: 'equipment', description: 'Excavator', quantity: 5, unit: 'hr', unitCost: 80, plannedCost: 400 },
        { id: 'snapshot-sub-b', category: 'subcontractor', description: 'Hauling', quantity: 1, unit: 'job', unitCost: 300, plannedCost: 300 },
      ] },
    ],
  },
  operationalWorkAreas: [
    { id: 'area-a', name: 'Excavation', contractRevenue: 3000, lineItems: [
      { id: 'labour-a', category: 'labour', description: 'Labour', quantity: 50, unit: 'hr', unitCost: 47.2, plannedCost: 2360 },
      { id: 'material-a', category: 'material', description: 'Stone', quantity: 2, unit: 't', unitCost: 200, plannedCost: 400 },
    ] },
    { id: 'area-b', name: 'Grading', contractRevenue: 2254.46, lineItems: [
      { id: 'equipment-b', category: 'equipment', description: 'Excavator', quantity: 5, unit: 'hr', unitCost: 80, plannedCost: 400 },
      { id: 'sub-b', category: 'subcontractor', description: 'Hauling', quantity: 1, unit: 'job', unitCost: 300, plannedCost: 300 },
    ] },
  ],
};

const employee = { id: 'salary', name: 'Salary Employee', compensationType: 'salary', hourlyRate: 83200, payrollBurdenPct: 18, benefitsExtraCost: 0, bonus: 0 };
const entries = [
  { id: 'area-time', employeeId: 'salary', workType: 'job', jobIds: ['job-a'], workAreaId: 'area-a', clockIn: '2026-09-03T08:00:00.000Z', clockOut: '2026-09-03T19:22:12.000Z', breakMinutes: 0, status: 'clocked_out' },
  { id: 'unallocated-time', employeeId: 'salary', workType: 'job', jobIds: ['job-a', 'job-b'], clockIn: '2026-09-04T08:00:00.000Z', clockOut: '2026-09-04T10:00:00.000Z', breakMinutes: 0, status: 'clocked_out', labourCostTotalSnapshot: 100 },
  { id: 'open', employeeId: 'salary', workType: 'job', jobId: 'job-a', clockIn: '2026-09-04T11:00:00.000Z', status: 'clocked_in' },
  { id: 'drive', employeeId: 'salary', workType: 'drive_time', jobId: 'job-a', clockIn: '2026-09-04T11:00:00.000Z', clockOut: '2026-09-04T12:00:00.000Z', status: 'clocked_out' },
];

const invoices = [
  { id: 'issued', jobId: 'job-a', status: 'sent', subtotal: 1000, amount: 1130, taxAmount: 130 },
  { id: 'draft', jobId: 'job-a', status: 'draft', subtotal: 500, amount: 565, taxAmount: 65 },
  { id: 'void', jobId: 'job-a', status: 'void', subtotal: 700, amount: 791, taxAmount: 91 },
];
const expenses = [
  { id: 'material-expense', jobId: 'job-a', status: 'paid', category: 'materials', amount: 250, vendor: 'Stone Co', description: 'Stone', expenseDate: '2026-09-03' },
  { id: 'equipment-expense', jobId: 'job-a', status: 'approved', category: 'equipment', amount: 90, vendor: 'Rental Co', description: 'Rental', expenseDate: '2026-09-03' },
  { id: 'pending-sub', jobId: 'job-a', status: 'pending', category: 'subcontractor', amount: 800, vendor: 'Sub Co', description: 'Pending', expenseDate: '2026-09-03' },
  { id: 'overhead', jobId: 'job-a', status: 'paid', category: 'overhead', amount: 75, vendor: 'Permit Office', description: 'Job overhead', expenseDate: '2026-09-03' },
  { id: 'other-job', jobId: 'job-b', status: 'paid', category: 'materials', amount: 9999, vendor: 'Wrong Job', description: 'Excluded', expenseDate: '2026-09-03' },
];

const calculate = (overrides = {}) => calculateJobPerformance({ job, employees: [employee], timeEntries: entries, invoices, expenses, ...overrides });

test('shared Job performance reconciles salary labour, tax-exclusive issued revenue, and known costs', () => {
  const result = calculate();
  assert.equal(result.revenue.contract, 5254.46);
  assert.equal(result.revenue.issued, 1000);
  assert.equal(result.labour.estimated.hours, 50);
  assert.ok(Math.abs(result.labour.actual.hours - 12.37) < 0.000001);
  assert.ok(Math.abs(result.costs.categories[0].actualCost - (11.37 * 47.2 + 50)) < 0.000001);
  assert.equal(result.costs.categories.find((row) => row.category === 'material').actualCost, 250);
  assert.equal(result.costs.categories.find((row) => row.category === 'equipment').actualCost, 90);
  assert.equal(result.costs.categories.find((row) => row.category === 'subcontractor').actualCost, null);
  assert.equal(result.costs.actualOverhead, 75);
  assert.equal(result.costs.actualDirectComplete, false);
  assert.equal(result.labour.unbillable.hours, 1);
  assert.ok(Math.abs(result.labour.unbillable.cost - 47.2) < 0.000001);
  assert.equal(result.profit.toDate, result.revenue.contract - result.economics.knownActualCost);
  assert.match(result.profit.unavailableReason, /Incomplete actual cost/);
  assert.ok(result.details.some((item) => item.id === 'expense:material-expense' && item.actualCost === 250));
});

test('recorded category costs take precedence over expenses without double counting', () => {
  const result = calculate({ job: { ...job, actualCosts: [{ id: 'recorded-material', category: 'material', total: 300 }] } });
  const material = result.costs.categories.find((row) => row.category === 'material');
  assert.equal(material.actualCost, 300);
  assert.equal(material.source, 'recorded-job-cost');
  assert.equal(result.expenses.find((expense) => expense.id === 'material-expense').countedInActuals, false);
  assert.equal(result.details.filter((item) => item.actualCost === 300).length, 1);
});

test('recorded labour is a fallback only when eligible time-entry labour is absent', () => {
  const recorded = { ...job, actualCosts: [{ id: 'recorded-labour', category: 'labour', total: 600, description: 'Imported payroll' }] };
  assert.notEqual(calculate({ job: recorded }).costs.categories[0].actualCost, 600);
  const withoutEntries = calculate({ job: recorded, timeEntries: [] });
  assert.equal(withoutEntries.costs.categories[0].actualCost, 600);
  assert.equal(withoutEntries.costs.categories[0].source, 'recorded-job-cost');
});

test('Work Area and unallocated scopes reconcile labour without assigning unlinked costs', () => {
  const area = calculate({ scopeWorkAreaId: 'area-a' });
  const unallocated = calculate({ scopeWorkAreaId: 'unallocated' });
  const entire = calculate();

  assert.ok(Math.abs(area.labour.actual.hours - 11.37) < 0.000001);
  assert.equal(unallocated.labour.actual.hours, 1);
  assert.ok(Math.abs(entire.labour.actual.hours - (area.labour.actual.hours + unallocated.labour.actual.hours)) < 0.000001);
  assert.equal(area.costs.categories.find((row) => row.category === 'material').actualCost, null);
  assert.equal(unallocated.costs.categories.find((row) => row.category === 'material').actualCost, 250);
  assert.equal(area.labour.scheduled.hoursAvailable, false);
  assert.match(area.labour.scheduled.unavailableReason, /not linked to individual Work Areas/);
  assert.ok(Math.abs(entire.costs.knownActualDirect - (area.costs.knownActualDirect + unallocated.costs.knownActualDirect)) < 0.000001);
});

test('Work Area baseline follows immutable source lineage when operational IDs change', () => {
  const remappedJob = {
    ...job,
    operationalWorkAreas: job.operationalWorkAreas.map((area) => area.id === 'area-a'
      ? { ...area, id: 'operational-area-a', sourceEstimateWorkAreaId: 'estimate-area-a' }
      : area),
    originalEstimateSnapshot: {
      ...job.originalEstimateSnapshot,
      workAreas: job.originalEstimateSnapshot.workAreas.map((area) => area.id === 'area-a'
        ? { ...area, sourceEstimateWorkAreaId: 'estimate-area-a' }
        : area),
    },
  };
  const remappedEntries = entries.map((entry) => entry.workAreaId === 'area-a' ? { ...entry, workAreaId: 'operational-area-a' } : entry);
  const area = calculate({ job: remappedJob, timeEntries: remappedEntries, scopeWorkAreaId: 'operational-area-a' });
  assert.equal(area.revenue.contract, 3000);
  assert.equal(area.costs.estimatedDirect, 2760);
  assert.ok(Math.abs(area.labour.actual.hours - 11.37) < 0.000001);
});

test('variance is actual minus estimated and missing actuals stay unavailable', () => {
  const result = calculate();
  const equipment = result.costs.categories.find((row) => row.category === 'equipment');
  const subcontractor = result.costs.categories.find((row) => row.category === 'subcontractor');
  assert.equal(equipment.variance, -310);
  assert.equal(subcontractor.variance, null);
  assert.match(result.costs.varianceConvention, /Actual minus estimated/);
});

test('accepted Estimate snapshot remains the immutable Job economics baseline', () => {
  const result = calculate({
    job: {
      ...job,
      currentContractRevenue: 999999,
      operationalWorkAreas: job.operationalWorkAreas.map((area) => ({ ...area, lineItems: area.lineItems.map((line) => ({ ...line, plannedCost: 999999 })) })),
    },
  });
  assert.equal(result.baseline.source, 'accepted-estimate-snapshot');
  assert.equal(result.revenue.contract, 5254.46);
  assert.notEqual(result.revenue.contract, job.originalEstimateSnapshot.total);
  assert.equal(result.costs.estimatedDirect, 3460);
  assert.equal(result.profit.estimatedGross, 1794.46);
  assert.equal(result.economics.estimatedChartSegments.reduce((total, item) => total + item.amount, 0), 5254.46);
});

test('summary and chart share category values and percentages reconcile to pre-tax contract revenue', () => {
  const result = calculate();
  for (const row of result.costs.categories) {
    const segment = result.economics.estimatedChartSegments.find((item) => item.key === row.category);
    assert.equal(segment.amount, row.estimatedCost);
    assert.equal(segment.percent, row.estimatedCost / result.revenue.contract * 100);
  }
  assert.equal(result.economics.estimatedChartSegments.reduce((total, segment) => total + segment.amount, 0), result.revenue.contract);
});

test('active under-estimate, active over-estimate, completed, and incomplete Jobs have honest status', () => {
  const completeActualCosts = [
    { id: 'material', category: 'material', total: 250 },
    { id: 'equipment', category: 'equipment', total: 90 },
    { id: 'subcontractor', category: 'subcontractor', total: 100 },
  ];
  const completeExpenses = [...expenses, { id: 'complete-overhead', jobId: 'job-a', status: 'paid', category: 'overhead', amount: 75 }];
  const activeUnder = calculate({ job: { ...job, status: 'in_progress', actualCosts: completeActualCosts }, expenses: completeExpenses });
  assert.equal(activeUnder.economics.actualCostComplete, true);
  assert.match(activeUnder.economics.statusMessage, /% of the estimated cost has been used/);

  const activeOver = calculate({ job: { ...job, status: 'in_progress', actualCosts: completeActualCosts.map((cost) => ({ ...cost, total: 2000 })) }, expenses: completeExpenses });
  assert.match(activeOver.economics.statusMessage, /^This Job is currently \$[\d.]+ over its total estimated cost\.$/);

  const completed = calculate({ job: { ...job, status: 'completed', actualCosts: completeActualCosts }, expenses: completeExpenses });
  assert.equal(completed.economics.knownActualCost, activeUnder.economics.knownActualCost);
  assert.equal(completed.economics.marginAfterRecordedCosts, activeUnder.economics.marginAfterRecordedCosts);

  const incomplete = calculate();
  assert.equal(incomplete.economics.actualCostComplete, false);
  assert.match(incomplete.economics.statusMessage, /Actual cost data is incomplete/);
  assert.ok(incomplete.costs.unavailableCategories.includes('Subcontractors'));
});

test('distribution never creates negative slices and summary values reconcile', () => {
  const result = calculate({
    job: { ...job, actualCosts: [{ id: 'material', category: 'material', total: 7000 }, { id: 'equipment', category: 'equipment', total: 1000 }, { id: 'sub', category: 'subcontractor', total: 500 }] },
    expenses: [...expenses, { id: 'large-overhead', jobId: 'job-a', status: 'paid', category: 'overhead', amount: 1000 }],
  });
  assert.ok(result.economics.actualChartSegments.every((segment) => segment.amount >= 0));
  assert.equal(result.economics.actualChartSegments.some((segment) => segment.key === 'unspent'), false);
  assert.ok(result.economics.overContractAmount > 0);
  assert.equal(result.economics.marginAfterRecordedCosts, result.revenue.contract - result.economics.knownActualCost);
});

test('Jobs without accepted Estimate snapshots expose no historical estimate', () => {
  const manualJob = { ...job, originalEstimateSnapshot: undefined };
  const result = calculate({ job: manualJob });
  assert.equal(result.baseline.available, false);
  assert.equal(result.costs.estimatedDirect, null);
  assert.equal(result.profit.estimatedGross, null);
  assert.deepEqual(result.economics.estimatedChartSegments, []);
  assert.equal(result.economics.forecastProfit, null);
  assert.match(result.economics.forecastUnavailableReason, /Forecast unavailable until sufficient actual cost information is recorded/);
});

test('accepted Estimate sell values are never substituted for internal cost', () => {
  const snapshotJob = structuredClone(job);
  snapshotJob.originalEstimateSnapshot.workAreas[0].lineItems = [{
    id: 'sell-only-material', category: 'material', description: 'Stone', quantity: 2,
    unitPrice: 900, sellPrice: 1800, total: 1800,
  }];
  const result = calculate({ job: snapshotJob, timeEntries: [], expenses: [], invoices: [] });
  const material = result.costs.categories.find((row) => row.category === 'material');
  assert.equal(material.estimatedCost, null);
  assert.equal(result.costs.estimatedDirect, null);
  assert.equal(result.profit.estimatedGross, null);
  assert.equal(result.baseline.available, false);
  assert.equal(result.economics.contractValueChartSegments.find((segment) => segment.key === 'material').amount, 1800);
  assert.equal(result.economics.estimatedChartSegments.find((segment) => segment.key === 'material').amount, 0);
});

test('ambiguous historical cost fields remain unavailable without an immutable cost snapshot', () => {
  const snapshotJob = structuredClone(job);
  snapshotJob.originalEstimateSnapshot.workAreas[0].lineItems = [{
    id: 'ambiguous-material', category: 'material', description: 'Stone', quantity: 2,
    unitCost: 200, estimatedCost: 400,
  }];
  const result = calculate({ job: snapshotJob, timeEntries: [], expenses: [], invoices: [] });
  const material = result.costs.categories.find((row) => row.category === 'material');
  assert.equal(material.estimatedCost, null);
  assert.match(result.baseline.unavailableReason, /historical.*cost/i);
});

test('partial actual costs graph supported categories and identify unavailable categories', () => {
  const result = calculate({
    timeEntries: [],
    expenses: [{ id: 'material-only', jobId: 'job-a', status: 'paid', category: 'materials', amount: 275 }],
    invoices: [],
  });
  assert.equal(result.economics.actualChartSegments.find((segment) => segment.key === 'material').amount, 275);
  assert.ok(result.costs.unavailableCategories.includes('Equipment'));
  assert.ok(result.costs.unavailableCategories.includes('Subcontractors'));
});

test('missing estimated cost never becomes zero variance', () => {
  const snapshotJob = structuredClone(job);
  snapshotJob.originalEstimateSnapshot.workAreas[0].lineItems = [{
    id: 'sell-only-material', category: 'material', quantity: 1, contractRevenue: 500,
  }];
  const result = calculate({ job: snapshotJob, timeEntries: [], expenses: [{ id: 'actual-material', jobId: 'job-a', status: 'paid', category: 'materials', amount: 650 }] });
  const material = result.costs.categories.find((row) => row.category === 'material');
  assert.equal(material.estimatedCost, null);
  assert.equal(material.actualCost, 650);
  assert.equal(material.variance, null);
  assert.ok(result.costs.varianceUnavailableCategories.includes('Materials'));
});
