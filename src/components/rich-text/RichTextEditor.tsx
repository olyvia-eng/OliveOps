import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Undo2,
} from "lucide-react";
import { Button } from "../ui";
import type { RichTextDocument } from "../../types/richText";
import { normalizeRichTextDocument, safeRichTextLink } from "../../utils/richText";

const extensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    },
  }),
];

export default function RichTextEditor({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: RichTextDocument;
  onChange: (value: RichTextDocument) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const editor = useEditor({
    extensions,
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "olive-rich-text min-h-80 px-5 py-4 focus:outline-none",
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: current }) => {
      const normalized = normalizeRichTextDocument(current.getJSON());
      if (normalized) onChange(normalized);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(normalizeRichTextDocument(editor.getJSON()));
    const next = JSON.stringify(normalizeRichTextDocument(value));
    if (current !== next) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="min-h-80 rounded-md border border-brand-100 bg-white" />;

  const setLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const requested = window.prompt("Link URL", current ?? "https://");
    if (requested === null) return;
    if (!requested.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = safeRichTextLink(requested);
    if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  const toolbarButton = (label: string, active: boolean, action: () => void, icon: React.ReactNode, enabled = true) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || !enabled}
      className={active ? "bg-brand-100 text-brand-900 dark:bg-brand-600 dark:text-brand-50" : undefined}
      onClick={action}
    >
      {icon}
    </Button>
  );

  return (
    <div className="overflow-hidden rounded-md border border-brand-100 bg-white focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-brand-600 dark:bg-brand-700">
      <div className="flex flex-wrap items-center gap-1 border-b border-brand-100 bg-brand-50 px-2 py-2 dark:border-brand-600 dark:bg-brand-800">
        <label className="sr-only" htmlFor={`${ariaLabel.replace(/\s+/g, "-").toLowerCase()}-style`}>Text style</label>
        <select
          id={`${ariaLabel.replace(/\s+/g, "-").toLowerCase()}-style`}
          aria-label="Text style"
          disabled={disabled}
          value={editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "paragraph"}
          onChange={(event) => {
            const style = event.target.value;
            if (style === "paragraph") editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 }).run();
          }}
          className="h-8 rounded-md border border-brand-200 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50"
        >
          <option value="paragraph">Normal paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <span className="mx-1 h-5 w-px bg-brand-200 dark:bg-brand-600" />
        {toolbarButton("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={15} />)}
        {toolbarButton("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={15} />)}
        {toolbarButton("Bulleted list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={15} />)}
        {toolbarButton("Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={15} />)}
        {toolbarButton("Link", editor.isActive("link"), setLink, <Link2 size={15} />)}
        {toolbarButton("Clear formatting", false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), <RemoveFormatting size={15} />)}
        <span className="mx-1 h-5 w-px bg-brand-200 dark:bg-brand-600" />
        {toolbarButton("Undo", false, () => editor.chain().focus().undo().run(), <Undo2 size={15} />, editor.can().undo())}
        {toolbarButton("Redo", false, () => editor.chain().focus().redo().run(), <Redo2 size={15} />, editor.can().redo())}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
