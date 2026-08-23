import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverheadRecoveryModel,
  grossMarginRate,
  recoveryAllocationIsValid,
  recoveryAllocationTotal,
} from '../src/pages/budget/overheadRecoveryModel.js';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const allocation = (labourPercent, equipmentPercent, materialsPercent, subcontractorsPercent) => ({ labourPercent, equipmentPercent, materialsPercent, subcontractorsPercent });
const policy = (values) => ({ version: 2, allocation: values });

test('version-2 recovery allocations must total exactly 100 percent', () => {
  assert.equal(recoveryAllocationTotal(allocation(40, 30, 20, 10)), 100);
  assert.equal(recoveryAllocationIsValid(allocation(40, 30, 20, 10)), true);
  assert.equal(recoveryAllocationIsValid(allocation(40, 30, 20, 9)), false);
});

test('invalid recovery allocation makes calculated pricing unavailable', () => {
  const budget = { id: 'budget', targetMarginPct: 20 };
  const divisions = [{ id: 'division', budgetId: budget.id, name: 'Division', status: 'active', overheadRecoveryPolicy: policy(allocation(50, 20, 10, 10)) }];
  const planningItems = [
    { id: 'equipment', budgetId: budget.id, category: 'equipment', plannedAmount: 10000, sellableHoursPerYear: 100, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'division', months: 12, sellableHours: 100 }] },
    { id: 'overhead', budgetId: budget.id, category: 'overhead', plannedAmount: 1000, overheadDivisionAllocations: [{ divisionId: 'division', percentage: 100 }] },
  ];
  const recovery = buildOverheadRecoveryModel({ budget, divisions, planningItems });
  assert.match(recovery.divisions.division.warnings[0], /adjust recovery percentages to total 100%/);
  const row = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: [] }).find((value) => value.item.id === 'equipment');
  assert.equal(row.recoveryUnavailable, true);
  assert.equal(row.recoveryUnavailableReason, 'configuration');
  assert.equal(row.recommendedRate, 0);
});

test('recovery uses eligible hours and cost denominators without counting overhead resources twice', () => {
  const budget = { id: 'budget' };
  const divisions = [
    { id: 'snow', budgetId: budget.id, name: 'Snow', status: 'active', overheadRecoveryPolicy: policy(allocation(50, 50, 0, 0)) },
    { id: 'landscape', budgetId: budget.id, name: 'Landscape', status: 'active', overheadRecoveryPolicy: policy(allocation(50, 50, 0, 0)) },
  ];
  const planningItems = [
    { id: 'operator', budgetId: budget.id, category: 'labour', compType: 'hourly', hourlyRate: 25, plannedHours: 2000, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'snow', hours: 1200 }, { divisionId: 'landscape', hours: 800 }] },
    { id: 'manager', budgetId: budget.id, category: 'labour', compType: 'salaried', annualSalary: 60000, plannedHours: 2000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'snow', hours: 1000 }, { divisionId: 'landscape', hours: 1000 }] },
    { id: 'bobcat', budgetId: budget.id, category: 'equipment', name: 'Bobcat', plannedAmount: 48000, sellableHoursPerYear: 1200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'snow', months: 6, sellableHours: 800 }, { divisionId: 'landscape', months: 6, sellableHours: 400 }] },
    { id: 'shop-truck', budgetId: budget.id, category: 'equipment', plannedAmount: 12000, sellableHoursPerYear: 500, classification: 'overhead', equipmentDivisionAllocations: [{ divisionId: 'snow', months: 6, sellableHours: 0 }, { divisionId: 'landscape', months: 6, sellableHours: 0 }] },
    { id: 'salt', budgetId: budget.id, divisionId: 'snow', category: 'materials', unitCost: 100, plannedQuantity: 200 },
    { id: 'mulch', budgetId: budget.id, divisionId: 'landscape', category: 'materials', unitCost: 50, plannedQuantity: 100 },
    { id: 'hauling', budgetId: budget.id, divisionId: 'snow', category: 'subcontractors', rate: 200, plannedQuantity: 20 },
    { id: 'snow-oh', budgetId: budget.id, divisionId: 'snow', category: 'overhead', plannedAmount: 10000, overheadDivisionAllocations: [{ divisionId: 'snow', percentage: 100 }] },
    { id: 'landscape-oh', budgetId: budget.id, divisionId: 'landscape', category: 'overhead', plannedAmount: 30000, overheadDivisionAllocations: [{ divisionId: 'landscape', percentage: 100 }] },
  ];

  const recovery = buildOverheadRecoveryModel({ budget, divisions, planningItems });
  assert.equal(recovery.divisions.snow.denominators.equipment, 800);
  assert.equal(recovery.divisions.landscape.denominators.equipment, 400);
  assert.equal(recovery.divisions.snow.totalOverhead, 46000);
  assert.equal(recovery.divisions.landscape.totalOverhead, 66000);

  const rows = buildBudgetPricingRows({ budget: { ...budget, targetMarginPct: 20 }, divisions, planningItems, budgetRates: [] });
  const bobcatRows = rows.filter((row) => row.item.id === 'bobcat');
  assert.equal(bobcatRows.length, 2);
  assert.equal(bobcatRows[0].costRate, bobcatRows[1].costRate);
  assert.notEqual(bobcatRows[0].divisionOverheadPerUnit, bobcatRows[1].divisionOverheadPerUnit);
  for (const row of bobcatRows) assert.equal(row.recommendedRate, grossMarginRate(row.costRate + row.divisionOverheadPerUnit, 20));
  assert.equal(rows.some((row) => row.item.id === 'manager' || row.item.id === 'shop-truck'), false);
});

