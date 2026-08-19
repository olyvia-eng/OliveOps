/** @typedef {import('../../types').FormField} FormField */
/** @typedef {import('../../types').FormRecord} FormRecord */
/** @typedef {{ form: FormRecord, fields: FormField[] }} FormBuilderDraft */

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
      order,
    })),
  };
}

/** @param {FormRecord} form @param {FormField[]} fields @returns {FormBuilderDraft} */
export function createFormBuilderDraft(form, fields) {
  return {
    form: { ...form, trigger: [...form.trigger] },
    fields: fields
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((field, order) => ({ ...field, options: [...(field.options ?? [])], order })),
  };
}

/** @param {FormBuilderDraft | null} baseline @param {FormBuilderDraft | null} draft */
export function isFormBuilderDirty(baseline, draft) {
  if (!baseline || !draft) return false;
  return JSON.stringify(comparableDraft(baseline)) !== JSON.stringify(comparableDraft(draft));
}

const WORKFLOW_TRIGGERS = new Set(['before_clock_in', 'after_clock_out', 'before_starting_job', 'after_completing_job']);
const SCHEDULE_TRIGGERS = new Set(['daily', 'weekly', 'monthly']);

/** @param {string[]} triggers */
export function hasMultipleFormRequirements(triggers) {
  return triggers.some((trigger) => WORKFLOW_TRIGGERS.has(trigger))
    && triggers.some((trigger) => SCHEDULE_TRIGGERS.has(trigger));
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