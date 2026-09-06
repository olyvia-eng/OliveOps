# SOP and Training rich-text contract

Structured SOPs and Training modules use a single `richTextContent` JSON document. PDF-backed records continue to use `contentMode: "document"` and the existing private document flow.

## Authoring behavior

- SOPs keep title, category, and short description, followed by one **Procedure content** editor.
- Training keeps title, category, and short description, followed by one **Training content** editor.
- Training completion checklist, acknowledgement, renewal, and supplemental attachment remain separate controls.
- The editor supports paragraphs, headings 1-3, bold, italic, bullet lists, numbered lists, links, clear formatting, undo, and redo.
- Published SOP and Training versions contain immutable copies of `richTextContent`.
- Training completions contain the exact `richTextContent` copied from the completed Training version.

## API shape

`richTextContent` is an additive field on structured SOP and Training definitions and versions. It is also returned on Training completion snapshots.

```ts
type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | {
      type: "link";
      attrs: {
        href: string;
        target: "_blank";
        rel: "noopener noreferrer nofollow";
      };
    };

type RichTextNode = {
  type:
    | "doc"
    | "paragraph"
    | "heading"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "text"
    | "hardBreak";
  attrs?: {
    level?: 1 | 2 | 3;
    start?: number;
    type?: null;
  };
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

type RichTextDocument = RichTextNode & { type: "doc" };
```

The field is server-normalized before persistence. API clients must treat unknown future node or mark types as unsupported and skip them safely.

## Compatibility

No data migration is required. Records without `contentMode` remain structured. Records without `richTextContent` are converted at read/normalization time:

- SOP `purpose`, `instructions`, and `safetyInformation` become labeled sections in one document.
- Training `instructions` or `employeeInstructions` becomes paragraph content.

The API continues returning and accepting the legacy plain-text fields during the compatibility period. Clients should prefer `richTextContent` when present and fall back to those fields when absent. This permits web and mobile releases to roll out independently.

## Security

The API accepts JSON, not HTML. Normalization enforces:

- a maximum serialized document size of 100,000 characters;
- a maximum text length of 60,000 characters;
- a maximum nesting depth of 12;
- the node and mark allowlists above;
- valid parent/child relationships;
- link schemes limited to `http:`, `https:`, `mailto:`, and `tel:`;
- reconstructed link attributes using `_blank` and `noopener noreferrer nofollow`;
- removal of unknown attributes, nodes, marks, scripts, event handlers, and unsafe links.

The web reader renders normalized nodes as React elements and never uses `dangerouslySetInnerHTML`.

## Mobile changes required

The mobile repository was inspected at `C:\Users\Ryan\OliveOps\OliveOps-mobile`. No mobile files were created or changed in this work.

Update these existing mobile files:

1. `src/types/sop.ts`
   - Add `richTextContent?: RichTextDocument` to the published SOP type.
   - Keep `purpose`, `instructions`, and `safetyInformation` during the compatibility period.

2. `src/types/training.ts`
   - Add `richTextContent?: RichTextDocument` to `TrainingVersion`.
   - Add `richTextContent?: RichTextDocument` to `TrainingCompletion` if completion history displays completed content.
   - Keep `instructions` during the compatibility period.

3. Add a shared native read-only rich-text renderer.
   - Render paragraph and heading nodes with React Native `Text`.
   - Render bullet and ordered lists with nested `View`/`Text` rows.
   - Apply bold and italic marks through text styles.
   - Open only allowlisted links through `Linking.openURL` after validating the scheme again on-device.
   - Ignore unknown nodes, marks, and attributes.
   - Do not use a WebView or inject HTML.

4. `app/sop-detail.tsx`
   - For structured SOPs, render `richTextContent` with the native reader.
   - Fall back to the existing Purpose, Instructions, and Safety information sections when the field is absent.
   - Keep `AuthorizedPdfViewer` unchanged for document mode.

5. `app/training-detail.tsx`
   - For structured Training, render the assigned immutable version's `richTextContent`.
   - Fall back to `version.instructions` when the field is absent.
   - Keep the checklist and acknowledgement separate from document content.
   - Keep `AuthorizedPdfViewer` unchanged for document mode.

6. Mobile tests
   - Add renderer tests for headings, paragraphs, bullet/ordered lists, bold, italic, links, unsupported nodes, and unsafe links.
   - Extend `tests/app/training-detail.screen.test.tsx` for rich content and legacy fallback.
   - Extend the SOP detail screen tests for rich content and legacy fallback.
   - Keep the existing PDF viewer tests.

The existing `loadMyTrainingDetail` response already returns a `TrainingVersion`, so no endpoint or navigation change is required. The web API remains backward-compatible while the mobile renderer is delivered.
