import {
  cloneFormForBusiness,
  createFormFromTemplateForBusiness,
  generateId,
  getFormForBusiness,
  listFormFieldsForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { getFormTemplate, getFormTemplateDeliveryRule } from '../shared/formTemplates.js';
import { deliveryRuleToLegacyTriggers } from '../src/utils/formDeliveryRules.js';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  if (req.method !== 'POST' || !['clone', 'instantiate-template'].includes(req.query.action)) {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (req.query.action === 'instantiate-template') {
    const templateId = text(req.body?.templateId);
    const requestId = text(req.body?.requestId);
    if (!templateId) return res.status(400).json({ ok: false, error: 'Form Template is required.' });
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return res.status(400).json({ ok: false, error: 'Template creation request is invalid.' });
    const template = getFormTemplate(templateId);
    if (!template) return res.status(404).json({ ok: false, error: 'Form Template not found.' });

    const now = new Date().toISOString();
    const formId = generateId();
    const deliveryRule = template.deliveryRule ?? getFormTemplateDeliveryRule(template.name);
    const form = {
      id: formId,
      name: template.name,
      description: template.description,
      category: template.category,
      status: 'draft',
      assignedTo: 'everyone',
      assignmentValue: '',
      trigger: deliveryRuleToLegacyTriggers(deliveryRule),
      deliveryRule,
      deliveryRuleVersion: 1,
      completionRequirement: deliveryRule.completionBehavior === 'blocking' ? 'required' : 'reminder',
      requiresApproval: false,
      division: '',
      createdByUserId: session.id,
      sourceTemplateId: template.id,
      createdAt: now,
      updatedAt: now,
    };
    const fields = template.fields.map((field, order) => ({
      id: generateId(),
      formId,
      type: field.type,
      label: field.label,
      helpText: field.helpText ?? '',
      required: Boolean(field.required),
      defaultValue: field.defaultValue ?? '',
      placeholder: field.placeholder ?? '',
      options: [...field.options],
      acceptedResponse: field.acceptedResponse ? { ...field.acceptedResponse } : undefined,
      order,
    }));

    try {
      const result = await createFormFromTemplateForBusiness({
        businessId: session.businessId,
        requestId,
        templateId: template.id,
        form,
        fields,
        auditEvent: {
          id: generateId(),
          action: 'form_created_from_template',
          actorUserId: session.id,
          actorName: session.name ?? session.email ?? session.id,
          actorEmail: session.email ?? '',
          affectedEntryCount: fields.length + 1,
          createdAt: now,
          metadata: { templateId: template.id, formId },
        },
      });
      if (!result.ok) return res.status(409).json(result);
      if (!result.created) {
        const [existingForm, allFields] = await Promise.all([
          getFormForBusiness(session.businessId, result.formId),
          listFormFieldsForBusiness(session.businessId),
        ]);
        if (!existingForm) return res.status(409).json({ ok: false, error: 'Template creation could not be recovered.' });
        return res.status(200).json({
          ok: true,
          form: existingForm,
          fields: allFields.filter((field) => field.formId === existingForm.id).sort((left, right) => left.order - right.order),
        });
      }
      return res.status(201).json({ ok: true, form, fields });
    } catch (error) {
      if (error instanceof RangeError) return res.status(400).json({ ok: false, error: error.message });
      return res.status(409).json({ ok: false, error: 'Form could not be created from this Template. Nothing was saved.' });
    }
  }

  const sourceFormId = text(req.body?.sourceFormId);
  if (!sourceFormId) return res.status(400).json({ ok: false, error: 'Source Form is required.' });

  const [source, allFields] = await Promise.all([
    getFormForBusiness(session.businessId, sourceFormId),
    listFormFieldsForBusiness(session.businessId),
  ]);
  if (!source) return res.status(404).json({ ok: false, error: 'Source Form not found.' });

  const now = new Date().toISOString();
  const form = {
    ...source,
    id: generateId(),
    name: `${source.name} - Copy`,
    status: 'draft',
    trigger: [],
    clonedFromFormId: source.id,
    createdByUserId: session.id,
    createdAt: now,
    updatedAt: now,
  };
  const fields = allFields
    .filter((field) => field.formId === source.id)
    .sort((left, right) => left.order - right.order)
    .map((field) => ({
      ...field,
      id: generateId(),
      formId: form.id,
      options: [...(field.options ?? [])],
      acceptedResponse: field.acceptedResponse ? { ...field.acceptedResponse } : undefined,
    }));

  try {
    await cloneFormForBusiness({
      businessId: session.businessId,
      form,
      fields,
      auditEvent: {
        id: generateId(),
        action: 'form_cloned',
        actorUserId: session.id,
        actorName: session.name ?? session.email ?? session.id,
        actorEmail: session.email ?? '',
        affectedEntryCount: fields.length + 1,
        createdAt: now,
        metadata: { sourceFormId: source.id, clonedFormId: form.id },
      },
    });
  } catch (error) {
    if (error instanceof RangeError) return res.status(400).json({ ok: false, error: error.message });
    throw error;
  }

  return res.status(201).json({ ok: true, form, fields });
}