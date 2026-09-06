import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarMonths,
  calculateTrainingCompliance,
  nextDueDateForCompletion,
  normalizeTrainingDraft,
  trainingPresentationStatus,
  validateTrainingForPublish,
} from '../api/_lib/trainingModel.js';

test('calendar recurrence clamps month-end and leap-year dates deterministically', () => {
  assert.equal(addCalendarMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(addCalendarMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addCalendarMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(nextDueDateForCompletion({ completedAt: '2026-01-31T23:00:00.000Z', recurrenceType: 'custom_months', recurrenceMonths: 3, timeZone: 'America/Toronto' }), '2026-04-30');
  assert.equal(nextDueDateForCompletion({ completedAt: '2026-01-31T23:00:00.000Z', recurrenceType: 'one_time', timeZone: 'America/Toronto' }), null);
});

test('status is derived from business dates and recurrence state', () => {
  const now = new Date('2026-09-05T02:00:00.000Z');
  const base = { recurrenceType: 'annual', dueSoonDays: 30 };
  assert.equal(trainingPresentationStatus({ assignment: { ...base, currentDueDate: '2026-09-03' }, now, timeZone: 'America/Toronto' }), 'overdue');
  assert.equal(trainingPresentationStatus({ assignment: { ...base, currentDueDate: '2026-09-04' }, now, timeZone: 'America/Toronto' }), 'due_soon');
  assert.equal(trainingPresentationStatus({ assignment: { ...base, currentDueDate: '2027-01-01' }, now, timeZone: 'America/Toronto' }), 'not_started');
  assert.equal(trainingPresentationStatus({ assignment: { ...base, currentDueDate: '2027-01-01', latestCompletedAt: '2026-01-01T12:00:00Z' }, now, timeZone: 'America/Toronto' }), 'current');
  assert.equal(trainingPresentationStatus({ assignment: { ...base, revokedAt: '2026-01-01T12:00:00Z' }, now, timeZone: 'America/Toronto' }), 'revoked');
});

test('publish validation normalizes ordered Training Sections and nested checklist items', () => {
  const result = validateTrainingForPublish({
    title: ' Saw <b>Safety</b> ', recurrenceType: 'annual',
    trainingSections: [
      { id: 'section-a', heading: ' Inspection ', description: 'First line\nSecond line', checklistItems: [{ id: 'item-a', text: ' Guard fitted ' }, { id: 'blank', text: '   ' }] },
      { sectionId: 'section-b', title: 'Operation', description: '', checklistItems: [{ itemId: 'item-b', text: 'Wear seatbelt' }] },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.draft.title, 'Saw Safety');
  assert.deepEqual(result.draft.trainingSections, [
    { sectionId: 'section-a', title: 'Inspection', description: 'First line\nSecond line', sortOrder: 0, checklistItems: [{ itemId: 'item-a', text: 'Guard fitted', required: true, sortOrder: 0 }] },
    { sectionId: 'section-b', title: 'Operation', description: '', sortOrder: 1, checklistItems: [{ itemId: 'item-b', text: 'Wear seatbelt', required: true, sortOrder: 0 }] },
  ]);
  assert.deepEqual(result.draft.checklist.map((item) => item.itemId), ['item-a', 'item-b']);
  assert.equal(validateTrainingForPublish({ title: '', trainingSections: [], recurrenceType: 'custom_months', recurrenceMonths: 0 }).ok, false);
  assert.equal(normalizeTrainingDraft({}).dueSoonDays, 30);
  assert.equal(normalizeTrainingDraft({}).contentMode, 'structured');
});

test('Training Sections require headings, permit informational sections, and require unique stable IDs', () => {
  assert.equal(validateTrainingForPublish({ title: 'Empty', trainingSections: [] }).errors.trainingSections, 'Add at least one Training Section.');
  assert.equal(validateTrainingForPublish({ title: 'Blank', trainingSections: [{ sectionId: 'a', title: ' ', description: 'Info', checklistItems: [] }] }).errors.trainingSections, 'Every Training Section needs a heading.');
  assert.equal(validateTrainingForPublish({ title: 'Info', trainingSections: [{ sectionId: 'a', title: 'Policy', description: 'Read this', checklistItems: [] }] }).ok, true);
  assert.equal(validateTrainingForPublish({ title: 'Duplicate', trainingSections: [
    { sectionId: 'a', title: 'One', checklistItems: [{ itemId: 'same', text: 'First' }] },
    { sectionId: 'b', title: 'Two', checklistItems: [{ itemId: 'same', text: 'Second' }] },
  ] }).errors.trainingSections, 'Training Section and checklist item IDs must be unique.');
});

test('legacy flat Training content becomes one non-destructive compatibility section', () => {
  const draft = normalizeTrainingDraft({ instructions: 'Read the safety information.', checklist: [{ itemId: 'legacy-a', text: 'Confirm review' }] });
  assert.deepEqual(draft.trainingSections, [{
    sectionId: 'legacy-training-section', title: 'Training Checklist', description: 'Read the safety information.', sortOrder: 0,
    checklistItems: [{ itemId: 'legacy-a', text: 'Confirm review', required: true, sortOrder: 0 }],
  }]);
});

test('document Training requires a validated PDF and permits an optional checklist', () => {
  const pending = validateTrainingForPublish({ contentMode: 'document', title: 'Lift Safety', recurrenceType: 'annual' });
  assert.equal(pending.ok, false);
  assert.equal(pending.errors.document, 'Upload a PDF before publishing.');
  assert.equal('checklist' in pending.errors, false);

  const ready = validateTrainingForPublish({
    contentMode: 'document', title: 'Lift Safety', category: 'Safety', recurrenceType: 'annual', checklist: [],
    document: { fileId: 'file-1', originalFileName: 'lift-safety.pdf', mimeType: 'application/pdf', sizeBytes: 2048, uploadedAt: '2026-09-06T12:00:00.000Z', status: 'ready' },
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.draft.acknowledgementStatement, 'I confirm that I have reviewed and understood this Training document.');
});

test('training compliance excludes revoked work and preserves no-assignment state', () => {
  assert.deepEqual(calculateTrainingCompliance([]), { current: 0, total: 0, dueSoon: 0, overdue: 0, percent: null });
  assert.deepEqual(calculateTrainingCompliance([
    { presentationStatus: 'current' },
    { presentationStatus: 'overdue' },
    { presentationStatus: 'due_soon' },
    { presentationStatus: 'current', revokedAt: '2026-01-01T00:00:00Z' },
  ]), { current: 1, total: 3, dueSoon: 1, overdue: 1, percent: 33 });
});