import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateJobPerformance } from '../src/utils/jobPerformanceModel.js';

const job = {
  id: 'job-a', contractValue: 5254.46, currentContractRevenue: 5254.46, actualCosts: [],
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
  assert.equal(result.profit.toDate, null);
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
});

test('variance is actual minus estimated and missing actuals stay unavailable', () => {
  const result = calculate();
  const equipment = result.costs.categories.find((row) => row.category === 'equipment');
  const subcontractor = result.costs.categories.find((row) => row.category === 'subcontractor');
  assert.equal(equipment.variance, -310);
  assert.equal(subcontractor.variance, null);
  assert.match(result.costs.varianceConvention, /Actual minus estimated/);
});
