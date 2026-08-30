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
  return {
    form: { ...form, trigger: [...form.trigger], completionRequirement: form.completionRequirement ?? 'reminder', requiresApproval: form.requiresApproval ?? false },
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

const WORKFLOW_TRIGGERS = new Set(['before_clock_in', 'after_clock_out', 'before_starting_job', 'after_completing_job', 'after_leaving_job', 'job_completed']);
const SCHEDULE_TRIGGERS = new Set(['daily', 'weekly', 'monthly']);
const ENFORCED_WORKFLOW_TRIGGERS = new Set(['before_clock_in', 'after_clock_out']);

const WORKFLOW_LABELS = {
  before_clock_in: 'before clocking in',
  after_clock_out: 'after clocking out',
  before_starting_job: 'before starting a job',
  after_completing_job: 'at the legacy after-completing-job event',
  after_leaving_job: 'after leaving a job',
  job_completed: 'when a job is marked completed',
};

/** @param {string[]} triggers */
export function getWorkflowTriggers(triggers) {
  return triggers.filter((trigger) => WORKFLOW_TRIGGERS.has(trigger));
}

/** @param {string[]} triggers */
export function getScheduleTriggers(triggers) {
  return triggers.filter((trigger) => SCHEDULE_TRIGGERS.has(trigger));
}

/** @param {string[]} triggers @param {string} schedule */
export function setFormSchedule(triggers, schedule) {
  return [...triggers.filter((trigger) => !SCHEDULE_TRIGGERS.has(trigger)), ...(schedule ? [schedule] : [])];
}

/** @param {string[]} triggers @param {boolean} enabled */
export function setFormOnDemand(triggers, enabled) {
  const withoutOnDemand = triggers.filter((trigger) => trigger !== 'on_demand');
  return enabled ? [...withoutOnDemand, 'on_demand'] : withoutOnDemand;
}

/** @param {string[]} triggers @param {number} index @param {string} nextTrigger */
export function setFormWorkflowTrigger(triggers, index, nextTrigger) {
  const workflow = getWorkflowTriggers(triggers);
  const other = triggers.filter((trigger) => !WORKFLOW_TRIGGERS.has(trigger));
  if (nextTrigger) workflow[index] = nextTrigger;
  else workflow.splice(index, 1);
  return [...workflow.filter((trigger, triggerIndex) => workflow.indexOf(trigger) === triggerIndex), ...other];
}

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

/** @param {import('../../types').FormRecord} form */
export function getFormConfigurationWarnings(form) {
  const warnings = [];
  if (!form.trigger.some((trigger) => WORKFLOW_TRIGGERS.has(trigger) || SCHEDULE_TRIGGERS.has(trigger) || trigger === 'on_demand')) {
    warnings.push('This form has no workflow trigger, schedule, or employee access. Employees will have no way to access it.');
  }
  if (form.assignedTo !== 'everyone' && !String(form.assignmentValue ?? '').trim()) {
    warnings.push(`This form is assigned to ${form.assignedTo} but no ${form.assignedTo} has been selected.`);
  }
  if (getScheduleTriggers(form.trigger).length > 1) {
    warnings.push('This legacy form has multiple recurring schedules. Choose one schedule to simplify it, or leave it unchanged to preserve the existing configuration.');
  }
  if ((form.completionRequirement ?? 'reminder') === 'required' && getWorkflowTriggers(form.trigger).some((trigger) => !ENFORCED_WORKFLOW_TRIGGERS.has(trigger))) {
    warnings.push('Required workflow enforcement is not yet available for this trigger. Employees are still allowed to continue.');
  }
  if (form.trigger.includes('after_completing_job')) {
    warnings.push('This form uses the legacy After Completing Job trigger. Its existing mobile behavior is preserved until you choose an explicit job event.');
  }
  return warnings;
}

/** @param {import('../../types').FormRecord} form @param {{ assignmentLabel?: string }} [labels] */
export function describeFormConfiguration(form, labels = {}) {
  const name = form.name.trim() || 'This form';
  const assignment = form.assignedTo === 'everyone'
    ? 'all employees'
    : `${form.assignedTo === 'role' ? 'employees with the' : 'employees assigned to the'} ${labels.assignmentLabel || `selected ${form.assignedTo}`}`;
  const workflow = getWorkflowTriggers(form.trigger).map((trigger) => WORKFLOW_LABELS[trigger]).filter(Boolean);
  const schedules = getScheduleTriggers(form.trigger);
  const access = [];
  if (workflow.length) access.push(workflow.join(' and '));
  if (schedules.length) access.push(schedules.length === 1 ? `on a ${schedules[0]} schedule` : `on ${schedules.join(' and ')} schedules`);
  const availability = access.length ? `will be shown to ${assignment} ${access.join(' and ')}` : `is not currently presented automatically to ${assignment}`;
  const workflowTriggers = getWorkflowTriggers(form.trigger);
  const onlyEnforcedWorkflowTriggers = workflowTriggers.length > 0 && workflowTriggers.every((trigger) => ENFORCED_WORKFLOW_TRIGGERS.has(trigger));
  const requirement = (form.completionRequirement ?? 'reminder') === 'required'
    ? onlyEnforcedWorkflowTriggers
      ? workflowTriggers.includes('before_clock_in') && workflowTriggers.includes('after_clock_out')
        ? 'It is required and employees must submit it before clock-in or clock-out can be finalized.'
        : workflowTriggers.includes('before_clock_in')
          ? 'It is required and employees must submit it before clock-in can be finalized.'
          : 'It is required and employees must submit it before clock-out can be finalized.'
      : 'It is configured as required, but enforcement remains advisory for workflow triggers other than Before Clock In and After Clock Out.'
    : 'It is a reminder, so employees may continue and complete it later.';
  const onDemand = form.trigger.includes('on_demand') ? ' Employees can also open it manually from Forms.' : '';
  return `${name} ${availability}. ${requirement}${onDemand}`;
}