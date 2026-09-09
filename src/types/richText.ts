export type RichTextMark =
  | { type: "bold" | "italic" | "underline" }
  | {
      type: "link";
      attrs: {
        href: string;
        target?: "_blank";
        rel?: string;
      };
    };

export interface RichTextNode {
  type:
    | "doc"
    | "paragraph"
    | "heading"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "text"
    | "hardBreak";
  attrs?: { level?: 1 | 2 | 3; start?: number; type?: null };
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
}

export interface RichTextDocument extends RichTextNode {
  type: "doc";
}

export const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
