import { getBusinessPeriodKeys, normalizeBusinessTimeZone } from './businessTime.js';
import { normalizeContentMode, normalizePdfDocument, validateReadyPdfDocument } from './documentContent.js';

export const TRAINING_RECURRENCE_TYPES = new Set(['one_time', 'annual', 'custom_months']);
export const DEFAULT_TRAINING_ACKNOWLEDGEMENT = 'I confirm that I have read and understood this training and completed each required checklist item.';
export const DEFAULT_DOCUMENT_TRAINING_ACKNOWLEDGEMENT = 'I confirm that I have reviewed and understood this Training document.';

function normalizeChecklist(items, sectionIndex = 0) {
  return Array.isArray(items) ? items.map((item, itemIndex) => ({
    itemId: cleanText(item?.itemId ?? item?.id, 100) || `section-${sectionIndex + 1}-item-${itemIndex + 1}`,
    text: cleanText(item?.text, 500),
    required: true,
    sortOrder: itemIndex,
  })).filter((item) => item.text) : [];
}

export function normalizeTrainingSections(input = {}) {
  if (Array.isArray(input.trainingSections)) {
    return input.trainingSections.slice(0, 100).map((section, sectionIndex) => ({
      sectionId: cleanText(section?.sectionId ?? section?.id, 100) || `section-${sectionIndex + 1}`,
      title: cleanText(section?.title ?? section?.heading, 160),
      description: cleanMultiline(section?.description, 4_000),
      sortOrder: sectionIndex,
      checklistItems: normalizeChecklist(section?.checklistItems, sectionIndex),
    }));
  }
  const checklistItems = normalizeChecklist(input.checklist);
  const description = cleanText(input.instructions ?? input.employeeInstructions, 4_000);
  if (!checklistItems.length && !description) return [];
  return [{
    sectionId: 'legacy-training-section',
    title: 'Training Checklist',
    description,
    sortOrder: 0,
    checklistItems,
  }];
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanMultiline(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim().slice(0, maxLength);
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
  const trainingSections = normalizeTrainingSections(input);
  const checklist = trainingSections.flatMap((section) => section.checklistItems);
  return {
    contentMode,
    title: cleanText(input.title, 160),
    category: cleanText(input.category, 100),
    shortDescription: cleanText(input.shortDescription, 500),
    instructions: cleanText(input.instructions, 20_000),
    attachmentFileId: cleanText(input.attachmentFileId, 160) || null,
    checklist,
    trainingSections,
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
    if (draft.trainingSections.length === 0) errors.trainingSections = 'Add at least one Training Section.';
    if (draft.trainingSections.some((section) => !section.title)) errors.trainingSections = 'Every Training Section needs a heading.';
    const sectionIds = draft.trainingSections.map((section) => section.sectionId);
    const itemIds = draft.trainingSections.flatMap((section) => section.checklistItems.map((item) => item.itemId));
    if (new Set(sectionIds).size !== sectionIds.length || new Set(itemIds).size !== itemIds.length) errors.trainingSections = 'Training Section and checklist item IDs must be unique.';
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