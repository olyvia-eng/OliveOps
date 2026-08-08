import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCombinedBudgetViewModel } from '../src/pages/budget/combinedBudgetModel.js';

function createEmployee(id, name) {
  return {
    id,
    userId: null,
    firstName: name.split(' ')[0],
    lastName: name.split(' ').slice(1).join(' '),
    name,
    email: `${id}@example.com`,
    phone: '',
    role: 'crew_member',
    hourlyRate: 10,
    active: true,
    compensationType: 'hourly',
    labourType: 'field_producing',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function createLabourPlan({ id, budgetId, employeeId, hourlyRate, hoursPerYear, payrollBurdenPct = 0 }) {
  return {
    id,
    budgetId,
    employeeId,
    year: '2026',
    compType: 'hourly',
    roleTitle: 'Labourer',
    hoursPerYear,
    billablePct: 80,
    overtimeFactorPct: 0,
    payrollBurdenPct,
    benefitsExtraCost: 0,
    bonus: 0,
    billableHoursYear: hoursPerYear * 0.8,
    unbillableHoursYear: hoursPerYear * 0.2,
    overtimeHoursYear: 0,
    overtimeMultiplier: 1.5,
    hourlyRate,
    annualSalary: hourlyRate * hoursPerYear,
    labourBurdenPct: payrollBurdenPct,
  };
}

test('combined budget model aggregates selected budgets and preserves source traceability', () => {
  const budgets = [
    {
      id: 'budget-company',
      name: '2026 Company',
      budgetType: 'operating',
      division: 'company_wide',
      fiscalYear: '2026',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
    {
      id: 'budget-snow',
      name: '2026 Snow Removal',
      budgetType: 'operating',
      division: 'snow_removal',
      fiscalYear: '2026',
      status: 'draft',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-11T00:00:00.000Z',
    },
  ];

  const budgetItems = [
    { id: 'rev-1', budgetId: 'budget-company', category: 'revenue', description: 'Company Revenue', budgeted: 1000, actual: 0, period: '2026-01' },
    { id: 'mat-1', budgetId: 'budget-company', category: 'materials', description: 'Salt', budgeted: 200, actual: 0, period: '2026-01' },
    { id: 'eq-1', budgetId: 'budget-company', category: 'equipment', equipmentCostType: 'financed', description: 'Loader', budgeted: 100, actual: 0, period: '2026-01' },
    { id: 'sub-1', budgetId: 'budget-company', category: 'subcontractors', description: 'Overflow Crew', budgeted: 25, actual: 0, period: '2026-01' },
    { id: 'oh-1', budgetId: 'budget-company', category: 'overhead', description: 'Shop Rent', budgeted: 50, actual: 0, period: '2026-01' },
    { id: 'rev-2', budgetId: 'budget-snow', category: 'revenue', description: 'Snow Revenue', budgeted: 500, actual: 0, period: '2026-02' },
    { id: 'mat-2', budgetId: 'budget-snow', category: 'materials', description: 'Fuel', budgeted: 150, actual: 0, period: '2026-02' },
    { id: 'eq-2', budgetId: 'budget-snow', category: 'equipment', equipmentCostType: 'owned', description: 'Excavator', budgeted: 200, actual: 0, period: '2026-02' },
    { id: 'oh-2', budgetId: 'budget-snow', category: 'overhead', description: 'Insurance', budgeted: 100, actual: 0, period: '2026-02' },
  ];

  const employees = [createEmployee('emp-1', 'Alex Snow')];
  const labourBudgetPlans = [
    createLabourPlan({ id: 'plan-1', budgetId: 'budget-company', employeeId: 'emp-1', hourlyRate: 10, hoursPerYear: 100, payrollBurdenPct: 10 }),
    createLabourPlan({ id: 'plan-2', budgetId: 'budget-snow', employeeId: 'emp-1', hourlyRate: 20, hoursPerYear: 50, payrollBurdenPct: 0 }),
  ];
  const revenueSalesGoals = [
    { id: 'goal-1', budgetId: 'budget-company', scopeType: 'year', scopeValue: '2026', goalRevenue: 1100, workingDays: 250 },
    { id: 'goal-2', budgetId: 'budget-snow', scopeType: 'year', scopeValue: '2026', goalRevenue: 700, workingDays: 250 },
  ];

  const result = buildCombinedBudgetViewModel({
    budgetIds: ['budget-company', 'budget-snow'],
    budgets,
    budgetItems,
    labourBudgetPlans,
    revenueSalesGoals,
    employees,
  });

  assert.equal(result.ok, true);
  assert.equal(result.fiscalYear, '2026');
  assert.equal(result.selectedBudgets.length, 2);
  assert.equal(result.totalsByCategory.revenue.budgeted, 1500);
  assert.equal(result.totalsByCategory.materials.budgeted, 350);
  assert.equal(result.totalsByCategory.equipment.budgeted, 300);
  assert.equal(result.totalsByCategory.subcontractors.budgeted, 25);
  assert.equal(result.totalsByCategory.overhead.budgeted, 150);
  assert.equal(result.labourTotals.annualLabourCost, 2100);
  assert.equal(result.combinedExpenseBudgeted, 2925);
  assert.equal(result.combinedGrossProfit, -1425);
  assert.equal(Number(result.combinedGrossMargin.toFixed(2)), -95);
  assert.equal(result.combinedRevenueGoal, 1800);
  assert.equal(result.sharedWorkingDays, 250);
  assert.equal(result.revenuePerDayNeeded, 7.2);
  assert.equal(result.equipmentByCostType.financed.budgeted, 100);
  assert.equal(result.equipmentByCostType.owned.budgeted, 200);
  assert.equal(result.hasPotentialOverlapWarning, true);
  assert.equal(result.combinedItems.some((item) => item.sourceBudgetName === '2026 Snow Removal'), true);
});

test('combined budget model blocks mixed fiscal years and missing ids', () => {
  const budgets = [
    {
      id: 'budget-2026',
      name: '2026 Company',
      budgetType: 'operating',
      division: 'company_wide',
      fiscalYear: '2026',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
    {
      id: 'budget-2027',
      name: '2027 Company',
      budgetType: 'operating',
      division: 'company_wide',
      fiscalYear: '2027',
      status: 'draft',
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2027-01-10T00:00:00.000Z',
    },
  ];

  const mixedYear = buildCombinedBudgetViewModel({
    budgetIds: ['budget-2026', 'budget-2027'],
    budgets,
    budgetItems: [],
    labourBudgetPlans: [],
    revenueSalesGoals: [],
    employees: [],
  });
  assert.equal(mixedYear.ok, false);
  assert.equal(mixedYear.code, 'MIXED_FISCAL_YEARS');

  const missing = buildCombinedBudgetViewModel({
    budgetIds: ['budget-2026', 'missing'],
    budgets,
    budgetItems: [],
    labourBudgetPlans: [],
    revenueSalesGoals: [],
    employees: [],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'MISSING_BUDGET');
});
