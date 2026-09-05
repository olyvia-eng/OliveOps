const MAX_ATTACHMENTS = 10;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeSopDraft(input = {}) {
  const attachmentFileIds = Array.isArray(input.attachmentFileIds)
    ? [...new Set(input.attachmentFileIds
      .map((value) => cleanText(value, 160))
      .filter(Boolean))].slice(0, MAX_ATTACHMENTS)
    : [];

  return {
    title: cleanText(input.title, 160),
    category: cleanText(input.category, 100),
    shortDescription: cleanText(input.shortDescription, 500),
    purpose: cleanText(input.purpose, 4_000),
    instructions: cleanText(input.instructions, 30_000),
    safetyInformation: cleanText(input.safetyInformation, 8_000),
    attachmentFileIds,
  };
}

export function validateSopForPublish(input) {
  const draft = normalizeSopDraft(input);
  const errors = {};
  if (!draft.title) errors.title = 'Title is required.';
  if (!draft.category) errors.category = 'Category is required.';
  if (!draft.shortDescription) errors.shortDescription = 'Short description is required.';
  if (!draft.purpose) errors.purpose = 'Purpose is required.';
  if (!draft.instructions) errors.instructions = 'Procedure or instructions are required.';
  return { ok: Object.keys(errors).length === 0, errors, draft };
}