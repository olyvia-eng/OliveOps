import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Input, Select, TextArea } from '../../components/ui';
import type { TrainingAssignment, TrainingChecklistItem, TrainingDefinition, TrainingRecurrenceType } from '../../types/training';
import { uploadFileToStorage } from '../../utils/fileUpload';
import { trainingRequest, type TrainingDetailPayload } from './trainingApi';

const DEFAULT_ACKNOWLEDGEMENT = 'I confirm that I have read and understood this training and completed each required checklist item.';
type Draft = Pick<TrainingDefinition, 'title' | 'shortDescription' | 'instructions' | 'attachmentFileId' | 'checklist' | 'acknowledgementStatement' | 'recurrenceType' | 'recurrenceMonths' | 'dueSoonDays'>;
const emptyDraft = (): Draft => ({ title: '', shortDescription: '', instructions: '', attachmentFileId: null, checklist: [], acknowledgementStatement: DEFAULT_ACKNOWLEDGEMENT, recurrenceType: 'one_time', recurrenceMonths: null, dueSoonDays: 30 });

export default function TrainingBuilderPage() {
  const { trainingId } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [definition, setDefinition] = useState<TrainingDefinition | null>(null);
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [updateMode, setUpdateMode] = useState<'keep' | 'require'>('keep');
  const [requireEmployeeIds, setRequireEmployeeIds] = useState<string[]>([]);
  const [requiredDueDate, setRequiredDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [attachment, setAttachment] = useState<{ name: string; type: string; size: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const publishRequestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!trainingId) return;
    void trainingRequest<TrainingDetailPayload>('detail', { query: { trainingId } }).then(async (payload) => {
      const editable = payload.definition.status === 'published'
        ? (await trainingRequest<{ ok: true; definition: TrainingDefinition }>('start-draft', { method: 'POST', body: { trainingId } })).definition
        : payload.definition;
      setDefinition(editable);
      setAssignments(payload.assignments.filter((item) => !item.revokedAt));
      setDraft(editable);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Training could not be loaded.'));
  }, [trainingId]);

  const persist = async () => {
    setSaving(true); setError('');
    try {
      if (!definition) {
        const payload = await trainingRequest<{ ok: true; definition: TrainingDefinition }>('create', { method: 'POST', body: { requestId: crypto.randomUUID(), training: draft } });
        setDefinition(payload.definition);
        navigate(`/training/${payload.definition.id}/edit`, { replace: true });
        return payload.definition;
      }
      const payload = await trainingRequest<{ ok: true; definition: TrainingDefinition }>('update-draft', { method: 'PATCH', body: { trainingId: definition.id, training: draft } });
      setDefinition(payload.definition); return payload.definition;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Draft could not be saved.'); return null; }
    finally { setSaving(false); }
  };
  const selectAttachment = async (file?: File) => {
    if (!file) return;
    let saved = definition ?? await persist();
    if (!saved) return;
    if (saved.status !== 'draft') {
      saved = (await trainingRequest<{ ok: true; definition: TrainingDefinition }>('start-draft', { method: 'POST', body: { trainingId: saved.id } })).definition;
      setDefinition(saved);
    }
    setSaving(true); setError('');
    try {
      const uploaded = await uploadFileToStorage({ file, entityType: 'training', entityId: saved.id, category: 'attachment' });
      const next = { ...draft, attachmentFileId: uploaded.fileId };
      const payload = await trainingRequest<{ ok: true; definition: TrainingDefinition }>('update-draft', { method: 'PATCH', body: { trainingId: saved.id, training: next } });
      setDraft(next); setDefinition(payload.definition); setAttachment({ name: file.name, type: file.type, size: file.size });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Attachment could not be uploaded.'); }
    finally { setSaving(false); }
  };
  const addItem = () => setDraft((current) => ({ ...current, checklist: [...current.checklist, { itemId: crypto.randomUUID(), text: '', required: true, sortOrder: current.checklist.length }] }));
  const updateItem = (itemId: string, text: string) => setDraft((current) => ({ ...current, checklist: current.checklist.map((item) => item.itemId === itemId ? { ...item, text } : item) }));
  const removeItem = (itemId: string) => setDraft((current) => ({ ...current, checklist: current.checklist.filter((item) => item.itemId !== itemId).map((item, sortOrder) => ({ ...item, sortOrder })) }));
  const moveItem = (index: number, offset: number) => setDraft((current) => {
    const next = [...current.checklist]; const target = index + offset;
    if (target < 0 || target >= next.length) return current;
    const [moved] = next.splice(index, 1); next.splice(target, 0, moved);
    return { ...current, checklist: next.map((item, sortOrder) => ({ ...item, sortOrder })) };
  });
  const publish = async () => {
    setPublishing(true); setError('');
    try {
      const saved = await persist(); if (!saved) return;
      await trainingRequest('publish', { method: 'POST', body: { trainingId: saved.id, requestId: publishRequestId.current, requireEmployeeIds: updateMode === 'require' ? requireEmployeeIds : [], dueDate: requiredDueDate } });
      navigate(`/training/${saved.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Training could not be published.'); }
    finally { setPublishing(false); }
  };

  return <div className="mx-auto max-w-5xl space-y-5">
    <Link to={definition ? `/training/${definition.id}` : '/training'} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><ArrowLeft size={15} /> Training</Link>
    <header><h1 className="text-2xl font-semibold text-gray-900">{definition ? `Edit ${definition.title || 'Training'}` : 'New Training'}</h1><p className="mt-1 text-sm text-gray-500">Draft changes do not affect assigned or completed versions until you publish.</p></header>
    <Card className="space-y-4 p-5"><div><h2 className="font-semibold">Basic information</h2><p className="text-sm text-gray-500">Give employees enough context to understand why this matters.</p></div><Input label="Title" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><Input label="Short description" value={draft.shortDescription} onChange={(event) => setDraft({ ...draft, shortDescription: event.target.value })} /><TextArea label="Employee instructions" rows={8} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></Card>
    <Card className="space-y-4 p-5"><div><h2 className="font-semibold">Attachment</h2><p className="text-sm text-gray-500">Optional PDF, DOC, or DOCX. Files stay private and open through short-lived links.</p></div>{draft.attachmentFileId ? <div className="flex items-center justify-between rounded-md border p-3"><div className="flex items-center gap-3"><FileText size={18} /><div><p className="text-sm font-medium">{attachment?.name ?? 'Attached document'}</p><p className="text-xs text-gray-500">{attachment ? `${attachment.type} · ${(attachment.size / 1024).toFixed(1)} KB` : 'Saved attachment'}</p></div></div><Button variant="ghost" onClick={() => { setDraft({ ...draft, attachmentFileId: null }); setAttachment(null); }}>Remove</Button></div> : null}<label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold"><Upload size={15} /> {draft.attachmentFileId ? 'Replace attachment' : 'Choose attachment'}<input className="sr-only" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void selectAttachment(event.target.files?.[0])} /></label></Card>
    <Card className="space-y-4 p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Completion checklist</h2><p className="text-sm text-gray-500">Every item is required before acknowledgement.</p></div><Button variant="secondary" onClick={addItem}><Plus size={15} /> Add item</Button></div>{draft.checklist.map((item: TrainingChecklistItem, index) => <div key={item.itemId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2"><div className="flex"><Button title="Move up" variant="ghost" size="sm" disabled={index === 0} onClick={() => moveItem(index, -1)}><ArrowUp size={14} /></Button><Button title="Move down" variant="ghost" size="sm" disabled={index === draft.checklist.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown size={14} /></Button></div><Input label={`Required item ${index + 1}`} value={item.text} onChange={(event) => updateItem(item.itemId, event.target.value)} /><Button title="Delete item" variant="ghost" onClick={() => removeItem(item.itemId)}><Trash2 size={15} /></Button></div>)}</Card>
    <Card className="space-y-4 p-5"><h2 className="font-semibold">Acknowledgement</h2><TextArea label="Acknowledgement statement" rows={3} value={draft.acknowledgementStatement} onChange={(event) => setDraft({ ...draft, acknowledgementStatement: event.target.value })} /></Card>
    <Card className="space-y-4 p-5"><h2 className="font-semibold">Renewal</h2><div className="grid gap-4 sm:grid-cols-2"><Select label="Recurrence" value={draft.recurrenceType} onChange={(event) => setDraft({ ...draft, recurrenceType: event.target.value as TrainingRecurrenceType })}><option value="one_time">One time</option><option value="annual">Annually</option><option value="custom_months">Every X months</option></Select>{draft.recurrenceType === 'custom_months' ? <Input label="Months" type="number" min={1} max={120} value={draft.recurrenceMonths ?? ''} onChange={(event) => setDraft({ ...draft, recurrenceMonths: Number(event.target.value) })} /> : null}<Input label="Due-soon warning (days)" type="number" min={0} max={365} value={draft.dueSoonDays} onChange={(event) => setDraft({ ...draft, dueSoonDays: Number(event.target.value) })} /></div></Card>
    {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    <Card className="space-y-4 p-5"><div><h2 className="font-semibold">Publish this version</h2><p className="text-sm text-gray-500">Publishing creates an immutable employee-facing snapshot. Existing completions remain unchanged.</p></div>{definition && definition.currentVersion > 0 && assignments.length > 0 ? <fieldset className="space-y-3"><legend className="text-sm font-semibold">Existing assignments</legend><label className="flex items-start gap-2 text-sm"><input type="radio" name="update-mode" checked={updateMode === 'keep'} onChange={() => setUpdateMode('keep')} /><span><strong>Keep current assignments valid</strong><span className="block text-gray-500">Employees continue with their currently assigned version.</span></span></label><label className="flex items-start gap-2 text-sm"><input type="radio" name="update-mode" checked={updateMode === 'require'} onChange={() => setUpdateMode('require')} /><span><strong>Require selected employees to complete this version</strong><span className="block text-gray-500">Their current cycle restarts with the due date below.</span></span></label>{updateMode === 'require' ? <div className="ml-6 space-y-3"><div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">{assignments.map((assignment) => <label key={assignment.id} className="flex min-h-10 items-center gap-2 rounded px-2 hover:bg-gray-50"><input type="checkbox" checked={requireEmployeeIds.includes(assignment.employeeId)} onChange={(event) => setRequireEmployeeIds((current) => event.target.checked ? [...new Set([...current, assignment.employeeId])] : current.filter((id) => id !== assignment.employeeId))} /> {assignment.employeeName}</label>)}</div><Input label="New version due date" type="date" value={requiredDueDate} onChange={(event) => setRequiredDueDate(event.target.value)} /></div> : null}</fieldset> : null}<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={saving || publishing} onClick={() => void persist()}>{saving ? 'Saving...' : 'Save Draft'}</Button><Button disabled={saving || publishing || (updateMode === 'require' && requireEmployeeIds.length === 0)} onClick={() => void publish()}>{publishing ? 'Publishing...' : 'Publish Version'}</Button></div></Card>
  </div>;
}