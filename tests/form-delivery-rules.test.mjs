import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryRuleToLegacyTriggers,
  inspectFormDeliveryConfiguration,
  validateFormDeliveryRule,
} from '../src/utils/formDeliveryRules.js';

const clockRule = (overrides = {}) => ({
  type: 'before_clock_in',
  frequency: 'once_daily',
  completionBehavior: 'blocking',
  schedule: null,
  allowManualAccess: false,
  ...overrides,
});

test('delivery rules accept only one coherent automatic delivery model', () => {
  assert.equal(validateFormDeliveryRule(clockRule()), null);
  assert.equal(validateFormDeliveryRule(clockRule({ type: 'after_clock_out', frequency: 'every_occurrence', completionBehavior: 'reminder' })), null);
  assert.equal(validateFormDeliveryRule({
    type: 'scheduled', frequency: null, completionBehavior: 'due',
    schedule: { cadence: 'weekly', weekdays: [1, 5] }, allowManualAccess: true,
  }), null);
  assert.equal(validateFormDeliveryRule({
    type: 'always_available', frequency: null, completionBehavior: 'manual', schedule: null, allowManualAccess: true,
  }), null);

  assert.match(validateFormDeliveryRule(clockRule({ schedule: { cadence: 'daily' } })), /cannot also use a schedule/);
  assert.match(validateFormDeliveryRule(clockRule({ type: 'scheduled', frequency: null })), /due completion behavior/);
  assert.match(validateFormDeliveryRule(clockRule({ type: 'always_available', frequency: null, completionBehavior: 'manual', allowManualAccess: false })), /must allow manual access/);
  assert.match(validateFormDeliveryRule({
    type: 'scheduled', frequency: null, completionBehavior: 'due', schedule: { cadence: 'weekly', weekdays: [] }, allowManualAccess: false,
  }), /one or more unique weekdays/);
});

test('unambiguous legacy Forms map without changing their former intent', () => {
  assert.deepEqual(inspectFormDeliveryConfiguration({ trigger: ['before_clock_in'], completionRequirement: 'required' }).deliveryRule, clockRule({ frequency: 'every_occurrence' }));
  assert.deepEqual(inspectFormDeliveryConfiguration({ trigger: ['after_clock_out', 'on_demand'], completionRequirement: 'reminder' }).deliveryRule, clockRule({
    type: 'after_clock_out', frequency: 'every_occurrence', completionBehavior: 'reminder', allowManualAccess: true,
  }));
  assert.deepEqual(inspectFormDeliveryConfiguration({ trigger: ['weekly'] }).deliveryRule, {
    type: 'scheduled', frequency: null, completionBehavior: 'due', schedule: { cadence: 'weekly' }, allowManualAccess: false,
  });
  assert.equal(inspectFormDeliveryConfiguration({ trigger: ['on_demand'] }).deliveryRule.type, 'always_available');
});

test('ambiguous and unsupported legacy automation is preserved for review', () => {
  for (const trigger of [
    ['before_clock_in', 'daily'],
    ['before_clock_in', 'after_clock_out'],
    ['before_starting_job'],
    ['after_leaving_job'],
    ['job_completed'],
  ]) {
    const result = inspectFormDeliveryConfiguration({ trigger });
    assert.equal(result.needsReview, true);
    assert.deepEqual(result.legacyTriggers, trigger);
    assert.equal(result.deliveryRule, null);
  }
});

test('normalized rules expose compatibility triggers without creating a second due rule', () => {
  assert.deepEqual(deliveryRuleToLegacyTriggers(clockRule({ allowManualAccess: true })), ['before_clock_in', 'on_demand']);
  assert.deepEqual(deliveryRuleToLegacyTriggers({
    type: 'scheduled', frequency: null, completionBehavior: 'due', schedule: { cadence: 'monthly', dayOfMonth: 31 }, allowManualAccess: false,
  }), ['monthly']);
  assert.deepEqual(deliveryRuleToLegacyTriggers({
    type: 'always_available', frequency: null, completionBehavior: 'manual', schedule: null, allowManualAccess: true,
  }), ['on_demand']);
});