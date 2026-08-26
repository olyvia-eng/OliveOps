import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabourClassCatalog } from '../src/pages/data-center/labourClassPricingModel.js';

const labourClass = { id: 'class-labourer', name: 'Labourer', description: '', active: true, customRates: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const budget = { id: 'budget-1', name: '2027 Budget', status: 'active', planningModel: 'divisions_v1', targetMarginPct: 20 };
const divisions = [
  { id: 'landscape', budgetId: budget.id, name: 'Landscaping', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } },
  { id: 'snow', budgetId: budget.id, name: 'Snow Removal', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } },
];
const employees = [
  { id: 'john', name: 'John', role: 'crew_member', labourClassId: labourClass.id, hourlyRate: 23.6, compensationType: 'hourly', payrollBurdenPct: 0, benefitsExtraCost: 0, bonus: 0, active: true },
  { id: 'mike', name: 'Mike', role: 'crew_member', labourClassId: labourClass.id, hourlyRate: 47.2, compensationType: 'hourly', payrollBurdenPct: 0, benefitsExtraCost: 0, bonus: 0, active: true },
  { id: 'unassigned', name: 'Unassigned', role: 'foreman', hourlyRate: 100, active: true },
];

function plan(id, employeeId, plannedHours, divisionAllocations, extra = {}) {
  return {
    id, employeeId, budgetId: budget.id, category: 'labour', name: id,
    compType: 'hourly', hourlyRate: 999, payrollBurdenPct: 50,
    plannedHours, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations,
    ...extra,
  };
}

test('Labour Class average uses current Employee costs weighted by planned billable hours', () => {
  const rows = buildLabourClassCatalog({
    labourClasses: [labourClass], employees, budgets: [budget], divisions: [divisions[0]], budgetRates: [],
    planningItems: [
      plan('john-plan', 'john', 1500, [{ divisionId: 'landscape', hours: 1500 }]),
      plan('mike-plan', 'mike', 500, [{ divisionId: 'landscape', hours: 500 }]),
    ],
  });
  const row = rows[0];
  const pricing = row.pricing[0];
  assert.equal(row.employeeCount, 2);
  assert.equal(pricing.plannedBillableHours, 2000);
  assert.equal(pricing.annualLabourCost, 59000);
  assert.equal(pricing.averageLabourCost, 29.5);
  assert.notEqual(pricing.averageLabourCost, (23.6 + 47.2) / 2);
  assert.equal(pricing.calculatedRate, 36.875);
});

test('Labour Class aggregation is division-specific and honors allocated planned hours', () => {
  const rows = buildLabourClassCatalog({
    labourClasses: [labourClass], employees, budgets: [budget], divisions, budgetRates: [],
    planningItems: [
      plan('john-plan', 'john', 1500, [{ divisionId: 'landscape', hours: 1400 }, { divisionId: 'snow', hours: 100 }]),
      plan('mike-plan', 'mike', 500, [{ divisionId: 'landscape', hours: 100 }, { divisionId: 'snow', hours: 400 }]),
    ],
  });
  const landscape = rows[0].pricing.find((item) => item.divisionId === 'landscape');
  const snow = rows[0].pricing.find((item) => item.divisionId === 'snow');
  assert.ok(Math.abs(landscape.averageLabourCost - 25.173333333333332) < 0.000001);
  assert.equal(snow.averageLabourCost, 42.48);
  assert.notEqual(landscape.calculatedRate, snow.calculatedRate);
  assert.equal(rows[0].divisionCount, 2);
});

test('Labour Class pricing reuses Budget per-hour overhead recovery and target margin', () => {
  const rows = buildLabourClassCatalog({
    labourClasses: [labourClass], employees, budgets: [budget], divisions: [divisions[0]], budgetRates: [],
    planningItems: [
      plan('john-plan', 'john', 1000, [{ divisionId: 'landscape', hours: 1000 }]),
      { id: 'office', budgetId: budget.id, category: 'overhead', plannedAmount: 10000, overheadDivisionAllocations: [{ divisionId: 'landscape', percentage: 100 }] },
    ],
  });
  const pricing = rows[0].pricing[0];
  assert.equal(pricing.averageLabourCost, 23.6);
  assert.equal(pricing.overheadRecovery, 10);
  assert.equal(pricing.breakeven, 33.6);
  assert.equal(pricing.calculatedRate, 42);
  assert.ok(Math.abs(pricing.profit - 8.4) < 0.000001);
});

test('Labour Class pricing is unavailable instead of zero when planned billable hours are missing', () => {
  const rows = buildLabourClassCatalog({
    labourClasses: [labourClass], employees, budgets: [budget], divisions: [divisions[0]], budgetRates: [],
    planningItems: [plan('john-plan', 'john', 0, [{ divisionId: 'landscape', hours: 0 }])],
  });
  const pricing = rows[0].pricing[0];
  assert.equal(pricing.averageLabourCost, null);
  assert.equal(pricing.calculatedRate, null);
  assert.equal(pricing.estimateRate, null);
  assert.equal(pricing.pricingAvailable, false);
  assert.match(pricing.unavailableReason, /No planned billable hours/);
});

test('inactive classes remain available for administration but can be excluded from active selectors', () => {
  const inactive = { ...labourClass, id: 'inactive', active: false };
  const rows = buildLabourClassCatalog({ labourClasses: [labourClass, inactive], employees, budgets: [], divisions: [], planningItems: [], budgetRates: [] });
  assert.deepEqual(rows.filter((item) => item.active).map((item) => item.id), [labourClass.id]);
  assert.equal(rows.find((item) => item.id === inactive.id).averageLabourCost, null);
});
