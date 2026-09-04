import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateJobLabourSummary } from '../src/utils/jobLabourSummary.js';

const job = {
  id: 'job-a',
  contractValue: 5000,
  operationalWorkAreas: [{
    lineItems: [
      { category: 'labour', labourClassId: 'labourer', labourClassName: 'Labourer', quantity: 20, averageLabourCost: 29.5, estimatedCost: 590, estimatedSell: 1360, total: 1360 },
      { category: 'labour', labourClassId: 'foreman', labourClassName: 'Foreman', quantity: 8, averageLabourCost: 47.125, estimatedCost: 377, estimatedSell: 688, total: 688 },
      { category: 'equipment', quantity: 8, estimatedCost: 100, total: 200 },
    ],
  }],
  scheduleOccurrences: [
    { id: 'monday', scheduleAllDay: false, scheduledStartAt: '2026-08-24T08:00:00.000Z', scheduledEndAt: '2026-08-24T16:00:00.000Z', assignedEmployeeIds: ['john', 'mike', 'unassigned'] },
    { id: 'tuesday', scheduleAllDay: false, scheduledStartAt: '2026-08-25T08:00:00.000Z', scheduledEndAt: '2026-08-25T14:00:00.000Z', assignedEmployeeIds: ['john', 'matt'] },
  ],
};

const employees = [
  { id: 'john', name: 'John Smith', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 20, payrollBurdenPct: 18, benefitsExtraCost: 0, bonus: 0 },
  { id: 'mike', name: 'Mike White', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 40, payrollBurdenPct: 18, benefitsExtraCost: 0, bonus: 0 },
  { id: 'matt', name: 'Matt Jones', labourClassId: 'foreman', compensationType: 'salary', hourlyRate: 83200, payrollBurdenPct: 18, benefitsExtraCost: 0, bonus: 0 },
  { id: 'unassigned', name: 'No Class', compensationType: 'hourly', hourlyRate: 10, payrollBurdenPct: 0, benefitsExtraCost: 0, bonus: 0 },
];
const labourClasses = [{ id: 'labourer', name: 'Labourer' }, { id: 'foreman', name: 'Foreman' }];

test('Job labour summary separates estimated class snapshots from scheduled employee-hours and costs', () => {
  const summary = calculateJobLabourSummary({ job, employees, labourClasses });

  assert.deepEqual(summary.estimated, { hours: 28, cost: 967, revenue: 2048, hasData: true, hoursAvailable: true, costAvailable: true });
  assert.equal(summary.scheduled.hours, 36);
  assert.ok(Math.abs(summary.scheduled.cost - (14 * 23.6 + 8 * 47.2 + 6 * 47.2 + 8 * 10)) < 0.000001);
  assert.equal(summary.variance.scheduledVsEstimated.hours, 8);
  assert.ok(Math.abs(summary.variance.scheduledVsEstimated.cost - (summary.scheduled.cost - 967)) < 0.000001);
  assert.equal(job.contractValue, 5000);

  const labourer = summary.byLabourClass.find((row) => row.id === 'labourer');
  assert.deepEqual([labourer.estimatedHours, labourer.scheduledHours], [20, 22]);
  assert.equal(summary.byLabourClass.find((row) => row.id === 'unassigned').scheduledHours, 8);
  assert.deepEqual(summary.scheduledEmployees.map((row) => [row.employeeName, row.hours]), [
    ['John Smith', 14], ['Matt Jones', 6], ['Mike White', 8], ['No Class', 8],
  ]);
});

test('actual labour includes closed Job entries, approved corrections, shared Job allocation, and snapshot costs', () => {
  const timeEntries = [
    { id: 'snapshot', employeeId: 'john', workType: 'job', jobId: 'job-a', jobIds: ['job-a'], clockIn: '2026-08-24T08:00:00.000Z', clockOut: '2026-08-24T17:00:00.000Z', breakMinutes: 0, status: 'clocked_out', labourCostRateSnapshot: 21 },
    { id: 'shared', employeeId: 'mike', workType: 'job', jobIds: ['job-a', 'job-b'], clockIn: '2026-08-24T08:00:00.000Z', clockOut: '2026-08-24T16:00:00.000Z', breakMinutes: 0, status: 'clocked_out', labourCostTotalSnapshot: 400 },
    { id: 'corrected', employeeId: 'matt', workType: 'job', jobId: 'wrong-job', jobIds: ['wrong-job'], clockIn: '2026-08-25T08:00:00.000Z', clockOut: '2026-08-25T12:00:00.000Z', breakMinutes: 0, status: 'clocked_out' },
    { id: 'open', employeeId: 'john', workType: 'job', jobId: 'job-a', clockIn: '2026-08-26T08:00:00.000Z', breakMinutes: 0, status: 'clocked_in' },
    { id: 'drive', employeeId: 'john', workType: 'drive_time', jobId: 'job-a', clockIn: '2026-08-26T08:00:00.000Z', clockOut: '2026-08-26T09:00:00.000Z', breakMinutes: 0, status: 'clocked_out' },
  ];
  const timeCorrections = [{ id: 'correction', timeEntryId: 'corrected', status: 'approved', requestedJobId: 'job-a', requestedClockOutAt: '2026-08-25T13:00:00.000Z', reviewedAt: '2026-08-26T00:00:00.000Z' }];
  const summary = calculateJobLabourSummary({ job, employees, labourClasses, timeEntries, timeCorrections });

  assert.equal(summary.actual.hours, 18);
  assert.equal(summary.actual.cost, 9 * 21 + 200 + 5 * 47.2);
  assert.equal(summary.variance.actualVsEstimated.hours, -10);
  assert.equal(summary.variance.actualVsScheduled.hours, -18);

  const changedEmployees = employees.map((employee) => ({ ...employee, hourlyRate: employee.hourlyRate * 2 }));
  const changed = calculateJobLabourSummary({ job, employees: changedEmployees, labourClasses, timeEntries, timeCorrections });
  assert.equal(changed.actualEmployees.find((row) => row.employeeId === 'john').cost, 189);
  assert.equal(changed.actualEmployees.find((row) => row.employeeId === 'mike').cost, 200);
});

