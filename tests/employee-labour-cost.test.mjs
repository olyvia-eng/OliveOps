import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEmployeeCostInputs, calculateEmployeeLabourCost, resolveEmployeeCostInputs } from '../src/utils/employeeLabourCost.js';
import { annualLabourCost, plannedBillableLabourHours } from '../src/pages/budget/overheadRecoveryModel.js';

const employee = {
  id: 'employee-1', name: 'John Smith', email: '', phone: '', role: 'crew_member', active: true, createdAt: '2026-01-01',
  hourlyRate: 25, compensationType: 'hourly', labourType: 'field_producing', payrollBurdenPct: 30, benefitsExtraCost: 1040, bonus: 0,
};

test('Employee Catalog and Budget planning use the same canonical labour cost inputs', () => {
  const item = {
    id: 'labour-1', budgetId: 'budget-1', divisionId: 'division-1', category: 'labour', employeeId: employee.id,
    compType: 'hourly', hourlyRate: 10, plannedHours: 2080, expectedBillablePct: 100, payrollBurdenPct: 5,
    benefitsExtraCost: 0, bonus: 0, overtimeHours: 0, overtimeMultiplier: 1.5, divisionAllocations: [{ divisionId: 'division-1', hours: 2080 }],
  };
  const resolved = applyEmployeeCostInputs(item, employee);
  const catalog = calculateEmployeeLabourCost(employee, { regularHours: 2080, expectedBillablePct: 100 });
  const budgetDirectCost = annualLabourCost(resolved) / plannedBillableLabourHours(resolved);

  assert.equal(catalog.employerCostPerPaidHour, 8);
  assert.equal(catalog.labourCostPerPaidHour, 33);
  assert.equal(budgetDirectCost, catalog.directCostPerBillableHour);
  assert.deepEqual(resolved.divisionAllocations, item.divisionAllocations);
});

test('legacy Budget cost inputs remain readable until Employee Catalog costing is configured', () => {
  const legacyEmployee = { ...employee, payrollBurdenPct: undefined, benefitsExtraCost: undefined, bonus: undefined };
  const resolved = resolveEmployeeCostInputs(legacyEmployee, { payrollBurdenPct: 22, benefitsExtraCost: 500, bonus: 250 });
  assert.equal(resolved.payrollBurdenPct, 22);
  assert.equal(resolved.benefitsExtraCost, 500);
  assert.equal(resolved.bonus, 250);
});