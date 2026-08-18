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
  const item = { id: 'ryan-plan', category: 'labour', compType: 'salaried', annualSalary: 90000, plannedHours: 2000, labourClassification: 'billable', expectedBillablePct: 80, divisionAllocations: [{ divisionId: 'landscaping', percentage: 60 }, { divisionId: 'snow', percentage: 40 }] };
  const allocated = model.allocateLabourCost(item);
  assert.equal(model.labourAllocationTotal(item.divisionAllocations), 100);
  assert.deepEqual(allocated.map((value) => [value.annualLabourCost, value.expectedBillableHours]), [[54000, 960], [36000, 640]]);
  assert.equal(allocated.reduce((sum, value) => sum + value.annualLabourCost, 0), 90000);
  assert.deepEqual(model.calculateDivisionLabourShare(item, 'landscaping'), {
    ...model.calculateDivisionLabour(item), percentage: 60, annualLabourCost: 54000,
    expectedBillableHours: 960, directLabourCost: 54000, overheadLabourCost: 0,
  });
  assert.equal(model.calculateDivisionLabourShare(item, 'snow').annualLabourCost, 36000);
  assert.equal(model.calculateBudgetLabourTotals([item, item]).annualLabourCost, 90000);
  assert.equal(model.calculateBudgetLabourTotals([item, item]).itemCount, 1);
});

test('Labour visibility follows positive allocation with legacy ownership fallback only when allocations are absent', () => {
  const shared = { divisionId: 'landscaping', divisionAllocations: [{ divisionId: 'landscaping', percentage: 100 }, { divisionId: 'snow', percentage: 0 }] };
  assert.equal(model.isLabourAllocatedToDivision(shared, 'landscaping'), true);
  assert.equal(model.isLabourAllocatedToDivision(shared, 'snow'), false);
  assert.equal(model.isLabourAllocatedToDivision({ divisionId: 'snow' }, 'snow'), true);
  assert.equal(model.isLabourAllocatedToDivision({ divisionId: 'snow' }, 'landscaping'), false);
});

test('Split Evenly uses exact hundredths for two, three, and four active Divisions', () => {
  assert.deepEqual(model.splitLabourAllocationsEvenly(['land', 'snow']), [{ divisionId: 'land', percentage: 50 }, { divisionId: 'snow', percentage: 50 }]);
  assert.deepEqual(model.splitLabourAllocationsEvenly(['land', 'snow', 'excavation']), [{ divisionId: 'land', percentage: 33.33 }, { divisionId: 'snow', percentage: 33.33 }, { divisionId: 'excavation', percentage: 33.34 }]);
  assert.deepEqual(model.splitLabourAllocationsEvenly(['one', 'two', 'three', 'four']).map((item) => item.percentage), [25, 25, 25, 25]);
  assert.equal(model.labourAllocationTotal(model.splitLabourAllocationsEvenly(['land', 'snow', 'excavation'])), 100);
});

test('adding a Division does not redistribute saved Labour until Split Evenly is requested', () => {
  const saved = [{ divisionId: 'land', percentage: 60 }, { divisionId: 'snow', percentage: 40 }];
  const withNewDivision = ['land', 'snow', 'excavation'].map((divisionId) => ({ divisionId, percentage: saved.find((item) => item.divisionId === divisionId)?.percentage ?? 0 }));
  assert.deepEqual(withNewDivision, [{ divisionId: 'land', percentage: 60 }, { divisionId: 'snow', percentage: 40 }, { divisionId: 'excavation', percentage: 0 }]);
  assert.deepEqual(model.splitLabourAllocationsEvenly(withNewDivision.map((item) => item.divisionId)).map((item) => item.percentage), [33.33, 33.33, 33.34]);
});

test('overhead Labour uses the same Division allocation shares', () => {
  const item = { id: 'admin', category: 'labour', compType: 'salaried', annualSalary: 80000, plannedHours: 1900, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'land', percentage: 70 }, { divisionId: 'snow', percentage: 30 }] };
  assert.equal(model.calculateDivisionLabourShare(item, 'land').overheadLabourCost, 56000);
  assert.equal(model.calculateDivisionLabourShare(item, 'snow').overheadLabourCost, 24000);
  assert.equal(model.calculateBudgetLabourTotals([item]).overheadLabourCost, 80000);
});

test('legacy Labour defaults to billable without inferring from employee role', () => {
  assert.equal(model.labourClassification({ role: 'office administrator' }), 'billable');
});