test('missing schedule duration and missing employee cost remain unavailable rather than misleading zero', () => {
  const summary = calculateJobLabourSummary({
    job: { ...job, scheduleOccurrences: [{ id: 'all-day', scheduleAllDay: true, assignedEmployeeIds: ['missing'] }] },
    employees,
    labourClasses,
  });
  assert.equal(summary.scheduled.cost, null);
  assert.equal(summary.scheduled.hoursAvailable, false);
  assert.equal(summary.variance.scheduledVsEstimated.hours, null);
  assert.equal(summary.scheduled.costAvailable, false);
  assert.match(summary.scheduled.unavailableReason, /duration is unavailable/);
  assert.deepEqual(summary.actual, { hours: 0, cost: 0, hasData: false, hoursAvailable: true, costAvailable: true });
});

test('invalid or missing current compensation makes fallback cost unavailable', () => {
  const entry = { id: 'missing-rate', employeeId: 'missing-rate', workType: 'job', jobId: 'job-a', clockIn: '2026-08-24T08:00:00.000Z', clockOut: '2026-08-24T10:00:00.000Z', breakMinutes: 0, status: 'clocked_out' };
  for (const hourlyRate of [undefined, Number.NaN, -10, 0]) {
    const summary = calculateJobLabourSummary({
      job,
      employees: [{ id: 'missing-rate', name: 'Missing Rate', compensationType: 'hourly', hourlyRate }],
      labourClasses,
      timeEntries: [entry],
    });
    assert.equal(summary.actual.hours, 2);
    assert.equal(summary.actual.cost, null);
    assert.equal(summary.actual.costAvailable, false);
  }
});

test('legacy Jobs without occurrences use their top-level schedule and Employee assignments', () => {
  const legacyJob = {
    ...job,
    scheduleOccurrences: undefined,
    scheduleConfirmed: true,
    scheduleAllDay: false,
    scheduledStartAt: '2026-08-24T08:00:00.000Z',
    scheduledEndAt: '2026-08-24T16:00:00.000Z',
    assignedEmployeeIds: ['john'],
  };
  const summary = calculateJobLabourSummary({ job: legacyJob, employees, labourClasses });

  assert.equal(summary.scheduled.hours, 8);
  assert.equal(summary.scheduled.cost, 8 * 23.6);
  assert.deepEqual(summary.scheduledEmployees.map((row) => row.employeeId), ['john']);
});

test('reported Job shape converts annual salary before costing 11.37 tracked labour hours', () => {
  const reportedJob = {
    id: 'reported-job',
    contractValue: 5254.46,
    operationalWorkAreas: [{
      id: 'reported-area',
      lineItems: [{
        category: 'labour',
        labourClassId: 'foreman',
        labourClassName: 'Foreman',
        quantity: 50,
        averageLabourCost: 47.2,
        estimatedCost: 2360,
        total: 3500,
      }],
    }],
  };
  const salariedEmployee = {
    id: 'salary-employee',
    name: 'Salary Employee',
    labourClassId: 'foreman',
    compensationType: 'salary',
    hourlyRate: 83200,
    payrollBurdenPct: 18,
    benefitsExtraCost: 0,
    bonus: 0,
  };
  const timeEntries = [{
    id: 'reported-entry',
    employeeId: salariedEmployee.id,
    workType: 'job',
    jobId: reportedJob.id,
    clockIn: '2026-09-03T08:00:00.000Z',
    clockOut: '2026-09-03T19:22:12.000Z',
    breakMinutes: 0,
    status: 'clocked_out',
  }];

  const summary = calculateJobLabourSummary({
    job: reportedJob,
    employees: [salariedEmployee],
    labourClasses: [{ id: 'foreman', name: 'Foreman' }],
    timeEntries,
  });

  assert.equal(reportedJob.contractValue, 5254.46);
  assert.equal(summary.estimated.hours, 50);
  assert.ok(Math.abs(summary.actual.hours - 11.37) < 0.000001);
  assert.ok(Math.abs(summary.actual.cost - (11.37 * 47.2)) < 0.000001);
  assert.ok(summary.actual.cost < salariedEmployee.hourlyRate);
});

test('legacy top-level estimated hours do not leak into Work Area or unallocated scopes', () => {
  const legacyJob = { ...job, operationalWorkAreas: [], estimatedHours: 50 };
  const entireJob = calculateJobLabourSummary({ job: legacyJob, employees, labourClasses });
  const workArea = calculateJobLabourSummary({ job: legacyJob, employees, labourClasses, scopeWorkAreaId: 'area-a' });
  const unallocated = calculateJobLabourSummary({ job: legacyJob, employees, labourClasses, scopeWorkAreaId: 'unallocated' });

  assert.equal(entireJob.estimated.hours, 50);
  assert.equal(entireJob.estimated.hasData, true);
  assert.equal(workArea.estimated.hours, 0);
  assert.equal(workArea.estimated.hasData, false);
  assert.equal(unallocated.estimated.hours, 0);
  assert.equal(unallocated.estimated.hasData, false);
});