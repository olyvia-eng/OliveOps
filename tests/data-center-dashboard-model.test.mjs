import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterDataCenterRecords,
  getDataCenterDateRange,
  getTimeEntryHours,
} from '../src/pages/department-dashboards/dataCenterDashboardModel.js';

const now = new Date('2026-08-15T12:00:00');
const divisions = [
  { id: 'excavation', name: 'Excavation', normalizedName: 'excavation' },
  { id: 'landscaping', name: 'Landscaping', normalizedName: 'landscaping' },
];
const budgets = [
  { id: 'budget-ex', division: 'Excavation' },
  { id: 'budget-land', division: 'landscaping' },
];
const jobs = [
  { id: 'job-ex', customerId: 'customer-ex', pricingBudgetId: 'budget-ex', divisionId: 'excavation', status: 'completed', startDate: '2026-08-03', endDate: '2026-08-05', assignedEquipmentIds: ['equipment-ex'] },
  { id: 'job-land', customerId: 'customer-land', pricingBudgetId: 'budget-land', divisionId: 'landscaping', status: 'in_progress', startDate: '2026-08-10', endDate: '2026-08-20', assignedEquipmentIds: ['equipment-land'] },
  { id: 'job-old', customerId: 'customer-ex', pricingBudgetId: 'budget-ex', divisionId: 'excavation', status: 'completed', startDate: '2025-04-01', assignedEquipmentIds: ['equipment-old'] },
];

test('date presets use local inclusive windows with exclusive ends', () => {
  assert.deepEqual(getDataCenterDateRange('month', now), {
    start: new Date('2026-08-01T00:00:00'),
    end: new Date('2026-09-01T00:00:00'),
  });
  assert.deepEqual(getDataCenterDateRange('quarter', now), {
    start: new Date('2026-07-01T00:00:00'),
    end: new Date('2026-10-01T00:00:00'),
  });
  assert.deepEqual(getDataCenterDateRange('last_year', now), {
    start: new Date('2025-01-01T00:00:00'),
    end: new Date('2026-01-01T00:00:00'),
  });
  assert.deepEqual(getDataCenterDateRange('custom', now, '2026-08-03', '2026-08-05'), {
    start: new Date('2026-08-03T00:00:00'),
    end: new Date('2026-08-06T00:00:00'),
  });
});

test('one division and date filter scopes every dashboard entity', () => {
  const records = filterDataCenterRecords({
    divisionId: 'excavation',
    range: getDataCenterDateRange('month', now),
    divisions,
    budgets,
    jobs,
    customers: [
      { id: 'customer-ex', createdAt: '2024-01-01' },
      { id: 'customer-land', createdAt: '2026-08-01' },
    ],
    estimates: [
      { id: 'estimate-ex', customerId: 'customer-ex', pricingBudgetId: 'budget-ex', createdAt: '2026-08-02' },
      { id: 'estimate-land', customerId: 'customer-land', pricingBudgetId: 'budget-land', createdAt: '2026-08-02' },
    ],
    invoices: [
      { id: 'invoice-ex', jobId: 'job-ex', customerId: 'customer-ex', issueDate: '2026-08-06' },
      { id: 'invoice-old-job', jobId: 'job-old', customerId: 'customer-ex', issueDate: '2026-08-08' },
      { id: 'invoice-land', jobId: 'job-land', customerId: 'customer-land', issueDate: '2026-08-06' },
    ],
    expenses: [
      { id: 'expense-ex', jobId: 'job-ex', expenseDate: '2026-08-07' },
      { id: 'expense-land', jobId: 'job-land', expenseDate: '2026-08-07' },
    ],
    employees: [{ id: 'employee-ex' }, { id: 'employee-land' }],
    timeEntries: [
      { id: 'time-ex', employeeId: 'employee-ex', jobId: 'job-ex', clockIn: '2026-08-04T08:00:00', clockOut: '2026-08-04T16:00:00', breakMinutes: 30 },
      { id: 'time-land', employeeId: 'employee-land', jobId: 'job-land', clockIn: '2026-08-11T08:00:00', clockOut: '2026-08-11T16:00:00', breakMinutes: 30 },
    ],
    equipmentAssets: [{ id: 'equipment-ex' }, { id: 'equipment-land' }, { id: 'equipment-old' }],
  });

  assert.deepEqual(records.jobs.map(({ id }) => id), ['job-ex']);
  assert.deepEqual(records.estimates.map(({ id }) => id), ['estimate-ex']);
  assert.deepEqual(records.invoices.map(({ id }) => id), ['invoice-ex', 'invoice-old-job']);
  assert.deepEqual(records.expenses.map(({ id }) => id), ['expense-ex']);
  assert.deepEqual(records.timeEntries.map(({ id }) => id), ['time-ex']);
  assert.deepEqual(records.employees.map(({ id }) => id), ['employee-ex']);
  assert.deepEqual(records.equipmentAssets.map(({ id }) => id), ['equipment-ex']);
  assert.deepEqual(records.customers.map(({ id }) => id), ['customer-ex']);
});

test('labour hours are clipped to the selected date range', () => {
  const range = getDataCenterDateRange('custom', now, '2026-08-03', '2026-08-03');
  const hours = getTimeEntryHours({
    clockIn: '2026-08-02T22:00:00',
    clockOut: '2026-08-03T05:00:00',
    breakMinutes: 0,
  }, range, now);
  assert.equal(hours, 5);
});
