import test from 'node:test';
import assert from 'node:assert/strict';
import {
  overheadAllocatedAmount,
  overheadAllocationTotal,
  overheadAllocationsAreValid,
  splitOverheadAllocationsEvenly,
} from '../src/pages/budget/overheadAllocationModel.js';

test('shared overhead allocation must total exactly 100 percent', () => {
  assert.equal(overheadAllocationsAreValid([{ divisionId: 'snow', percentage: 60 }, { divisionId: 'landscape', percentage: 40 }]), true);
  assert.equal(overheadAllocationsAreValid([{ divisionId: 'snow', percentage: 60 }, { divisionId: 'landscape', percentage: 39.99 }]), false);
  assert.equal(overheadAllocationsAreValid([{ divisionId: 'snow', percentage: 50 }, { divisionId: 'snow', percentage: 50 }]), false);
});

test('Split Evenly totals exactly 100 percent at stored precision', () => {
  const allocations = splitOverheadAllocationsEvenly(['snow', 'landscape', 'excavation']);
  assert.deepEqual(allocations, [
    { divisionId: 'snow', percentage: 33.33 },
    { divisionId: 'landscape', percentage: 33.33 },
    { divisionId: 'excavation', percentage: 33.34 },
  ]);
  assert.equal(overheadAllocationTotal(allocations), 100);
});

test('each division receives only its allocated share and the shared item is counted once', () => {
  const item = { plannedAmount: 60000, overheadDivisionAllocations: splitOverheadAllocationsEvenly(['snow', 'landscape', 'excavation']) };
  const amounts = ['snow', 'landscape', 'excavation'].map((divisionId) => overheadAllocatedAmount(item, divisionId));
  assert.deepEqual(amounts, [19998, 19998, 20004]);
  assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), 60000);
});