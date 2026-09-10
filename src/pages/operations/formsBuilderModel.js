import {
  deliveryRuleCompletionRequirement,
  deliveryRuleToLegacyTriggers,
  inspectFormDeliveryConfiguration,
  validateFormDeliveryRule,
} from '../../utils/formDeliveryRules.js';
import { getFormTemplateDeliveryRule } from '../../../shared/formTemplates.js';

/** @typedef {import('../../types').FormDeliveryRule} FormDeliveryRule */
/** @typedef {import('../../types').FormDeliveryType} FormDeliveryType */
/** @typedef {import('../../types').FormField} FormField */
/** @typedef {import('../../types').FormRecord} FormRecord */
/** @typedef {{ form: FormRecord, fields: FormField[] }} FormBuilderDraft */

const LEGACY_TRIGGER_LABELS = {
  before_clock_in: 'Before Clock In',
  after_clock_out: 'After Clock Out',
  before_starting_job: 'Before Starting Job',
  after_completing_job: 'After Completing Job',
  after_leaving_job: 'After Leaving Job',
  job_completed: 'When Job Is Completed',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  on_demand: 'Always Available',
};

/** @param {FormDeliveryType} type @returns {FormDeliveryRule} */
export function createDefaultDeliveryRule(type = 'always_available') {
  if (type === 'before_clock_in' || type === 'after_clock_out') {
    return { type, frequency: 'once_daily', completionBehavior: 'reminder', schedule: null, allowManualAccess: false };
  }
  if (type === 'scheduled') {
    return { type, frequency: null, completionBehavior: 'due', schedule: { cadence: 'daily' }, allowManualAccess: false };
  }
  return { type: 'always_available', frequency: null, completionBehavior: 'manual', schedule: null, allowManualAccess: true };
}

/** @param {FormRecord} form @param {FormDeliveryRule} deliveryRule @returns {FormRecord} */
export function applyFormDeliveryRule(form, deliveryRule) {
  return {
    ...form,
    deliveryRule,
    deliveryRuleVersion: 1,
    trigger: deliveryRuleToLegacyTriggers(deliveryRule),
    completionRequirement: deliveryRuleCompletionRequirement(deliveryRule),
  };
}

/** @param {FormBuilderDraft} draft */
function comparableDraft(draft) {
  return {
    form: {
      name: draft.form.name,
      description: draft.form.description,
      category: draft.form.category,
      status: draft.form.status,
      assignedTo: draft.form.assignedTo,
      assignmentValue: draft.form.assignmentValue ?? '',
      trigger: [...draft.form.trigger].sort(),
      deliveryRule: draft.form.deliveryRule ?? null,
      completionRequirement: draft.form.completionRequirement ?? 'reminder',
      requiresApproval: draft.form.requiresApproval ?? false,
    },
    fields: draft.fields.map((field, order) => ({
      id: field.id,
      type: field.type,
      label: field.label,
      helpText: field.helpText ?? '',
      required: field.required,
      defaultValue: field.defaultValue ?? '',
      placeholder: field.placeholder ?? '',
      options: field.options ?? [],
      acceptedResponse: field.acceptedResponse
        ? { value: field.acceptedResponse.value, message: field.acceptedResponse.message ?? '' }
        : null,
      order,
    })),
  };
}

/** @param {FormRecord} form @param {FormField[]} fields @returns {FormBuilderDraft} */
export function createFormBuilderDraft(form, fields) {
  const inspection = inspectFormDeliveryConfiguration(form);
  const inspectedRule = inspection.deliveryRule?.type === 'scheduled' && inspection.deliveryRule.schedule?.cadence === 'weekly'
    ? { ...inspection.deliveryRule, schedule: { cadence: 'weekly', weekdays: inspection.deliveryRule.schedule.weekdays ?? [1] } }
    : inspection.deliveryRule?.type === 'scheduled' && inspection.deliveryRule.schedule?.cadence === 'monthly'
      ? { ...inspection.deliveryRule, schedule: { cadence: 'monthly', dayOfMonth: inspection.deliveryRule.schedule.dayOfMonth ?? 1 } }
      : inspection.deliveryRule;
  const normalizedForm = inspectedRule
    ? applyFormDeliveryRule(form, inspectedRule)
    : { ...form, trigger: [...form.trigger] };
  return {
    form: {
      ...normalizedForm,
      deliveryRule: inspectedRule
        ? { ...inspectedRule, schedule: inspectedRule.schedule ? { ...inspectedRule.schedule } : null }
        : undefined,
      completionRequirement: normalizedForm.completionRequirement ?? 'reminder',
      requiresApproval: normalizedForm.requiresApproval ?? false,
    },
    fields: fields
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((field, order) => ({ ...field, options: [...(field.options ?? [])], acceptedResponse: field.acceptedResponse ? { ...field.acceptedResponse } : undefined, order })),
  };
}

