import {
  cloneFormForBusiness,
  generateId,
  getFormForBusiness,
  listFormFieldsForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  if (req.method !== 'POST' || req.query.action !== 'clone') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
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