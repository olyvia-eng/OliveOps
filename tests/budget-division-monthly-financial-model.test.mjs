import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateDivisionFinancialPeriods,
  buildBudgetMonthPeriods,
  calculateDivisionMonthlyFinancials,
  compareDivisionFinancialPeriods,
} from '../src/pages/budget/divisionMonthlyFinancialModel.js';

const budget = { id: 'budget-a', fiscalYear: '2027', startDate: '2027-01-01', endDate: '2027-12-31' };
const jobs = [
  {
    id: 'job-hardscape', pricingBudgetId: 'budget-a', divisionId: 'hardscape', actualCosts: [
      { category: 'labour', date: '2027-05-15', total: 25000 },
      { category: 'material', date: '2027-05-16', total: 9000 },
      { category: 'material', date: '2027-06-16', total: 10000 },
      { category: 'subcontractor', date: '2027-06-17', total: 5000 },
    ],
  },
  { id: 'job-snow', pricingBudgetId: 'budget-a', divisionId: 'snow', actualCosts: [{ category: 'material', date: '2027-06-16', total: 99999 }] },
  { id: 'job-other-budget', pricingBudgetId: 'budget-b', divisionId: 'hardscape', actualCosts: [{ category: 'material', date: '2027-06-16', total: 88888 }] },
];
const invoices = [
  { jobId: 'job-hardscape', status: 'paid', issueDate: '2027-05-20', amount: 78000 },
  { jobId: 'job-hardscape', status: 'sent', issueDate: '2027-06-20', amount: 92000 },
  { jobId: 'job-hardscape', status: 'draft', issueDate: '2027-06-21', amount: 50000 },
  { jobId: 'job-hardscape', status: 'void', issueDate: '2027-06-22', amount: 60000 },
  { jobId: 'job-snow', status: 'paid', issueDate: '2027-06-20', amount: 77777 },
];
const timeEntries = [
  { employeeId: 'employee-a', jobId: 'job-hardscape', workType: 'job', clockIn: '2027-06-10T08:00:00.000Z', clockOut: '2027-06-10T18:00:00.000Z', breakMinutes: 0 },
  { employeeId: 'employee-a', jobIds: ['job-hardscape', 'job-snow'], workType: 'job', clockIn: '2027-06-11T08:00:00.000Z', clockOut: '2027-06-11T12:00:00.000Z', breakMinutes: 0 },
];
const employees = [{ id: 'employee-a', hourlyRate: 30 }];
const expenses = [
  { jobId: 'job-hardscape', category: 'equipment', status: 'paid', expenseDate: '2027-05-10', amount: 7000 },
  { jobId: 'job-hardscape', category: 'equipment', status: 'approved', expenseDate: '2027-06-10', amount: 8000 },
  { jobId: 'job-hardscape', category: 'overhead', status: 'paid', expenseDate: '2027-05-12', amount: 4000 },
  { jobId: 'job-hardscape', category: 'overhead', status: 'paid', expenseDate: '2027-06-12', amount: 5000 },
  { jobId: 'job-snow', category: 'overhead', status: 'paid', expenseDate: '2027-06-12', amount: 99999 },
];

const result = calculateDivisionMonthlyFinancials({ budget, divisionId: 'hardscape', jobs, invoices, timeEntries, employees, expenses });
const may = result.months.find((month) => month.key === '2027-05');
const june = result.months.find((month) => month.key === '2027-06');

test('selected month actuals use invoices, recorded costs, time entries, and linked expenses without Division leakage', () => {
  assert.equal(june.revenue, 92000);
  assert.equal(june.labourCost, 360);
  assert.equal(june.equipmentCost, 8000);
  assert.equal(june.materialCost, 10000);
  assert.equal(june.subcontractorCost, 5000);
  assert.equal(june.overhead, 5000);
  assert.equal(june.netProfit, 63640);
  assert.equal(june.netProfitMargin, 63640 / 92000 * 100);
});

test('previous month and margin variance use May and percentage points', () => {
  const change = compareDivisionFinancialPeriods(june, may);
  assert.equal(may.revenue, 78000);
  assert.equal(may.labourCost, 25000);
  assert.equal(change.revenue, (92000 - 78000) / 78000 * 100);
  assert.equal(change.netProfitMargin, june.netProfitMargin - may.netProfitMargin);
});

test('YTD aggregates the same monthly values used by table and trends', () => {
  const juneIndex = result.months.indexOf(june);
  const ytd = aggregateDivisionFinancialPeriods(result.months, juneIndex);
  assert.equal(ytd.revenue, result.months.slice(0, juneIndex + 1).reduce((sum, month) => sum + month.revenue, 0));
  assert.equal(ytd.labourCost, result.months.slice(0, juneIndex + 1).reduce((sum, month) => sum + month.labourCost, 0));
  assert.equal(ytd.netProfit, may.netProfit + june.netProfit);
  assert.equal(ytd.netProfitMargin, ytd.netProfit / ytd.revenue * 100);
});

test('January previous period is absent for calendar Budgets and December is used when the Budget begins in December', () => {
  const january = result.months[0];
  assert.equal(january.key, '2027-01');
  assert.equal(compareDivisionFinancialPeriods(january, null).revenue, null);

  const crossYearBudget = { ...budget, startDate: '2026-12-31', endDate: '2027-12-30' };
  const periods = buildBudgetMonthPeriods(crossYearBudget);
  assert.equal(periods.length, 13);
  assert.deepEqual(periods.slice(0, 2).map((period) => [period.key, period.startDate, period.endDate]), [
    ['2026-12', '2026-12-31', '2026-12-31'],
    ['2027-01', '2027-01-01', '2027-01-31'],
  ]);
  assert.equal(periods[0].tabLabel, 'Dec 2026');
  assert.equal(periods.at(-1).tabLabel, 'Dec 2027');

  const clipped = calculateDivisionMonthlyFinancials({
    budget: crossYearBudget,
    divisionId: 'hardscape',
    jobs,
    invoices: [{ jobId: 'job-hardscape', status: 'paid', issueDate: '2026-12-01', amount: 999 }, { jobId: 'job-hardscape', status: 'paid', issueDate: '2026-12-31', amount: 100 }],
    timeEntries: [],
    employees,
    expenses: [],
  });
  assert.equal(clipped.months[0].revenue, 100);
});

test('unavailable Division overhead is not fabricated and blocks Net Profit', () => {
  const withoutOverhead = calculateDivisionMonthlyFinancials({ budget, divisionId: 'hardscape', jobs, invoices, timeEntries, employees, expenses: [] });
  const month = withoutOverhead.months.find((value) => value.key === '2027-06');
  assert.equal(withoutOverhead.sourceStatus.overhead.availability, 'unavailable');
  assert.equal(month.overhead, null);
  assert.equal(month.netProfit, null);
  assert.equal(month.netProfitMargin, null);
});

test('changing Division produces an isolated monthly series', () => {
  const snow = calculateDivisionMonthlyFinancials({ budget, divisionId: 'snow', jobs, invoices, timeEntries, employees, expenses });
  const snowJune = snow.months.find((month) => month.key === '2027-06');
  assert.equal(snowJune.revenue, 77777);
  assert.equal(snowJune.materialCost, 99999);
  assert.equal(snowJune.overhead, 99999);
  assert.notEqual(snowJune.revenue, june.revenue);
});

test('draft and void invoices are excluded from recognized Budget revenue', () => {
  assert.equal(june.revenue, 92000);
});