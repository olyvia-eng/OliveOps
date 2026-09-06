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

test('publish validation normalizes required checklist content', () => {
  const result = validateTrainingForPublish({ title: ' Saw <b>Safety</b> ', instructions: 'Read this.', checklist: [{ itemId: 'stable', text: ' Guard fitted ' }], recurrenceType: 'annual' });
  assert.equal(result.ok, true);
  assert.equal(result.draft.title, 'Saw Safety');
  assert.deepEqual(result.draft.checklist, [{ itemId: 'stable', text: 'Guard fitted', required: true, sortOrder: 0 }]);
  assert.equal(validateTrainingForPublish({ title: '', checklist: [], recurrenceType: 'custom_months', recurrenceMonths: 0 }).ok, false);
  assert.equal(normalizeTrainingDraft({}).dueSoonDays, 30);
  assert.equal(normalizeTrainingDraft({}).contentMode, 'structured');
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