const DELIVERY_TYPES = new Set(['before_clock_in', 'after_clock_out', 'scheduled', 'always_available']);
const CLOCK_FREQUENCIES = new Set(['once_daily', 'every_occurrence']);
const CLOCK_BEHAVIORS = new Set(['blocking', 'reminder']);
const SCHEDULE_CADENCES = new Set(['daily', 'weekly', 'monthly', 'custom']);
const LEGACY_WORKFLOW_TRIGGERS = new Set([
  'before_clock_in',
  'after_clock_out',
  'before_starting_job',
  'after_completing_job',
  'after_leaving_job',
  'job_completed',
]);
const LEGACY_SCHEDULE_TRIGGERS = new Set(['daily', 'weekly', 'monthly']);

const isIntegerBetween = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;

function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object' || !SCHEDULE_CADENCES.has(schedule.cadence)) {
    return 'Scheduled Forms require a valid cadence.';
  }
  if (schedule.cadence === 'weekly') {
    if (!Array.isArray(schedule.weekdays) || schedule.weekdays.length === 0
      || schedule.weekdays.some((day) => !isIntegerBetween(day, 0, 6))
      || new Set(schedule.weekdays).size !== schedule.weekdays.length) {
      return 'Weekly Forms require one or more unique weekdays.';
    }
  }
  if (schedule.cadence === 'monthly' && !isIntegerBetween(schedule.dayOfMonth, 1, 31)) {
    return 'Monthly Forms require a day from 1 through 31.';
  }
  if (schedule.cadence === 'custom') {
    const interval = schedule.interval;
    if (!interval || !['days', 'weeks', 'months'].includes(interval.unit)
      || !isIntegerBetween(interval.count, 1, 365)) {
      return 'Custom schedules require a supported interval.';
    }
  }
  return null;
}

export function validateFormDeliveryRule(rule) {
  if (!rule || typeof rule !== 'object' || !DELIVERY_TYPES.has(rule.type)) {
    return 'Form delivery rule type is invalid.';
  }
  if (typeof rule.allowManualAccess !== 'boolean') {
    return 'Form manual access setting is invalid.';
  }
  if (rule.type === 'before_clock_in' || rule.type === 'after_clock_out') {
    if (!CLOCK_FREQUENCIES.has(rule.frequency)) return 'Clock workflow Forms require a valid frequency.';
    if (!CLOCK_BEHAVIORS.has(rule.completionBehavior)) return 'Clock workflow Forms require a valid completion behavior.';
    if (rule.schedule !== null) return 'Clock workflow Forms cannot also use a schedule.';
    return null;
  }
  if (rule.type === 'scheduled') {
    if (rule.frequency !== null) return 'Scheduled Forms cannot use a clock workflow frequency.';
    if (rule.completionBehavior !== 'due') return 'Scheduled Forms must use due completion behavior.';
    return validateSchedule(rule.schedule);
  }
  if (rule.frequency !== null || rule.schedule !== null || rule.completionBehavior !== 'manual') {
    return 'Always-available Forms cannot use automatic delivery settings.';
  }
  if (!rule.allowManualAccess) return 'Always-available Forms must allow manual access.';
  return null;
}

export function deliveryRuleToLegacyTriggers(rule) {
  if (validateFormDeliveryRule(rule)) return [];
  const manual = rule.allowManualAccess ? ['on_demand'] : [];
  if (rule.type === 'always_available') return ['on_demand'];
  if (rule.type === 'scheduled') return [rule.schedule.cadence === 'custom' ? 'daily' : rule.schedule.cadence, ...manual];
  return [rule.type, ...manual];
}

export function inspectFormDeliveryConfiguration(form) {
  if (form?.deliveryRule) {
    const error = validateFormDeliveryRule(form.deliveryRule);
    return error
      ? { status: 'invalid', needsReview: true, error, deliveryRule: null, legacyTriggers: [...(form.trigger ?? [])] }
      : { status: 'normalized', needsReview: false, error: null, deliveryRule: form.deliveryRule, legacyTriggers: [...(form.trigger ?? [])] };
  }

  const triggers = Array.isArray(form?.trigger) ? [...new Set(form.trigger)] : [];
  const workflow = triggers.filter((trigger) => LEGACY_WORKFLOW_TRIGGERS.has(trigger));
  const schedules = triggers.filter((trigger) => LEGACY_SCHEDULE_TRIGGERS.has(trigger));
  const allowManualAccess = triggers.includes('on_demand');
  const unsupported = triggers.filter((trigger) => !LEGACY_WORKFLOW_TRIGGERS.has(trigger)
    && !LEGACY_SCHEDULE_TRIGGERS.has(trigger) && trigger !== 'on_demand');

  let deliveryRule = null;
  if (workflow.length === 0 && schedules.length === 0 && allowManualAccess && unsupported.length === 0) {
    deliveryRule = { type: 'always_available', frequency: null, completionBehavior: 'manual', schedule: null, allowManualAccess: true };
  } else if (workflow.length === 1 && schedules.length === 0
    && ['before_clock_in', 'after_clock_out'].includes(workflow[0]) && unsupported.length === 0) {
    deliveryRule = {
      type: workflow[0],
      frequency: 'every_occurrence',
      completionBehavior: form.completionRequirement === 'required' ? 'blocking' : 'reminder',
      schedule: null,
      allowManualAccess,
    };
  } else if (workflow.length === 0 && schedules.length === 1 && unsupported.length === 0) {
    deliveryRule = {
      type: 'scheduled',
      frequency: null,
      completionBehavior: 'due',
      schedule: { cadence: schedules[0] },
      allowManualAccess,
    };
  }

  return deliveryRule
    ? { status: 'legacy_mappable', needsReview: false, error: null, deliveryRule, legacyTriggers: triggers }
    : {
        status: 'needs_review',
        needsReview: true,
        error: 'OliveOps now supports one automatic delivery rule per Form.',
        deliveryRule: null,
        legacyTriggers: triggers,
      };
}

export function deliveryRuleCompletionRequirement(rule) {
  return rule?.completionBehavior === 'blocking' ? 'required' : 'reminder';
}

export function normalizeFormDeliveryRecord(form) {
  const error = validateFormDeliveryRule(form?.deliveryRule);
  if (error) return { ok: false, error };
  return {
    ok: true,
    form: {
      ...form,
      deliveryRuleVersion: 1,
      trigger: deliveryRuleToLegacyTriggers(form.deliveryRule),
      completionRequirement: deliveryRuleCompletionRequirement(form.deliveryRule),
    },
  };
}