import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRichTextDocument,
  richTextFromLegacySop,
  richTextFromLegacyTraining,
  richTextHasText,
} from '../api/_lib/richText.js';

test('rich-text normalization preserves the supported document schema', () => {
  const document = normalizeRichTextDocument({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, onclick: 'attack()' }, content: [{ type: 'text', text: 'Safe work' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Read ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'carefully', marks: [{ type: 'italic' }, { type: 'link', attrs: { href: 'https://example.com/guide', onclick: 'attack()' } }] },
      ] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wear PPE' }] }] }] },
      { type: 'orderedList', attrs: { start: 2, style: 'attack' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lock out' }] }] }] },
    ],
  });

  assert.equal(document.content[0].attrs.onclick, undefined);
  assert.deepEqual(document.content[1].content[1].marks[1], {
    type: 'link',
    attrs: { href: 'https://example.com/guide', target: '_blank', rel: 'noopener noreferrer nofollow' },
  });
  assert.equal(document.content[2].type, 'bulletList');
  assert.equal(document.content[3].attrs.start, 2);
  assert.equal(document.content[3].attrs.style, undefined);
  assert.equal(richTextHasText(document), true);
});

test('rich-text normalization removes unsupported nodes, marks, hierarchy, and unsafe links', () => {
  const document = normalizeRichTextDocument({
    type: 'doc',
    content: [
      { type: 'script', content: [{ type: 'text', text: 'attack()' }] },
      { type: 'text', text: 'invalid root text' },
      { type: 'paragraph', content: [
        { type: 'image', attrs: { src: 'x', onerror: 'attack()' } },
        { type: 'text', text: 'Kept', marks: [{ type: 'link', attrs: { href: 'javascript:attack()' } }, { type: 'code' }] },
      ] },
    ],
  });

  assert.deepEqual(document, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] }] });
  assert.equal(richTextHasText({ type: 'doc', content: [{ type: 'paragraph' }] }), false);
});

test('legacy SOP and Training fields remain readable without migration', () => {
  const sop = richTextFromLegacySop({ purpose: '<b>Prevent startup</b>', instructions: 'Stop\nIsolate', safetyInformation: 'Wear PPE' });
  const training = richTextFromLegacyTraining({ employeeInstructions: '<script>bad()</script>Read the policy' });

  assert.deepEqual(sop.content.map((node) => node.type), ['heading', 'paragraph', 'heading', 'paragraph', 'paragraph', 'heading', 'paragraph']);
  assert.equal(sop.content[1].content[0].text, 'Prevent startup');
  assert.equal(training.content[0].content[0].text, 'bad() Read the policy');
});

test('oversized and malformed rich-text payloads are rejected', () => {
  assert.equal(normalizeRichTextDocument(null), null);
  assert.equal(normalizeRichTextDocument({ type: 'other', content: [] }), null);
  assert.equal(normalizeRichTextDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(100_001) }] }] }), null);
});
