const MAX_DOCUMENT_BYTES = 100_000;
const MAX_TEXT_LENGTH = 60_000;
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem']);
const MARK_TYPES = new Set(['bold', 'italic', 'link']);

const cleanText = (value) => typeof value === 'string'
  ? [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join('').slice(0, MAX_TEXT_LENGTH)
  : '';

function safeLink(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  const href = value.trim();
  if (!/^(https?:|mailto:|tel:)/i.test(href)) return null;
  return href;
}

function normalizeMarks(marks) {
  if (!Array.isArray(marks)) return undefined;
  const normalized = marks.flatMap((mark) => {
    if (!mark || !MARK_TYPES.has(mark.type)) return [];
    if (mark.type !== 'link') return [{ type: mark.type }];
    const href = safeLink(mark.attrs?.href);
    return href ? [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } }] : [];
  });
  return normalized.length ? normalized : undefined;
}

function childIsAllowed(parentType, childType) {
  if (parentType === 'doc') return ['paragraph', 'heading', 'bulletList', 'orderedList'].includes(childType);
  if (parentType === 'paragraph' || parentType === 'heading') return childType === 'text' || childType === 'hardBreak';
  if (parentType === 'bulletList' || parentType === 'orderedList') return childType === 'listItem';
  if (parentType === 'listItem') return ['paragraph', 'bulletList', 'orderedList'].includes(childType);
  return false;
}

function normalizeNode(node, parentType, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return null;
  if (!childIsAllowed(parentType, node.type)) return null;
  if (node.type === 'text') {
    const text = cleanText(node.text);
    if (!text) return null;
    const marks = normalizeMarks(node.marks);
    return { type: 'text', text, ...(marks ? { marks } : {}) };
  }
  if (node.type === 'hardBreak') return { type: 'hardBreak' };
  if (!BLOCK_TYPES.has(node.type)) return null;
  const content = Array.isArray(node.content)
    ? node.content.map((child) => normalizeNode(child, node.type, depth + 1)).filter(Boolean)
    : [];
  if (node.type === 'heading') {
    const level = [1, 2, 3].includes(Number(node.attrs?.level)) ? Number(node.attrs.level) : 2;
    return { type: 'heading', attrs: { level }, ...(content.length ? { content } : {}) };
  }
  if (node.type === 'orderedList') {
    const start = Number.isSafeInteger(Number(node.attrs?.start)) ? Math.max(1, Number(node.attrs.start)) : 1;
    return { type: 'orderedList', attrs: { start, type: null }, ...(content.length ? { content } : {}) };
  }
  return { type: node.type, ...(content.length ? { content } : {}) };
}

export function emptyRichTextDocument() {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function normalizeRichTextDocument(value) {
  if (!value || typeof value !== 'object') return null;
  let serialized;
  try { serialized = JSON.stringify(value); } catch { return null; }
  if (serialized.length > MAX_DOCUMENT_BYTES || value.type !== 'doc') return null;
  const content = Array.isArray(value.content)
    ? value.content.map((node) => normalizeNode(node, 'doc')).filter(Boolean)
    : [];
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

export function richTextHasText(value) {
  const document = normalizeRichTextDocument(value);
  if (!document) return false;
  const visit = (node) => node.type === 'text' ? Boolean(node.text.trim()) : Array.isArray(node.content) && node.content.some(visit);
  return document.content.some(visit);
}

const textNode = (text) => ({ type: 'text', text: cleanText(text) });
const cleanLegacyText = (value) => cleanText(value).replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ');
const paragraphNodes = (value) => cleanLegacyText(value).split(/\r?\n/).filter((line) => line.trim()).map((line) => ({ type: 'paragraph', content: [textNode(line.trim())] }));

export function richTextFromLegacySop(input = {}) {
  const sections = [
    ['Purpose', input.purpose],
    ['Instructions', input.instructions],
    ['Safety Information', input.safetyInformation],
  ];
  const content = sections.flatMap(([heading, value]) => {
    const paragraphs = paragraphNodes(value);
    return paragraphs.length ? [{ type: 'heading', attrs: { level: 2 }, content: [textNode(heading)] }, ...paragraphs] : [];
  });
  return content.length ? { type: 'doc', content } : emptyRichTextDocument();
}

export function normalizeSopRichText(input = {}) {
  return normalizeRichTextDocument(input.richTextContent) ?? richTextFromLegacySop(input);
}
