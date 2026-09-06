import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileText,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button, Card, Input, Select, TextArea } from "../../components/ui";
import {
  AuthorizedPdfPreview,
  CreationMethodChoice,
  PdfDropzone,
} from "../../components/documents/PdfDocumentControls";
import type {
  TrainingAssignment,
  TrainingDefinition,
  TrainingRecurrenceType,
  TrainingSection,
} from "../../types/training";
import { uploadFileToStorage } from "../../utils/fileUpload";
import { trainingSectionsFor } from "../../utils/trainingSections";
import { trainingRequest, type TrainingDetailPayload } from "./trainingApi";

const DEFAULT_ACKNOWLEDGEMENT =
  "I confirm that I have read and understood this training and completed each required checklist item.";
type Draft = Pick<
  TrainingDefinition,
  | "contentMode"
  | "title"
  | "category"
  | "shortDescription"
  | "instructions"
  | "attachmentFileId"
  | "document"
  | "trainingSections"
  | "acknowledgementStatement"
  | "recurrenceType"
  | "recurrenceMonths"
  | "dueSoonDays"
>;
const emptyDraft = (
  contentMode: "structured" | "document" = "structured",
): Draft => ({
  contentMode,
  title: "",
  category: "",
  shortDescription: "",
  instructions: "",
  attachmentFileId: null,
  document: null,
  trainingSections:
    contentMode === "structured"
      ? [{ sectionId: crypto.randomUUID(), title: "", description: "", sortOrder: 0, checklistItems: [] }]
      : [],
  acknowledgementStatement:
    contentMode === "document"
      ? "I confirm that I have reviewed and understood this Training document."
      : DEFAULT_ACKNOWLEDGEMENT,
  recurrenceType: "one_time",
  recurrenceMonths: null,
  dueSoonDays: 30,
});

