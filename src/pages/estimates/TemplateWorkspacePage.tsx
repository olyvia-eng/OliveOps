import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { generateId } from '../../utils';
import { normalizeEstimateTemplate } from '../../utils/estimateTemplateModel.js';
import type { EstimateTemplateWorkArea } from '../../types';

interface Props {
  currentUserRole: string;
}

type TemplateTab = 'info' | 'work-areas';

export default function TemplateWorkspacePage({ currentUserRole }: Props) {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { templates, updateTemplate, deleteTemplate } = useStore();
  const template = templates.find((item) => item.id === templateId);
  const normalized = useMemo(() => template ? normalizeEstimateTemplate(template) : null, [template]);
  const [info, setInfo] = useState(() => normalized ? { name: normalized.name, description: normalized.description, proposalNotes: normalized.proposalNotes } : null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';
  const activeTab: TemplateTab = searchParams.get('tab') === 'work-areas' ? 'work-areas' : 'info';

  useEffect(() => {
    if (normalized) setInfo({ name: normalized.name, description: normalized.description, proposalNotes: normalized.proposalNotes });
  }, [normalized]);

  if (!normalized || !info) {
    return <div className="space-y-4"><Button variant="secondary" onClick={() => navigate('/estimates/templates')}><ArrowLeft size={15} /> Back to Templates</Button><EmptyState title="Template not found" /></div>;
  }

  const saveInfo = async () => {
    if (!info.name.trim() || saving || !canManage) return;
    setSaving(true);
    await updateTemplate(normalized.id, { name: info.name.trim(), description: info.description, proposalNotes: info.proposalNotes });
    setSaving(false);
  };

  const saveWorkAreas = async (workAreas: EstimateTemplateWorkArea[]) => {
    if (!canManage || saving) return false;
    setSaving(true);
    const saved = await updateTemplate(normalized.id, { workAreas: workAreas.map((area, index) => ({ ...area, sortOrder: index })) });
    setSaving(false);
    return Boolean(saved);
  };

  const addWorkArea = async () => {
    const nextArea: EstimateTemplateWorkArea = { id: generateId(), name: `Work Area ${normalized.workAreas.length + 1}`, description: '', sortOrder: normalized.workAreas.length, lineItems: [] };
    const saved = await saveWorkAreas([...normalized.workAreas, nextArea]);
    if (saved) navigate(`/estimates/templates/${normalized.id}/work-areas/${nextArea.id}`);
  };

  const moveWorkArea = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= normalized.workAreas.length) return;
    const next = [...normalized.workAreas];
    [next[index], next[target]] = [next[target], next[index]];
    await saveWorkAreas(next);
  };

  const removeWorkArea = async (workAreaId: string) => {
    await saveWorkAreas(normalized.workAreas.filter((area) => area.id !== workAreaId));
  };

  return (
    <div>
      <PageHeader title={normalized.name} subtitle="Estimate Template workspace" action={<div className="flex gap-2"><Button variant="secondary" onClick={() => navigate('/estimates/templates')}><ArrowLeft size={15} /> Back</Button>{canManage ? <Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</Button> : null}</div>} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><Badge label="Scope Template" className="bg-brand-100 text-brand-700 dark:bg-brand-600 dark:text-brand-100" />{normalized.legacyTaxRate !== undefined ? <Badge label={`Legacy tax ${normalized.legacyTaxRate}%`} className="bg-gray-100 text-gray-600" /> : null}</div>
      <div className="mb-6 inline-flex min-w-max rounded-xl border border-gray-200 bg-white p-1 dark:border-brand-600 dark:bg-brand-800" role="tablist" aria-label="Template workspace sections">
        {(['info', 'work-areas'] as TemplateTab[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setSearchParams(tab === 'info' ? {} : { tab })} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${activeTab === tab ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-brand-200 dark:hover:bg-brand-700'}`}>{tab === 'info' ? 'Info' : 'Work Areas'}</button>)}
      </div>

      {activeTab === 'info' ? <fieldset disabled={!canManage} className="space-y-4"><Card className="space-y-4 p-4"><Input label="Template Name" required value={info.name} onChange={(event) => setInfo({ ...info, name: event.target.value })} /><TextArea label="Description" value={info.description} onChange={(event) => setInfo({ ...info, description: event.target.value })} /><TextArea label="Default Proposal / Scope Notes" value={info.proposalNotes} onChange={(event) => setInfo({ ...info, proposalNotes: event.target.value })} />{canManage ? <div className="flex justify-end"><Button onClick={() => void saveInfo()} disabled={!info.name.trim() || saving}>{saving ? 'Saving...' : 'Save Changes'}</Button></div> : null}</Card></fieldset> : null}

      {activeTab === 'work-areas' ? <div className="space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Work Areas</h2><p className="text-sm text-gray-500 dark:text-brand-200">Reusable scope, resources, and default quantities.</p></div>{canManage ? <Button onClick={() => void addWorkArea()} disabled={saving}><Plus size={14} /> Add Work Area</Button> : null}</div>{normalized.workAreas.length === 0 ? <EmptyState title="No Work Areas yet" action={canManage ? <Button variant="secondary" onClick={() => void addWorkArea()}><Plus size={14} /> Add Work Area</Button> : undefined} /> : <div className="space-y-3">{normalized.workAreas.map((area, index) => <Card key={area.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => navigate(`/estimates/templates/${normalized.id}/work-areas/${area.id}`)} className="min-w-0 flex-1 text-left"><p className="font-semibold text-gray-900 dark:text-brand-50">{area.name}</p><p className="mt-1 text-sm text-gray-500 dark:text-brand-200">{area.description || 'No description'}</p><p className="mt-2 text-xs text-gray-400 dark:text-brand-300">{area.lineItems.length} resource{area.lineItems.length === 1 ? '' : 's'}</p><span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-200">Open Work Area <ArrowRight size={14} /></span></button>{canManage ? <div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" title="Move up" disabled={index === 0 || saving} onClick={() => void moveWorkArea(index, -1)}><ArrowUp size={14} /></Button><Button variant="ghost" size="sm" title="Move down" disabled={index === normalized.workAreas.length - 1 || saving} onClick={() => void moveWorkArea(index, 1)}><ArrowDown size={14} /></Button><Button variant="danger" size="sm" title="Delete Work Area" disabled={saving} onClick={() => void removeWorkArea(area.id)}><Trash2 size={14} /></Button></div> : null}</Card>)}</div>}</div> : null}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Template" footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={() => { deleteTemplate(normalized.id); navigate('/estimates/templates'); }}>Delete</Button></>}><p className="text-gray-600 dark:text-brand-200">Delete this Template? Existing Estimates will not be changed.</p></Modal>
    </div>
  );
}
