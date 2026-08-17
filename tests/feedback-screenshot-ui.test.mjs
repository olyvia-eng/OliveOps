import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('feedback screenshot area supports validated browse, drag and drop, replace, and remove', () => {
  const modal = readFileSync('src/components/feedback/FeedbackModal.tsx', 'utf8');
  const submission = readFileSync('src/components/feedback/useFeedbackSubmission.ts', 'utf8');

  assert.match(modal, /onDragEnter/);
  assert.match(modal, /onDragOver/);
  assert.match(modal, /onDrop/);
  assert.match(modal, /event\.dataTransfer\.files\?\.\[0\]/);
  assert.match(modal, /validateUploadPayload/);
  assert.match(modal, /Drag and drop a screenshot here/);
  assert.match(modal, /Replace File/);
  assert.match(modal, /Remove screenshot/);
  assert.match(submission, /deferNotification: Boolean\(input\.screenshotFile\)/);
  assert.match(submission, /action: 'notify', feedbackId: payload\.feedbackId/);
});