export default function TrainingBuilderPage() {
  const { trainingId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  if (
    !trainingId &&
    requestedMode !== "structured" &&
    requestedMode !== "document"
  )
    return <CreationMethodChoice resource="Training" />;
  const initialMode = requestedMode === "document" ? "document" : "structured";
  return (
    <TrainingBuilder
      key={trainingId ?? initialMode}
      initialMode={initialMode}
    />
  );
}

function TrainingBuilder({
  initialMode,
}: {
  initialMode: "structured" | "document";
}) {
  const { trainingId } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(initialMode));
  const [definition, setDefinition] = useState<TrainingDefinition | null>(null);
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [updateMode, setUpdateMode] = useState<"keep" | "require">("keep");
  const [requireEmployeeIds, setRequireEmployeeIds] = useState<string[]>([]);
  const [requiredDueDate, setRequiredDueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [attachment, setAttachment] = useState<{
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [error, setError] = useState("");
  const publishRequestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!trainingId) return;
    void trainingRequest<TrainingDetailPayload>("detail", {
      query: { trainingId },
    })
      .then(async (payload) => {
        const editable =
          payload.definition.status === "published"
            ? (
                await trainingRequest<{
                  ok: true;
                  definition: TrainingDefinition;
                }>("start-draft", { method: "POST", body: { trainingId } })
              ).definition
            : payload.definition;
        setDefinition(editable);
        setAssignments(payload.assignments.filter((item) => !item.revokedAt));
        setDraft({
          ...editable,
          contentMode: editable.contentMode ?? "structured",
          category: editable.category ?? "",
          trainingSections: trainingSectionsFor(editable),
          document: editable.document ?? null,
        });
      })
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Training could not be loaded.",
        ),
      );
  }, [trainingId]);

  const persist = async () => {
    setSaving(true);
    setError("");
    try {
      if (!definition) {
        const payload = await trainingRequest<{
          ok: true;
          definition: TrainingDefinition;
        }>("create", {
          method: "POST",
          body: { requestId: crypto.randomUUID(), training: draft },
        });
        setDefinition(payload.definition);
        navigate(`/training/${payload.definition.id}/edit`, { replace: true });
        return payload.definition;
      }
      const payload = await trainingRequest<{
        ok: true;
        definition: TrainingDefinition;
      }>("update-draft", {
        method: "PATCH",
        body: { trainingId: definition.id, training: draft },
      });
      setDefinition(payload.definition);
      return payload.definition;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Draft could not be saved.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  };
  const selectAttachment = async (file?: File) => {
    if (!file) return;
    let saved = definition ?? (await persist());
    if (!saved) return;
    if (saved.status !== "draft") {
      saved = (
        await trainingRequest<{ ok: true; definition: TrainingDefinition }>(
          "start-draft",
          { method: "POST", body: { trainingId: saved.id } },
        )
      ).definition;
      setDefinition(saved);
    }
    setSaving(true);
    setError("");
    try {
      const uploaded = await uploadFileToStorage({
        file,
        entityType: "training",
        entityId: saved.id,
        category: "attachment",
      });
      const next = { ...draft, attachmentFileId: uploaded.fileId };
      const payload = await trainingRequest<{
        ok: true;
        definition: TrainingDefinition;
      }>("update-draft", {
        method: "PATCH",
        body: { trainingId: saved.id, training: next },
      });
      setDraft(next);
      setDefinition(payload.definition);
      setAttachment({ name: file.name, type: file.type, size: file.size });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Attachment could not be uploaded.",
      );
    } finally {
      setSaving(false);
    }
  };
  const addSection = () =>
    setDraft((current) => ({
      ...current,
      trainingSections: [
        ...current.trainingSections,
        { sectionId: crypto.randomUUID(), title: "", description: "", sortOrder: current.trainingSections.length, checklistItems: [] },
      ],
    }));
  const updateSection = (sectionId: string, changes: Partial<TrainingSection>) =>
    setDraft((current) => ({
      ...current,
      trainingSections: current.trainingSections.map((section) =>
        section.sectionId === sectionId ? { ...section, ...changes } : section,
      ),
    }));
  const removeSection = (sectionId: string) =>
    setDraft((current) => ({
      ...current,
      trainingSections: current.trainingSections
        .filter((section) => section.sectionId !== sectionId)
        .map((section, sortOrder) => ({ ...section, sortOrder })),
    }));
  const moveSection = (index: number, offset: number) =>
    setDraft((current) => {
      const next = [...current.trainingSections];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return {
        ...current,
        trainingSections: next.map((section, sortOrder) => ({ ...section, sortOrder })),
      };
    });
  const addItem = (sectionId: string) =>
    setDraft((current) => ({
      ...current,
      trainingSections: current.trainingSections.map((section) => section.sectionId === sectionId ? {
        ...section,
        checklistItems: [...section.checklistItems, { itemId: crypto.randomUUID(), text: "", required: true, sortOrder: section.checklistItems.length }],
      } : section),
    }));
  const updateItem = (sectionId: string, itemId: string, text: string) =>
    setDraft((current) => ({
      ...current,
      trainingSections: current.trainingSections.map((section) => section.sectionId === sectionId ? {
        ...section,
        checklistItems: section.checklistItems.map((item) => item.itemId === itemId ? { ...item, text } : item),
      } : section),
    }));
  const removeItem = (sectionId: string, itemId: string) =>
    setDraft((current) => ({
      ...current,
      trainingSections: current.trainingSections.map((section) => section.sectionId === sectionId ? {
        ...section,
        checklistItems: section.checklistItems.filter((item) => item.itemId !== itemId).map((item, sortOrder) => ({ ...item, sortOrder })),
      } : section),
    }));
  const moveItem = (sectionId: string, index: number, offset: number) =>
    setDraft((current) => ({
      ...current,
      trainingSections: current.trainingSections.map((section) => {
        if (section.sectionId !== sectionId) return section;
        const next = [...section.checklistItems];
        const target = index + offset;
        if (target < 0 || target >= next.length) return section;
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        return { ...section, checklistItems: next.map((item, sortOrder) => ({ ...item, sortOrder })) };
      }),
    }));
  const publish = async () => {
    setPublishing(true);
    setError("");
    try {
      const saved = await persist();
      if (!saved) return;
      await trainingRequest("publish", {
        method: "POST",
        body: {
          trainingId: saved.id,
          requestId: publishRequestId.current,
          requireEmployeeIds:
            updateMode === "require" ? requireEmployeeIds : [],
          dueDate: requiredDueDate,
        },
      });
      navigate(`/training/${saved.id}`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Training could not be published.",
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
        uploadingDocument ||
        (definition &&
          JSON.stringify(draft) !==
            JSON.stringify({
              ...definition,
              contentMode: definition.contentMode ?? "structured",
              category: definition.category ?? "",
              trainingSections: trainingSectionsFor(definition),
              document: definition.document ?? null,
            }))
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [definition, draft, publishing, saving, uploadingDocument]);

  const isDocument =
    (definition?.contentMode ?? draft.contentMode) === "document";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        to={definition ? `/training/${definition.id}` : "/training/new"}
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"
      >
        <ArrowLeft size={15} /> {definition ? "Training" : "Creation method"}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">
          {definition
            ? `Edit ${definition.title || "Training"}`
            : "New Training"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Draft changes do not affect assigned or completed versions until you
          publish.
        </p>
      </header>
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Basic information</h2>
          <p className="text-sm text-gray-500">
            Give employees enough context to understand why this matters.
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
            value={draft.category}
            onChange={(event) =>
              setDraft({ ...draft, category: event.target.value })
            }
          />
        </div>
        <Input
          label="Short description"
          value={draft.shortDescription}
          onChange={(event) =>
            setDraft({ ...draft, shortDescription: event.target.value })
          }
        />
      </Card>
      {!isDocument ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Training Sections</h2>
              <p className="text-sm text-gray-500">
                Build the training using sections. Each section can include instructions and required checklist items.
              </p>
            </div>
            <Button variant="secondary" onClick={addSection}>
              <Plus size={15} /> Add Section
            </Button>
          </div>
          {draft.trainingSections.map((section, sectionIndex) => (
            <Card key={section.sectionId} className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Section {sectionIndex + 1}</h3>
                <div className="flex gap-1">
                  <Button type="button" title="Move section up" aria-label={`Move section ${sectionIndex + 1} up`} variant="ghost" size="sm" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)}><ArrowUp size={15} /></Button>
                  <Button type="button" title="Move section down" aria-label={`Move section ${sectionIndex + 1} down`} variant="ghost" size="sm" disabled={sectionIndex === draft.trainingSections.length - 1} onClick={() => moveSection(sectionIndex, 1)}><ArrowDown size={15} /></Button>
                  <Button type="button" title="Delete section" aria-label={`Delete section ${sectionIndex + 1}`} variant="ghost" size="sm" onClick={() => removeSection(section.sectionId)}><Trash2 size={15} /></Button>
                </div>
              </div>
              <Input label="Heading" required value={section.title} onChange={(event) => updateSection(section.sectionId, { title: event.target.value })} />
              <TextArea label="Description" rows={3} value={section.description} onChange={(event) => updateSection(section.sectionId, { description: event.target.value })} />
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold">Checklist</h4>
                  <Button type="button" variant="secondary" size="sm" onClick={() => addItem(section.sectionId)}><Plus size={14} /> Add checklist item</Button>
                </div>
                {section.checklistItems.map((item, itemIndex) => (
                  <div key={item.itemId} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <Input label={`Item ${itemIndex + 1}`} value={item.text} onChange={(event) => updateItem(section.sectionId, item.itemId, event.target.value)} />
                    <div className="flex pb-0.5">
                      <Button type="button" title="Move item up" aria-label={`Move item ${itemIndex + 1} up in section ${sectionIndex + 1}`} variant="ghost" size="sm" disabled={itemIndex === 0} onClick={() => moveItem(section.sectionId, itemIndex, -1)}><ArrowUp size={14} /></Button>
                      <Button type="button" title="Move item down" aria-label={`Move item ${itemIndex + 1} down in section ${sectionIndex + 1}`} variant="ghost" size="sm" disabled={itemIndex === section.checklistItems.length - 1} onClick={() => moveItem(section.sectionId, itemIndex, 1)}><ArrowDown size={14} /></Button>
                      <Button type="button" title="Delete item" aria-label={`Delete item ${itemIndex + 1} from section ${sectionIndex + 1}`} variant="ghost" size="sm" onClick={() => removeItem(section.sectionId, item.itemId)}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {draft.trainingSections.length === 0 ? (
            <Card className="p-5 text-sm text-gray-500">Add a section to begin building this Training.</Card>
          ) : null}
          <Button variant="secondary" onClick={addSection}>
            <Plus size={15} /> Add Section
          </Button>
        </section>
      ) : null}
      {isDocument ? (
        definition ? (
          <>
            <PdfDropzone
              entityType="training"
              entityId={definition.id}
              document={draft.document}
              disabled={saving || publishing}
              onBusyChange={setUploadingDocument}
              onRemove={() => {
                const next = { ...draft, document: null };
                setDraft(next);
                void trainingRequest<{
                  ok: true;
                  definition: TrainingDefinition;
                }>("update-draft", {
                  method: "PATCH",
                  body: { trainingId: definition.id, training: next },
                })
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
                void trainingRequest<{
                  ok: true;
                  definition: TrainingDefinition;
                }>("update-draft", {
                  method: "PATCH",
                  body: { trainingId: definition.id, training: next },
                })
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
                title={draft.title || "Training"}
              />
            ) : null}
          </>
        ) : (
          <Card className="p-5">
            <p className="text-sm text-gray-600">
              Save the Training details to enable the tenant-authorized PDF
              upload.
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
      ) : null}
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Acknowledgement</h2>
        <TextArea
          label="Acknowledgement statement"
          rows={3}
          value={draft.acknowledgementStatement}
          onChange={(event) =>
            setDraft({ ...draft, acknowledgementStatement: event.target.value })
          }
        />
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Renewal</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Recurrence"
            value={draft.recurrenceType}
            onChange={(event) =>
              setDraft({
                ...draft,
                recurrenceType: event.target.value as TrainingRecurrenceType,
              })
            }
          >
            <option value="one_time">One time</option>
            <option value="annual">Annually</option>
            <option value="custom_months">Every X months</option>
          </Select>
          {draft.recurrenceType === "custom_months" ? (
            <Input
              label="Months"
              type="number"
              min={1}
              max={120}
              value={draft.recurrenceMonths ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  recurrenceMonths: Number(event.target.value),
                })
              }
            />
          ) : null}
          <Input
            label="Due-soon warning (days)"
            type="number"
            min={0}
            max={365}
            value={draft.dueSoonDays}
            onChange={(event) =>
              setDraft({ ...draft, dueSoonDays: Number(event.target.value) })
            }
          />
        </div>
      </Card>
      {!isDocument ? (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Attachment</h2>
            <p className="text-sm text-gray-500">
              Optional PDF, DOC, or DOCX. Files stay private and open through
              short-lived links.
            </p>
          </div>
          {draft.attachmentFileId ? (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <FileText size={18} />
                <div>
                  <p className="text-sm font-medium">
                    {attachment?.name ?? "Attached document"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {attachment
                      ? `${attachment.type} · ${(attachment.size / 1024).toFixed(1)} KB`
                      : "Saved attachment"}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft({ ...draft, attachmentFileId: null });
                  setAttachment(null);
                }}
              >
                Remove
              </Button>
            </div>
          ) : null}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold">
            <Upload size={15} />{" "}
            {draft.attachmentFileId
              ? "Replace attachment"
              : "Choose attachment"}
            <input
              className="sr-only"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) =>
                void selectAttachment(event.target.files?.[0])
              }
            />
          </label>
        </Card>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Publish this version</h2>
          <p className="text-sm text-gray-500">
            Publishing creates an immutable employee-facing snapshot. Existing
            completions remain unchanged.
          </p>
        </div>
        {definition &&
        definition.currentVersion > 0 &&
        assignments.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">
              Existing assignments
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="update-mode"
                checked={updateMode === "keep"}
                onChange={() => setUpdateMode("keep")}
              />
              <span>
                <strong>Keep current assignments valid</strong>
                <span className="block text-gray-500">
                  Employees continue with their currently assigned version.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="update-mode"
                checked={updateMode === "require"}
                onChange={() => setUpdateMode("require")}
              />
              <span>
                <strong>
                  Require selected employees to complete this version
                </strong>
                <span className="block text-gray-500">
                  Their current cycle restarts with the due date below.
                </span>
              </span>
            </label>
            {updateMode === "require" ? (
              <div className="ml-6 space-y-3">
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
                  {assignments.map((assignment) => (
                    <label
                      key={assignment.id}
                      className="flex min-h-10 items-center gap-2 rounded px-2 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={requireEmployeeIds.includes(
                          assignment.employeeId,
                        )}
                        onChange={(event) =>
                          setRequireEmployeeIds((current) =>
                            event.target.checked
                              ? [
                                  ...new Set([
                                    ...current,
                                    assignment.employeeId,
                                  ]),
                                ]
                              : current.filter(
                                  (id) => id !== assignment.employeeId,
                                ),
                          )
                        }
                      />{" "}
                      {assignment.employeeName}
                    </label>
                  ))}
                </div>
                <Input
                  label="New version due date"
                  type="date"
                  value={requiredDueDate}
                  onChange={(event) => setRequiredDueDate(event.target.value)}
                />
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={saving || uploadingDocument || publishing}
            onClick={() => void persist()}
          >
            {saving ? "Saving..." : "Save Draft"}
          </Button>
          <Button
            disabled={
              saving ||
              uploadingDocument ||
              publishing ||
              (isDocument && draft.document?.status !== "ready") ||
              (updateMode === "require" && requireEmployeeIds.length === 0)
            }
            onClick={() => void publish()}
          >
            {publishing ? "Publishing..." : "Publish Version"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
