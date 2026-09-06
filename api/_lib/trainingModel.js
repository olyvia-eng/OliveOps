import { getBusinessPeriodKeys, normalizeBusinessTimeZone } from './businessTime.js';
import { normalizeContentMode, normalizePdfDocument, validateReadyPdfDocument } from './documentContent.js';

export const TRAINING_RECURRENCE_TYPES = new Set(['one_time', 'annual', 'custom_months']);
export const DEFAULT_TRAINING_ACKNOWLEDGEMENT = 'I confirm that I have read and understood this training and completed each required checklist item.';
export const DEFAULT_DOCUMENT_TRAINING_ACKNOWLEDGEMENT = 'I confirm that I have reviewed and understood this Training document.';

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addCalendarMonths(dateKey, months) {
  if (!validDateKey(dateKey) || !Number.isSafeInteger(months) || months <= 0) {
    throw new TypeError('A valid date and positive calendar-month count are required.');
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function recurrenceMonthsFor(recurrenceType, recurrenceMonths) {
  if (recurrenceType === 'one_time') return null;
  if (recurrenceType === 'annual') return 12;
  if (recurrenceType === 'custom_months' && Number.isSafeInteger(recurrenceMonths) && recurrenceMonths > 0 && recurrenceMonths <= 120) {
    return recurrenceMonths;
  }
  throw new TypeError('A supported recurrence and valid month count are required.');
}

export function nextDueDateForCompletion({ completedAt, recurrenceType, recurrenceMonths, timeZone }) {
  const months = recurrenceMonthsFor(recurrenceType, recurrenceMonths);
  if (months === null) return null;
  const completedDate = getBusinessPeriodKeys(completedAt, normalizeBusinessTimeZone(timeZone)).daily;
  return addCalendarMonths(completedDate, months);
}

export function trainingPresentationStatus({ assignment, now = new Date(), timeZone }) {
  if (assignment?.revokedAt) return 'revoked';
  const today = getBusinessPeriodKeys(now, normalizeBusinessTimeZone(timeZone)).daily;
  const dueDate = assignment?.currentDueDate ?? assignment?.nextDueDate ?? null;
  const completedOneTime = assignment?.recurrenceType === 'one_time' && Boolean(assignment?.latestCompletedAt);
  if (completedOneTime || (!dueDate && assignment?.latestCompletedAt)) return 'current';
  if (!validDateKey(dueDate)) return assignment?.latestCompletedAt ? 'current' : 'not_started';
  if (dueDate < today) return 'overdue';
  const dueSoonDays = Number.isSafeInteger(assignment?.dueSoonDays) ? Math.max(0, assignment.dueSoonDays) : 30;
  const threshold = new Date(`${today}T12:00:00.000Z`);
  threshold.setUTCDate(threshold.getUTCDate() + dueSoonDays);
  if (dueDate <= threshold.toISOString().slice(0, 10)) return 'due_soon';
  return assignment?.latestCompletedAt ? 'current' : 'not_started';
}

export function normalizeTrainingDraft(input = {}) {
  const contentMode = normalizeContentMode(input.contentMode);
  const recurrenceType = TRAINING_RECURRENCE_TYPES.has(input.recurrenceType) ? input.recurrenceType : 'one_time';
  const checklist = Array.isArray(input.checklist) ? input.checklist.map((item, index) => ({
    itemId: cleanText(item?.itemId, 100) || `item-${index + 1}`,
    text: cleanText(item?.text, 500),
    required: true,
    sortOrder: index,
  })).filter((item) => item.text) : [];
  return {
    contentMode,
    title: cleanText(input.title, 160),
    category: cleanText(input.category, 100),
    shortDescription: cleanText(input.shortDescription, 500),
    instructions: cleanText(input.instructions, 20_000),
    attachmentFileId: cleanText(input.attachmentFileId, 160) || null,
    checklist,
    acknowledgementStatement: cleanText(input.acknowledgementStatement, 1_000) || (contentMode === 'document' ? DEFAULT_DOCUMENT_TRAINING_ACKNOWLEDGEMENT : DEFAULT_TRAINING_ACKNOWLEDGEMENT),
    document: contentMode === 'document' ? normalizePdfDocument(input.document) : null,
    recurrenceType,
    recurrenceMonths: recurrenceType === 'custom_months' ? Number(input.recurrenceMonths) : null,
    dueSoonDays: Number.isSafeInteger(Number(input.dueSoonDays)) ? Math.min(365, Math.max(0, Number(input.dueSoonDays))) : 30,
    active: input.active !== false,
  };
}

export function validateTrainingForPublish(input) {
  const draft = normalizeTrainingDraft(input);
  const errors = {};
  if (!draft.title) errors.title = 'Title is required.';
  if (draft.contentMode === 'document') {
    const documentError = validateReadyPdfDocument(draft.document);
    if (documentError) errors.document = documentError;
  } else {
    if (!draft.instructions && !draft.attachmentFileId) errors.content = 'Instructions or an attachment is required.';
    if (draft.checklist.length === 0) errors.checklist = 'Add at least one required checklist item.';
  }
  try {
    recurrenceMonthsFor(draft.recurrenceType, draft.recurrenceMonths);
  } catch {
    errors.recurrenceMonths = 'Enter a valid positive month count.';
  }
  return { ok: Object.keys(errors).length === 0, errors, draft };
}

export function calculateTrainingCompliance(assignments = []) {
  const active = assignments.filter((assignment) => !assignment.revokedAt);
  const current = active.filter((assignment) => assignment.presentationStatus === 'current').length;
  const dueSoon = active.filter((assignment) => assignment.presentationStatus === 'due_soon').length;
  const overdue = active.filter((assignment) => assignment.presentationStatus === 'overdue').length;
  return {
    current,
    total: active.length,
    dueSoon,
    overdue,
    percent: active.length === 0 ? null : Math.round((current / active.length) * 100),
  };
}