/** @param {FormBuilderDraft | null} baseline @param {FormBuilderDraft | null} draft */
export function isFormBuilderDirty(baseline, draft) {
  if (!baseline || !draft) return false;
  return JSON.stringify(comparableDraft(baseline)) !== JSON.stringify(comparableDraft(draft));
}

/** @param {FormField[]} fields @param {string} fieldId @param {string} targetFieldId */
export function moveFormField(fields, fieldId, targetFieldId) {
  if (fieldId === targetFieldId) return fields;
  const next = fields.slice();
  const sourceIndex = next.findIndex((field) => field.id === fieldId);
  const targetIndex = next.findIndex((field) => field.id === targetFieldId);
  if (sourceIndex < 0 || targetIndex < 0) return fields;
  const [field] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, field);
  return next.map((item, order) => ({ ...item, order }));
}

/** @param {FormRecord} form */
export function getFormConfigurationWarnings(form) {
  const warnings = [];
  const inspection = inspectFormDeliveryConfiguration(form);
  if (inspection.needsReview) {
    warnings.push(inspection.status === 'invalid' && inspection.error
      ? `Configuration needs review. ${inspection.error}`
      : 'Configuration needs review. OliveOps now supports one delivery rule per form; choose one option before saving.');
  } else if (form.deliveryRule) {
    const error = validateFormDeliveryRule(form.deliveryRule);
    if (error) warnings.push(error);
  }
  if (form.assignedTo !== 'everyone' && !String(form.assignmentValue ?? '').trim()) {
    warnings.push(`This form is assigned to ${form.assignedTo} but no ${form.assignedTo} has been selected.`);
  }
  return warnings;
}

/** @param {FormRecord} form */
export function getLegacyConfigurationLabels(form) {
  return inspectFormDeliveryConfiguration(form).legacyTriggers.map((trigger) => LEGACY_TRIGGER_LABELS[trigger] ?? trigger);
}

/** @param {FormRecord} form @param {{ assignmentLabel?: string }} [labels] */
export function describeFormConfiguration(form, labels = {}) {
  const name = form.name.trim() || 'This form';
  const assignment = form.assignedTo === 'everyone'
    ? 'all employees'
    : `${form.assignedTo === 'role' ? 'employees with the' : 'employees assigned to the'} ${labels.assignmentLabel || `selected ${form.assignedTo}`}`;
  const rule = form.deliveryRule;
  if (!rule) return `${name} is assigned to ${assignment}. Its historical delivery settings need review before automation can be saved.`;

  let delivery;
  let policy = '';
  if (rule.type === 'before_clock_in' || rule.type === 'after_clock_out') {
    const timing = rule.type === 'before_clock_in' ? 'before clock-in' : 'after clock-out';
    const frequency = rule.frequency === 'once_daily' ? 'once per day' : 'every time';
    delivery = `is shown to ${assignment} ${timing}, ${frequency}`;
    policy = rule.completionBehavior === 'blocking'
      ? `It blocks ${rule.type === 'before_clock_in' ? 'clock-in' : 'clock-out'} until submitted`
      : 'It is a reminder, so employees may continue and complete it later';
  } else if (rule.type === 'scheduled') {
    const cadence = rule.schedule?.cadence === 'custom'
      ? `every ${rule.schedule.interval?.count} ${rule.schedule.interval?.unit}`
      : rule.schedule?.cadence;
    delivery = `is due for ${assignment} on a ${cadence} schedule`;
  } else {
    delivery = `is always available to ${assignment} in Forms`;
  }
  const manual = rule.type !== 'always_available' && rule.allowManualAccess
    ? ' employees may also open it anytime, but a generic manual submission does not complete a future or pending occurrence'
    : '';
  const detail = [policy, manual].filter(Boolean).join('; ');
  return `${name} ${delivery}.${detail ? ` ${detail}.` : ''}`;
}

/** @param {string} templateName @returns {FormDeliveryRule} */
export function getTemplateDeliveryRule(templateName) {
  return getFormTemplateDeliveryRule(templateName);
}