test('zero denominators produce warnings and unrecoverable amounts without invalid numbers', () => {
  const budget = { id: 'budget' };
  const divisions = [{ id: 'snow', budgetId: budget.id, name: 'Snow', status: 'active', overheadRecoveryPolicy: policy(allocation(0, 100, 0, 0)) }];
  const planningItems = [{ id: 'overhead', budgetId: budget.id, divisionId: 'snow', category: 'overhead', plannedAmount: 50000, overheadDivisionAllocations: [{ divisionId: 'snow', percentage: 100 }] }];
  const scope = buildOverheadRecoveryModel({ budget, divisions, planningItems }).divisions.snow;
  assert.equal(scope.recoverableAmount, 0);
  assert.equal(scope.unrecoverableAmount, 50000);
  assert.equal(scope.warnings.length, 1);
  assert.equal(Number.isFinite(scope.rates.equipment), true);
  assert.match(scope.warnings[0], /add sellable equipment hours or change the equipment recovery allocation/);
});

test('equal equipment rates in different Divisions are derived from isolated pools and hours', () => {
  const budget = { id: 'budget' };
  const divisions = [
    { id: 'landscape', budgetId: budget.id, name: 'Landscaping', status: 'active', overheadRecoveryPolicy: policy(allocation(0, 100, 0, 0)) },
    { id: 'snow', budgetId: budget.id, name: 'Snow Removal', status: 'active', overheadRecoveryPolicy: policy(allocation(0, 100, 0, 0)) },
  ];
  const equipment = { id: 'bobcat', budgetId: budget.id, category: 'equipment', name: 'Bobcat E50', plannedAmount: 30000, sellableHoursPerYear: 200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'landscape', months: 6, sellableHours: 100 }, { divisionId: 'snow', months: 6, sellableHours: 100 }] };
  const planningItems = [
    equipment,
    { id: 'landscape-overhead', budgetId: budget.id, category: 'overhead', plannedAmount: 1500, overheadDivisionAllocations: [{ divisionId: 'landscape', percentage: 100 }] },
    { id: 'snow-overhead', budgetId: budget.id, category: 'overhead', plannedAmount: 1500, overheadDivisionAllocations: [{ divisionId: 'snow', percentage: 100 }] },
    structuredClone(equipment),
  ];

  const recovery = buildOverheadRecoveryModel({ budget, divisions, planningItems });
  assert.deepEqual([recovery.divisions.landscape.pools.equipment, recovery.divisions.landscape.denominators.equipment, recovery.divisions.landscape.rates.equipment], [1500, 100, 15]);
  assert.deepEqual([recovery.divisions.snow.pools.equipment, recovery.divisions.snow.denominators.equipment, recovery.divisions.snow.rates.equipment], [1500, 100, 15]);
  const rows = buildBudgetPricingRows({ budget: { ...budget, targetMarginPct: 20 }, divisions, planningItems, budgetRates: [] }).filter((row) => row.item.id === 'bobcat');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.divisionId, row.overheadPool, row.recoveryDenominator, row.overheadPerUnit]), [['landscape', 1500, 100, 15], ['snow', 1500, 100, 15]]);
});
