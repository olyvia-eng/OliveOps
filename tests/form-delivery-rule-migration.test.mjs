import test from 'node:test';
import assert from 'node:assert/strict';

import { planFormDeliveryRuleMigration } from '../src/utils/formDeliveryRuleMigration.js';

test('plans canonical fields for an unambiguous legacy Form without copying unrelated data', () => {
  const plan = planFormDeliveryRuleMigration({
    formId: 'form-1',
    name: 'Start of shift',
    trigger: ['before_clock_in', 'on_demand'],
    completionRequirement: 'required',
    customData: { preserve: true },
  });

  assert.equal(plan.action, 'migrate');
  assert.deepEqual(plan.updates, {
    deliveryRule: {
      type: 'before_clock_in',
      frequency: 'every_occurrence',
      completionBehavior: 'blocking',
      schedule: null,
      allowManualAccess: true,
    },
    deliveryRuleVersion: 1,
    trigger: ['before_clock_in', 'on_demand'],
    completionRequirement: 'required',
  });
  assert.equal('customData' in plan.updates, false);
});

test('leaves valid normalized Forms unchanged even when compatibility fields are stale', () => {
  const plan = planFormDeliveryRuleMigration({
    formId: 'form-2',
    deliveryRule: {
      type: 'always_available',
      frequency: null,
      completionBehavior: 'manual',
      schedule: null,
      allowManualAccess: true,
    },
    trigger: ['daily'],
    completionRequirement: 'required',
  });

  assert.deepEqual(plan, { action: 'unchanged', formId: 'form-2', error: null, updates: null });
});

test('reports invalid normalized Forms as errors without a write plan', () => {
  const plan = planFormDeliveryRuleMigration({
    formId: 'form-3',
    deliveryRule: {
      type: 'scheduled',
      frequency: null,
      completionBehavior: 'due',
      schedule: { cadence: 'weekly', weekdays: [] },
      allowManualAccess: false,
    },
    trigger: ['weekly'],
  });

  assert.equal(plan.action, 'error');
  assert.match(plan.error, /unique weekdays/);
  assert.equal(plan.updates, null);
});

test('reports ambiguous and unsupported legacy Forms for review without a write plan', () => {
  for (const trigger of [
    ['before_clock_in', 'daily'],
    ['before_starting_job'],
    ['unsupported_trigger'],
  ]) {
    const plan = planFormDeliveryRuleMigration({ formId: `form-${trigger[0]}`, trigger });
    assert.equal(plan.action, 'needs_review');
    assert.equal(plan.updates, null);
  }
});

test('planning the normalized migration result is idempotent', () => {
  const legacy = { formId: 'form-4', trigger: ['daily'], completionRequirement: 'reminder' };
  const first = planFormDeliveryRuleMigration(legacy);
  const second = planFormDeliveryRuleMigration({ ...legacy, ...first.updates });

  assert.equal(first.action, 'migrate');
  assert.deepEqual(second, { action: 'unchanged', formId: 'form-4', error: null, updates: null });
});

test('does not invent missing details for an incomplete legacy monthly schedule', () => {
  const plan = planFormDeliveryRuleMigration({ formId: 'form-5', trigger: ['monthly'] });

  assert.equal(plan.action, 'needs_review');
  assert.match(plan.error, /day from 1 through 31/);
  assert.equal(plan.updates, null);
});