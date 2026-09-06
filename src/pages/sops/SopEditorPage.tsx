import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Trash2, Upload } from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button, Card, Input, TextArea } from "../../components/ui";
import {
  AuthorizedPdfPreview,
  CreationMethodChoice,
  PdfDropzone,
} from "../../components/documents/PdfDocumentControls";
import type { SopContent, SopDefinition } from "../../types/sop";
import { uploadFileToStorage } from "../../utils/fileUpload";
import { createSop, getSop, publishSop, updateSopDraft } from "./sopApi";

const emptySop = (
  contentMode: "structured" | "document" = "structured",
): SopContent => ({
  contentMode,
  title: "",
  category: "",
  shortDescription: "",
  purpose: "",
  instructions: "",
  safetyInformation: "",
  attachmentFileIds: [],
  document: null,
});

export default function SopEditorPage() {
  const { sopId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  if (!sopId && requestedMode !== "structured" && requestedMode !== "document")
    return <CreationMethodChoice resource="SOP" />;
  const initialMode = requestedMode === "document" ? "document" : "structured";
  return <SopEditor key={sopId ?? initialMode} initialMode={initialMode} />;
}

function SopEditor({
  initialMode,
}: {
  initialMode: "structured" | "document";
}) {
  const { sopId } = useParams();
  const navigate = useNavigate();
  const [definition, setDefinition] = useState<SopDefinition | null>(null);
  const [draft, setDraft] = useState<SopContent>(() => emptySop(initialMode));
  const [attachmentNames, setAttachmentNames] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(Boolean(sopId));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [error, setError] = useState("");
  const publishRequestId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!sopId) return;
    void getSop(sopId)
      .then((payload) => {
        setDefinition(payload.definition);
        setDraft({
          ...payload.definition,
          contentMode: payload.definition.contentMode ?? "structured",
          document: payload.definition.document ?? null,
        });
        setError("");
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "SOP could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, [sopId]);

  const persist = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = definition
        ? await updateSopDraft(definition.id, draft)
        : await createSop(draft);
      setDefinition(payload.definition);
      setDraft(payload.definition);
      if (!definition)
        navigate(`/sops/${payload.definition.id}/edit`, { replace: true });
      return payload.definition;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "SOP draft could not be saved.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  const uploadAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const invalid = selected.find(
      (file) => !/\.(pdf|doc|docx)$/i.test(file.name),
    );
    if (invalid) {
      setError("Attachments must be PDF, DOC, or DOCX files.");
      return;
    }
    const saved = definition ?? (await persist());
    if (!saved) return;
    setUploading(true);
    setError("");
    try {
      const uploads = await Promise.all(
        selected.map(async (file) => ({
          file,
          result: await uploadFileToStorage({
            file,
            entityType: "sop",
            entityId: saved.id,
            category: "attachment",
          }),
        })),
      );
      const next: SopContent = {
        ...draft,
        attachmentFileIds: [
          ...draft.attachmentFileIds,
          ...uploads.map(({ result }) => result.fileId),
        ],
      };
      const payload = await updateSopDraft(saved.id, next);
      setDraft(next);
      setDefinition(payload.definition);
      setAttachmentNames((current) => ({
        ...current,
        ...Object.fromEntries(
          uploads.map(({ file, result }) => [result.fileId, file.name]),
        ),
      }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Attachments could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (fileId: string) => {
    setDraft((current) => ({
      ...current,
      attachmentFileIds: current.attachmentFileIds.filter(
        (id) => id !== fileId,
      ),
    }));
  };

  const publish = async () => {
    setPublishing(true);
    setError("");
    try {
      const saved = await persist();
      if (!saved) return;
      await publishSop(saved.id, publishRequestId.current);
      navigate(`/sops/${saved.id}`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "SOP could not be published.",
      );
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        saving ||
        publishing ||
        uploading ||
        uploadingDocument ||
        (definition &&
          JSON.stringify(draft) !==
            JSON.stringify({
              ...definition,
              contentMode: definition.contentMode ?? "structured",
              document: definition.document ?? null,
            }))
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [definition, draft, publishing, saving, uploading, uploadingDocument]);

  const isDocument =
    (definition?.contentMode ?? draft.contentMode) === "document";

  if (loading)
    return (
      <Card className="p-6">
        <p className="text-sm text-gray-500">Loading SOP...</p>
      </Card>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        to={definition ? `/sops/${definition.id}` : "/sops/new"}
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"
      >
        <ArrowLeft size={15} /> {definition ? "SOP Library" : "Creation method"}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">
          {definition ? `Edit ${definition.title || "SOP"}` : "New SOP"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Save working changes, then publish an immutable version when the
          procedure is ready.
        </p>
      </header>
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Procedure identity</h2>
          <p className="text-sm text-gray-500">
            Use a clear name and category so the procedure is easy to find.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Title"
            required
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
          <Input
            label="Category"
            required
            value={draft.category}
            onChange={(event) =>
              setDraft({ ...draft, category: event.target.value })
            }
          />
        </div>
        <TextArea
          label="Short description"
          rows={3}
          value={draft.shortDescription}
          onChange={(event) =>
            setDraft({ ...draft, shortDescription: event.target.value })
          }
        />
      </Card>
      {!isDocument ? (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Procedure content</h2>
            <p className="text-sm text-gray-500">
              Explain the outcome, the steps, and safety information employees
              need.
            </p>
          </div>
          <TextArea
            label="Purpose"
            rows={5}
            value={draft.purpose}
            onChange={(event) =>
              setDraft({ ...draft, purpose: event.target.value })
            }
          />
          <TextArea
            label="Instructions"
            required
            rows={12}
            value={draft.instructions}
            onChange={(event) =>
              setDraft({ ...draft, instructions: event.target.value })
            }
          />
          <TextArea
            label="Safety information"
            rows={7}
            value={draft.safetyInformation}
            onChange={(event) =>
              setDraft({ ...draft, safetyInformation: event.target.value })
            }
          />
        </Card>
      ) : null}
      {isDocument ? (
        definition ? (
          <>
            <PdfDropzone
              entityType="sop"
              entityId={definition.id}
              document={draft.document}
              disabled={saving || publishing}
              onBusyChange={setUploadingDocument}
              onRemove={() => {
                const next = { ...draft, document: null };
                setDraft(next);
                void updateSopDraft(definition.id, next)
                  .then((payload) => setDefinition(payload.definition))
                  .catch((reason) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "PDF removal could not be saved.",
                    ),
                  );
              }}
              onUploaded={(document) => {
                const next = { ...draft, document };
                setDraft(next);
                void updateSopDraft(definition.id, next)
                  .then((payload) => setDefinition(payload.definition))
                  .catch((reason) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "PDF metadata could not be saved.",
                    ),
                  );
              }}
            />
            {draft.document ? (
              <AuthorizedPdfPreview
                document={draft.document}
                title={draft.title || "SOP"}
              />
            ) : null}
          </>
        ) : (
          <Card className="p-5">
            <p className="text-sm text-gray-600">
              Save the SOP details to enable the tenant-authorized PDF upload.
            </p>
            <Button
              className="mt-3"
              disabled={saving}
              onClick={() => void persist()}
            >
              {saving ? "Saving..." : "Save and add PDF"}
            </Button>
          </Card>
        )
      ) : (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Attachments</h2>
            <p className="text-sm text-gray-500">
              Add one or more PDF, DOC, or DOCX reference files.
            </p>
          </div>
          {draft.attachmentFileIds.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {draft.attachmentFileIds.map((fileId, index) => (
                <li
                  key={fileId}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText size={17} className="shrink-0" />
                    <span className="truncate">
                      {attachmentNames[fileId] ?? `Attachment ${index + 1}`}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    title="Remove attachment"
                    aria-label={`Remove attachment ${index + 1}`}
                    onClick={() => removeAttachment(fileId)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-brand-100 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-accent-50 focus-within:ring-2 focus-within:ring-brand-500/50">
            <Upload size={15} />{" "}
            {uploading ? "Uploading..." : "Add attachments"}
            <input
              className="sr-only"
              type="file"
              multiple
              disabled={uploading || saving}
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                void uploadAttachments(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </Card>
      )}
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={saving || uploading || uploadingDocument || publishing}
          onClick={() => void persist()}
        >
          {saving ? "Saving..." : "Save Draft"}
        </Button>
        <Button
          disabled={
            saving ||
            uploading ||
            uploadingDocument ||
            publishing ||
            (isDocument && draft.document?.status !== "ready")
          }
          onClick={() => void publish()}
        >
          {publishing ? "Publishing..." : "Publish"}
        </Button>
      </div>
    </div>
  );
}
