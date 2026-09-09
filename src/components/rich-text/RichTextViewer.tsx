import type { ReactNode } from "react";
import type { RichTextDocument, RichTextMark, RichTextNode } from "../../types/richText";
import { normalizeRichTextDocument } from "../../utils/richText";

function applyMarks(content: ReactNode, marks: RichTextMark[] | undefined, key: string) {
  return (marks ?? []).reduce<ReactNode>((current, mark, index) => {
    if (mark.type === "bold") return <strong key={`${key}-bold-${index}`}>{current}</strong>;
    if (mark.type === "italic") return <em key={`${key}-italic-${index}`}>{current}</em>;
    if (mark.type === "underline") return <u key={`${key}-underline-${index}`}>{current}</u>;
    if (mark.type === "link") return <a key={`${key}-link-${index}`} href={mark.attrs.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900 dark:text-brand-200">{current}</a>;
    return current;
  }, content);
}

function renderNode(node: RichTextNode, key: string): ReactNode {
  if (node.type === "text") return applyMarks(node.text ?? "", node.marks, key);
  if (node.type === "hardBreak") return <br key={key} />;
  const children = (node.content ?? []).map((child, index) => renderNode(child, `${key}-${index}`));
  if (node.type === "paragraph") return <p key={key}>{children}</p>;
  if (node.type === "heading") {
    if (node.attrs?.level === 1) return <h2 key={key} className="text-xl font-semibold text-gray-900 dark:text-brand-50">{children}</h2>;
    if (node.attrs?.level === 3) return <h4 key={key} className="text-base font-semibold text-gray-900 dark:text-brand-50">{children}</h4>;
    return <h3 key={key} className="text-lg font-semibold text-gray-900 dark:text-brand-50">{children}</h3>;
  }
  if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
  if (node.type === "orderedList") return <ol key={key} start={node.attrs?.start ?? 1}>{children}</ol>;
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  return null;
}

export default function RichTextViewer({ document, emptyMessage = "No content provided." }: { document: RichTextDocument | null | undefined; emptyMessage?: string }) {
  const safeDocument = normalizeRichTextDocument(document);
  if (!safeDocument || !safeDocument.content?.some((node) => node.content?.length)) {
    return <p className="text-sm text-gray-500 dark:text-brand-300">{emptyMessage}</p>;
  }
  return <div className="olive-rich-text olive-rich-text-viewer">{safeDocument.content?.map((node, index) => renderNode(node, String(index)))}</div>;
}
