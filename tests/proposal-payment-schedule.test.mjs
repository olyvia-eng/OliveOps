import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateProposalPaymentSchedule } from '../src/utils/proposalPaymentSchedule.js';

test('percentage stages reconcile exactly to the Proposal total at cent precision', () => {
  const result = calculateProposalPaymentSchedule([
    { id: 'deposit', label: 'Deposit', type: 'percentage', percentage: 20, due: 'Upon acceptance' },
    { id: 'start', label: 'Project Start', type: 'percentage', percentage: 30, due: 'When work begins' },
    { id: 'progress', label: 'Progress Payment', type: 'percentage', percentage: 30, due: 'At installation' },
    { id: 'final', label: 'Final Payment', type: 'percentage', percentage: 20, due: 'At substantial completion' },
  ], 11402.83);

  assert.equal(result.valid, true);
  assert.deepEqual(result.stages.map((stage) => stage.calculatedAmount), [2280.57, 3420.85, 3420.85, 2280.56]);
  assert.equal(result.scheduledTotal, 11402.83);
  assert.equal(result.remaining, 0);
});

test('mixed fixed and percentage stages calculate without floating-point drift', () => {
  const result = calculateProposalPaymentSchedule([
    { label: 'Deposit', type: 'fixed', amount: 500, due: 'Upon acceptance' },
    { label: 'Final', type: 'percentage', percentage: 50, due: 'At completion' },
  ], 1000);

  assert.equal(result.valid, true);
  assert.deepEqual(result.stages.map((stage) => stage.calculatedAmountCents), [50000, 50000]);
});

test('over-allocation and incomplete schedules are invalid', () => {
  const percentageOverage = calculateProposalPaymentSchedule([
    { label: 'Deposit', type: 'percentage', percentage: 60, due: 'Now' },
    { label: 'Final', type: 'percentage', percentage: 50, due: 'Later' },
  ], 1000);
  assert.equal(percentageOverage.valid, false);
  assert.match(percentageOverage.errors.join(' '), /more than 100%/);
  assert.match(percentageOverage.errors.join(' '), /cannot exceed/);

  const incomplete = calculateProposalPaymentSchedule([
    { label: 'Deposit', type: 'fixed', amount: 250, due: 'Now' },
  ], 1000);
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.remaining, 750);
});

test('empty schedules remain optional but malformed stages are rejected', () => {
  assert.equal(calculateProposalPaymentSchedule([], 1000).valid, true);
  const result = calculateProposalPaymentSchedule([{ type: 'fixed', amount: 0 }], 1000);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /name|due description|greater than/);
});