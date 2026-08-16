import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendImportedSortOrders,
  copyDivisionPlanAssumptions,
  divisionPlanIdentity,
} from '../api/_lib/budgetDivisionPlanningModel.js';

test('division planning identities use catalog references and stable manual fallbacks', () => {
  assert.equal(divisionPlanIdentity({ category: 'labour', employeeId: 'employee-1' }), 'employee:employee-1');
  assert.equal(divisionPlanIdentity({ category: 'equipment', equipmentId: 'equipment-1' }), 'equipment:equipment-1');
  assert.equal(divisionPlanIdentity({ category: 'materials', materialCatalogItemId: 'material-1' }), 'material:material-1');
  assert.equal(divisionPlanIdentity({ category: 'subcontractors', name: '  Concrete   Supplier ' }), 'custom:concrete supplier');
});

test('equipment import creates an independent destination item and excludes source history and grouped ids', () => {
  const source = {
    id: 'source-item', budgetId: 'budget-old', divisionId: 'division-old', category: 'equipment',
    equipmentId: 'equipment-1', description: 'Bobcat E50', yearlyFuelCost: 8000,
    yearlyInsuranceCost: 1200, allocationMonths: 6, sortOrder: 3,
    actual: 9000, actualMachineHoursPerYear: 712, budgetGroupId: 'group-old', budgetItemId: 'legacy-item',
  };
  const copied = copyDivisionPlanAssumptions(source, { budgetId: 'budget-new', divisionId: 'division-new' }, () => 'new-item', '2027-01-01T00:00:00.000Z');
  assert.equal(copied.id, 'new-item');
  assert.equal(copied.budgetId, 'budget-new');
  assert.equal(copied.divisionId, 'division-new');
  assert.equal(copied.equipmentId, 'equipment-1');
  assert.equal(copied.yearlyFuelCost, 8000);
  assert.equal(copied.allocationMonths, 6);
  assert.equal(copied.actual, undefined);
  assert.equal(copied.actualMachineHoursPerYear, undefined);
  assert.equal(copied.budgetGroupId, undefined);
  assert.equal(copied.budgetItemId, undefined);
});

test('imported source order is preserved while rows append to the destination', () => {
  const result = appendImportedSortOrders([{ id: 'existing' }], [{ id: 'later', sortOrder: 9 }, { id: 'first', sortOrder: 2 }]);
  assert.deepEqual(result.map((item) => [item.id, item.sortOrder]), [['first', 1], ['later', 2]]);
});

test('Labour import copies reusable assumptions and remaps Division allocations as a snapshot', () => {
  const source = {
    id: 'source-labour', budgetId: 'old', divisionId: 'old-land', category: 'labour', employeeId: 'employee-1',
    labourClassification: 'billable', expectedBillablePct: 80, overtimeHours: 120, overtimeMultiplier: 1.5,
    divisionAllocations: [{ divisionId: 'old-land', percentage: 60 }, { divisionId: 'old-snow', percentage: 40 }],
  };
  const divisionIdMap = new Map([['old-land', 'new-land'], ['old-snow', 'new-snow']]);
  const copied = copyDivisionPlanAssumptions(source, { budgetId: 'new', divisionId: 'new-land', divisionIdMap }, () => 'new-item', '2027-01-01T00:00:00.000Z');
  assert.equal(copied.id, 'new-item');
  assert.equal(copied.labourClassification, 'billable');
  assert.equal(copied.expectedBillablePct, 80);
  assert.equal(copied.overtimeHours, 120);
  assert.equal(copied.overtimeMultiplier, 1.5);
  assert.deepEqual(copied.divisionAllocations, [{ divisionId: 'new-land', percentage: 60 }, { divisionId: 'new-snow', percentage: 40 }]);
  assert.deepEqual(source.divisionAllocations, [{ divisionId: 'old-land', percentage: 60 }, { divisionId: 'old-snow', percentage: 40 }]);
});