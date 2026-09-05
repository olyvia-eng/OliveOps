import {
  inspectFormDeliveryConfiguration,
  normalizeFormDeliveryRecord,
} from './formDeliveryRules.js';

export function planFormDeliveryRuleMigration(form) {
  const inspection = inspectFormDeliveryConfiguration(form);

  if (inspection.status === 'normalized') {
    return { action: 'unchanged', formId: form.formId ?? form.id, error: null, updates: null };
  }

  if (inspection.status === 'invalid') {
    return { action: 'error', formId: form.formId ?? form.id, error: inspection.error, updates: null };
  }

  if (inspection.status === 'needs_review') {
    return { action: 'needs_review', formId: form.formId ?? form.id, error: inspection.error, updates: null };
  }

  const normalized = normalizeFormDeliveryRecord({
    ...form,
    deliveryRule: inspection.deliveryRule,
  });

  if (!normalized.ok) {
    return { action: 'needs_review', formId: form.formId ?? form.id, error: normalized.error, updates: null };
  }

  return {
    action: 'migrate',
    formId: form.formId ?? form.id,
    error: null,
    updates: {
      deliveryRule: normalized.form.deliveryRule,
      deliveryRuleVersion: normalized.form.deliveryRuleVersion,
      trigger: normalized.form.trigger,
      completionRequirement: normalized.form.completionRequirement,
    },
  };
}