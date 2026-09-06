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
    contentMode: 'structured',
    title: 'Lockout Procedure',
    category: 'Safety',
    shortDescription: 'Safely isolate equipment.',
    richTextContent: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Purpose' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Prevent unexpected startup.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Instructions' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Shut down and isolate.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Safety Information' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Wear required PPE.' }] },
    ] },
    purpose: 'Prevent unexpected startup.',
    instructions: 'Shut down and isolate.',
    safetyInformation: 'Wear required PPE.',
    attachmentFileIds: ['file-1', 'file-2'],
    document: null,
  });
  assert.equal('dueDate' in draft, false);
  assert.equal('recurrenceType' in draft, false);
  assert.equal('checklist' in draft, false);
});

test('published SOPs require employee-readable reference content', () => {
  const invalid = validateSopForPublish({ title: 'Incomplete' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['category', 'richTextContent', 'shortDescription']);

  const valid = validateSopForPublish({
    title: 'Lockout Procedure', category: 'Safety', shortDescription: 'Isolation steps',
    purpose: 'Prevent unexpected startup', instructions: 'Stop, isolate, and verify.',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.draft.richTextContent.content[0].type, 'heading');
});

test('document SOP requires a ready PDF without structured-only fields', () => {
  const valid = validateSopForPublish({
    contentMode: 'document', title: 'Lockout Procedure', category: 'Safety', shortDescription: 'Isolation steps',
    document: { fileId: 'file-1', originalFileName: 'lockout.pdf', mimeType: 'application/pdf', sizeBytes: 4096, uploadedAt: '2026-09-06T12:00:00.000Z', status: 'ready' },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.draft.purpose, '');
  assert.equal(valid.draft.instructions, '');
  assert.equal('recurrenceType' in valid.draft, false);
  assert.equal('checklist' in valid.draft, false);
});