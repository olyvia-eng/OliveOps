import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let model;

test.before(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oliveops-labour-model-'));
  const outfile = join(directory, 'model.mjs');
  await build({ entryPoints: ['src/pages/budget/divisionLabourPlanningModel.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
  model = await import(pathToFileURL(outfile).href);
  test.after(() => rm(directory, { recursive: true, force: true }));
});

test('billable Labour includes full overtime wages and applies payroll burden once', () => {
  const result = model.calculateDivisionLabour({
    compType: 'hourly', hourlyRate: 30, plannedHours: 2000,
    overtimeHours: 120, overtimeMultiplier: 1.5, payrollBurdenPct: 10,
    benefitsExtraCost: 4000, bonus: 1000, labourClassification: 'billable', expectedBillablePct: 80,
  });
  assert.equal(result.regularWageCost, 60000);
  assert.equal(result.overtimeWageCost, 5400);
  assert.equal(result.payrollBurdenCost, 6540);
  assert.equal(result.annualLabourCost, 76940);
  assert.equal(result.expectedBillableHours, 1600);
  assert.equal(result.directCostPerBillableHour, 48.0875);
  assert.equal(result.overheadLabourCost, 0);
});

test('zero overtime and zero billable hours remain finite', () => {
  const result = model.calculateDivisionLabour({ compType: 'hourly', hourlyRate: 30, plannedHours: 0, overtimeHours: 0, overtimeMultiplier: 1.5, labourClassification: 'billable', expectedBillablePct: 0 });
  assert.equal(result.overtimeWageCost, 0);
  assert.equal(result.expectedBillableHours, 0);
  assert.equal(result.directCostPerBillableHour, 0);
});

test('overhead Labour has no billable capacity or direct cost and enters overhead', () => {
  const result = model.calculateDivisionLabour({ compType: 'salaried', annualSalary: 80000, plannedHours: 1900, labourClassification: 'overhead', expectedBillablePct: 90 });
  assert.equal(result.expectedBillableHours, 0);
  assert.equal(result.directCostPerBillableHour, 0);
  assert.equal(result.directLabourCost, 0);
  assert.equal(result.overheadLabourCost, 80000);
});

test('division allocation distributes cost and billable hours without changing totals', () => {
  const item = { compType: 'salaried', annualSalary: 90000, plannedHours: 2000, labourClassification: 'billable', expectedBillablePct: 80, divisionAllocations: [{ divisionId: 'landscaping', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] };
  const allocated = model.allocateLabourCost(item);
  assert.equal(model.labourAllocationTotal(item.divisionAllocations), 100);
  assert.deepEqual(allocated.map((value) => [value.annualLabourCost, value.expectedBillableHours]), [[54000, 960], [36000, 640]]);
  assert.equal(allocated.reduce((sum, value) => sum + value.annualLabourCost, 0), 90000);
});

test('legacy Labour defaults to billable without inferring from employee role', () => {
  assert.equal(model.labourClassification({ role: 'office administrator' }), 'billable');
});