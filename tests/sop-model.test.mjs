import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSopDraft, validateSopForPublish } from '../api/_lib/sopModel.js';

test('SOP drafts contain reference content without Training semantics', () => {
  const draft = normalizeSopDraft({
    title: '  Lockout Procedure  ',
    category: 'Safety',
    shortDescription: 'Safely isolate equipment.',
    purpose: 'Prevent unexpected startup.',
    instructions: '<b>Shut down</b> and isolate.',
    safetyInformation: 'Wear required PPE.',
    attachmentFileIds: ['file-1', 'file-1', 'file-2'],
    dueDate: '2026-09-05',
    recurrenceType: 'annual',
    checklist: [{ text: 'Complete' }],
  });

  assert.deepEqual(draft, {
    title: 'Lockout Procedure',
    category: 'Safety',
    shortDescription: 'Safely isolate equipment.',
    purpose: 'Prevent unexpected startup.',
    instructions: 'Shut down and isolate.',
    safetyInformation: 'Wear required PPE.',
    attachmentFileIds: ['file-1', 'file-2'],
  });
  assert.equal('dueDate' in draft, false);
  assert.equal('recurrenceType' in draft, false);
  assert.equal('checklist' in draft, false);
});

test('published SOPs require employee-readable reference content', () => {
  const invalid = validateSopForPublish({ title: 'Incomplete' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['category', 'instructions', 'purpose', 'shortDescription']);

  const valid = validateSopForPublish({
    title: 'Lockout Procedure', category: 'Safety', shortDescription: 'Isolation steps',
    purpose: 'Prevent unexpected startup', instructions: 'Stop, isolate, and verify.',
  });
  assert.equal(valid.ok, true);
});