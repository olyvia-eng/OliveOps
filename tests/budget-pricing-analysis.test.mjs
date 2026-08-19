import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const budget = {
  id: 'budget-2027', targetMarginPct: 20,
  overheadRecoveryAllocation: { labourPercent: 50, equipmentPercent: 30, materialsPercent: 20, subcontractorsPercent: 0 },
};
const planningItems = [
  { id: 'ryan', budgetId: budget.id, divisionId: 'hardscape', category: 'labour', employeeId: 'employee-ryan', name: 'Ryan', compType: 'hourly', hourlyRate: 30, plannedHours: 2000, expectedBillablePct: 80, payrollBurdenPct: 20, labourClassification: 'billable' },
  { id: 'ryan', budgetId: budget.id, divisionId: 'snow', category: 'labour', employeeId: 'employee-ryan', name: 'Ryan', compType: 'hourly', hourlyRate: 30, plannedHours: 2000, expectedBillablePct: 80, payrollBurdenPct: 20, labourClassification: 'billable' },
  { id: 'bobcat', budgetId: budget.id, divisionId: 'hardscape', category: 'equipment', equipmentId: 'equipment-bobcat', name: 'Bobcat E50', plannedAmount: 52000, sellableHoursPerYear: 1200 },
  { id: 'gravel', budgetId: budget.id, divisionId: 'hardscape', category: 'materials', materialCatalogItemId: 'material-gravel', name: 'A Gravel', unit: 'tonne', unitCost: 28, plannedQuantity: 100 },
  { id: 'concrete', budgetId: budget.id, divisionId: 'hardscape', category: 'subcontractors', name: 'Concrete Co', unit: 'hr', rate: 100, plannedQuantity: 50 },
];

test('Budget Analysis calculates recommendations once per shared item and resolves canonical approvals', () => {
  const rows = buildBudgetPricingRows({
    budget,
    planningItems,
    companyOverhead: 100000,
    budgetRates: [{ id: 'rate-ryan', budgetId: budget.id, budgetItemId: 'ryan', employeeId: 'employee-ryan', category: 'labour', defaultSellPrice: 80 }],
  });

  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.item.employeeId === 'employee-ryan').length, 1);
  const labour = rows.find((row) => row.item.id === 'ryan');
  assert.equal(labour.costRate, 45);
  assert.equal(labour.overheadPerUnit, 31.25);
  assert.equal(labour.recommendedRate, 95.3125);
  assert.equal(labour.approvedRate, 80);
  assert.equal(labour.pricingStatus, 'approved');

  const equipment = rows.find((row) => row.item.id === 'bobcat');
  assert.ok(Math.abs(equipment.costRate - 43.3333333333) < 0.000001);
  assert.equal(equipment.overheadPerUnit, 25);
  assert.ok(Math.abs(equipment.recommendedRate - 85.4166666667) < 0.000001);
});

test('Budget Analysis leaves recommendations unavailable when pricing units are missing', () => {
  const rows = buildBudgetPricingRows({ budget, planningItems: [{ id: 'idle', budgetId: budget.id, category: 'equipment', equipmentId: 'idle', name: 'Idle Equipment', plannedAmount: 10000, sellableHoursPerYear: 0 }], budgetRates: [], companyOverhead: 1000 });
  assert.equal(rows[0].costRate, 0);
  assert.equal(rows[0].recommendedRate, 0);
  assert.equal(rows[0].pricingStatus, 'unavailable');
});
