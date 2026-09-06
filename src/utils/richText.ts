import type { RichTextDocument, RichTextMark, RichTextNode } from "../types/richText";
import { EMPTY_RICH_TEXT_DOCUMENT } from "../types/richText";

const BLOCK_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem"]);
const MARK_TYPES = new Set(["bold", "italic", "link"]);

const cleanText = (value: unknown) =>
  typeof value === "string"
    ? [...value]
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
        })
        .join("")
        .slice(0, 60_000)
    : "";

export function safeRichTextLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  const href = value.trim();
  return /^(https?:|mailto:|tel:)/i.test(href) ? href : null;
}

function allowedChild(parent: RichTextNode["type"], child: RichTextNode["type"]) {
  if (parent === "doc") return ["paragraph", "heading", "bulletList", "orderedList"].includes(child);
  if (parent === "paragraph" || parent === "heading") return child === "text" || child === "hardBreak";
  if (parent === "bulletList" || parent === "orderedList") return child === "listItem";
  if (parent === "listItem") return ["paragraph", "bulletList", "orderedList"].includes(child);
  return false;
}

function normalizeMarks(value: unknown): RichTextMark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const marks = value.flatMap((mark): RichTextMark[] => {
    if (!mark || typeof mark !== "object" || !("type" in mark) || !MARK_TYPES.has(String(mark.type))) return [];
    if (mark.type === "bold" || mark.type === "italic") return [{ type: mark.type }];
    const href = safeRichTextLink("attrs" in mark && mark.attrs && typeof mark.attrs === "object" && "href" in mark.attrs ? mark.attrs.href : null);
    return href ? [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } }] : [];
  });
  return marks.length ? marks : undefined;
}

function normalizeNode(value: unknown, parent: RichTextNode["type"], depth = 0): RichTextNode | null {
  if (!value || typeof value !== "object" || depth > 12 || !("type" in value)) return null;
  const node = value as RichTextNode;
  if (!allowedChild(parent, node.type)) return null;
  if (node.type === "text") {
    const text = cleanText(node.text);
    const marks = normalizeMarks(node.marks);
    return text ? { type: "text", text, ...(marks ? { marks } : {}) } : null;
  }
  if (node.type === "hardBreak") return { type: "hardBreak" };
  if (!BLOCK_TYPES.has(node.type)) return null;
  const content = Array.isArray(node.content)
    ? node.content.map((child) => normalizeNode(child, node.type, depth + 1)).filter((child): child is RichTextNode => Boolean(child))
    : [];
  if (node.type === "heading") {
    const level = [1, 2, 3].includes(Number(node.attrs?.level)) ? (Number(node.attrs?.level) as 1 | 2 | 3) : 2;
    return { type: "heading", attrs: { level }, ...(content.length ? { content } : {}) };
  }
  if (node.type === "orderedList") {
    const start = Number.isSafeInteger(Number(node.attrs?.start)) ? Math.max(1, Number(node.attrs?.start)) : 1;
    return { type: "orderedList", attrs: { start, type: null }, ...(content.length ? { content } : {}) };
  }
  return { type: node.type, ...(content.length ? { content } : {}) };
}

export function normalizeRichTextDocument(value: unknown): RichTextDocument | null {
  if (!value || typeof value !== "object") return null;
  try {
    if (JSON.stringify(value).length > 100_000) return null;
  } catch {
    return null;
  }
  const input = value as RichTextDocument;
  if (input.type !== "doc") return null;
  const content = Array.isArray(input.content)
    ? input.content.map((node) => normalizeNode(node, "doc")).filter((node): node is RichTextNode => Boolean(node))
    : [];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const legacyParagraphs = (value: unknown): RichTextNode[] =>
  cleanText(value)
    .replace(/<[^>]*>/g, " ")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line.trim() }] }));

export function sopRichTextContent(value: { richTextContent?: unknown; purpose?: string; instructions?: string; safetyInformation?: string }): RichTextDocument {
  const normalized = normalizeRichTextDocument(value.richTextContent);
  if (normalized) return normalized;
  const sections = [["Purpose", value.purpose], ["Instructions", value.instructions], ["Safety Information", value.safetyInformation]] as const;
  const content = sections.flatMap(([heading, text]) => {
    const paragraphs = legacyParagraphs(text);
    return paragraphs.length ? [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: heading }] } as RichTextNode, ...paragraphs] : [];
  });
  return content.length ? { type: "doc", content } : EMPTY_RICH_TEXT_DOCUMENT;
}
