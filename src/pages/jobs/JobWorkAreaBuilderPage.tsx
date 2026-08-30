import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Search, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, TextArea } from '../../components/ui';
import {
  WORK_AREA_CATEGORY_ADD_LABEL,
  WORK_AREA_CATEGORY_LABEL,
  WORK_AREA_CATEGORY_ORDER,
} from '../../components/work-areas/workAreaCategories';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { EstimatePricingCatalog, EstimatePricingCatalogItem, JobWorkAreaLineItem, LineItemCategory } from '../../types';
import { formatCurrency } from '../../utils';

interface Props {
  currentUserRole: string;
}

type LineDraft = { quantity: string; unitCost: string; description: string };

export default function JobWorkAreaBuilderPage({ currentUserRole }: Props) {
  const { id, workAreaId } = useParams<{ id: string; workAreaId: string }>();
  const navigate = useNavigate();
  const { jobs, customers, initializeJobPlan, mutateJobPlan } = useStore();
  const job = jobs.find((item) => item.id === id);
  const customer = customers.find((item) => item.id === job?.customerId);
  const workArea = job?.operationalWorkAreas?.find((item) => item.id === workAreaId);
  const canEditFinancials = currentUserRole === 'owner' || currentUserRole === 'admin';
  const [initializing, setInitializing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(workArea?.name ?? '');
  const [description, setDescription] = useState(workArea?.description ?? '');
  const [status, setStatus] = useState(workArea?.status ?? 'not_started');
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [catalog, setCatalog] = useState<EstimatePricingCatalog | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState<LineItemCategory>('labour');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  useEffect(() => {
    if (!job || job.planningSnapshotVersion) return;
    setInitializing(true);
    void initializeJobPlan(job.id).finally(() => setInitializing(false));
  }, [initializeJobPlan, job]);

  useEffect(() => {
    if (!workArea) return;
    setName(workArea.name);
    setDescription(workArea.description);
    setStatus(workArea.status);
    setLineDrafts(Object.fromEntries(workArea.lineItems.map((line) => [line.id, {
      quantity: String(line.quantity),
      unitCost: String(line.unitCost),
      description: line.description,
    }])));
  }, [workArea]);

  const groupedLines = useMemo(() => WORK_AREA_CATEGORY_ORDER.reduce<Record<LineItemCategory, JobWorkAreaLineItem[]>>((groups, category) => {
    groups[category] = workArea?.lineItems.filter((line) => line.category === category) ?? [];
    return groups;
  }, { labour: [], equipment: [], material: [], subcontractor: [] }), [workArea]);

  const visibleCandidates = useMemo(() => {
    if (!catalog) return [];
    const groups: Record<LineItemCategory, EstimatePricingCatalogItem[]> = {
      labour: catalog.labour,
      equipment: catalog.equipment,
      material: catalog.materials,
      subcontractor: catalog.subcontractors,
    };
    const query = catalogSearch.trim().toLowerCase();
    return groups[catalogCategory].filter((item) => !query || `${item.name} ${item.description} ${item.costCode ?? ''}`.toLowerCase().includes(query));
  }, [catalog, catalogCategory, catalogSearch]);

  const mutate = async (mutation: Parameters<typeof mutateJobPlan>[1]) => {
    if (!job || saving) return false;
    setSaving(true);
    const result = await mutateJobPlan(job.id, mutation);
    setSaving(false);
    return result.ok;
  };

  const openCatalog = async (category: LineItemCategory) => {
    if (!job || !canEditFinancials) return;
    setCatalogCategory(category);
    setCatalogSearch('');
    setCatalogOpen(true);
    if (catalog) return;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const response = await fetch(`/api/job-plans?jobId=${encodeURIComponent(job.id)}&action=catalog`, { credentials: 'include' });
      const payload = await response.json() as { ok?: boolean; catalog?: EstimatePricingCatalog; error?: string };
      if (!response.ok || !payload.ok || !payload.catalog) throw new Error(payload.error || 'Could not load Job resources.');
      setCatalog(payload.catalog);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Could not load Job resources.');
    } finally {
      setCatalogLoading(false);
    }
  };

  if (!job || initializing) {
    return <Card className="p-6"><p className="text-sm text-gray-500">{initializing ? 'Preparing the current Job plan...' : 'Job not found.'}</p></Card>;
  }

  if (!workArea) {
    return <div className="space-y-4"><Button variant="secondary" onClick={() => navigate(`/jobs/${job.id}?tab=work-areas`)}><ArrowLeft size={15} /> Back to Job</Button><Card className="p-6"><h2 className="font-semibold">Work Area not found</h2><p className="mt-2 text-sm text-gray-500">This Work Area was removed or is not available.</p></Card></div>;
  }

  const saveWorkArea = async () => {
    const ok = await mutate({ action: 'update-work-area', workAreaId: workArea.id, name, description, status });
    if (ok) emitAppToast({ tone: 'success', message: 'Job Work Area saved.' });
  };

  const saveLine = async (line: JobWorkAreaLineItem) => {
    const draft = lineDrafts[line.id];
    if (!draft) return;
    await mutate({
      action: 'update-line',
      workAreaId: workArea.id,
      lineItemId: line.id,
      quantity: Math.max(0, Number(draft.quantity) || 0),
      ...(canEditFinancials ? { unitCost: Math.max(0, Number(draft.unitCost) || 0) } : {}),
      description: draft.description,
    });
  };

  const plannedCost = workArea.plannedCost ?? workArea.estimatedCost;
  const contractRevenue = workArea.contractRevenue ?? workArea.estimatedRevenue;
  const expectedMargin = contractRevenue - plannedCost;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
      <Link to="/jobs" className="hover:text-brand-700">Jobs</Link><span>/</span>
      <Link to={`/jobs/${job.id}?tab=work-areas`} className="hover:text-brand-700">{job.title}</Link><span>/</span>
      <span className="text-gray-700">{workArea.name}</span>
    </div>
    <PageHeader title={workArea.name} subtitle={`${customer?.name ?? 'Unknown Customer'} · Current Job Plan`} action={<Button variant="secondary" onClick={() => navigate(`/jobs/${job.id}?tab=work-areas`)}><ArrowLeft size={15} /> Back to Job</Button>} />
    <div className="flex flex-wrap gap-2"><Badge label="Current Job Plan" className="bg-brand-100 text-brand-700" /><Badge label={`Revision ${job.planningRevision ?? 1}`} className="bg-gray-100 text-gray-700" /></div>

    <Card className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Input label="Work Area Name" required value={name} onChange={(event) => setName(event.target.value)} />
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="not_started">Not Started</option><option value="in_progress">In Progress</option><option value="on_hold">On Hold</option><option value="complete">Complete</option></Select>
      </div>
      <TextArea label="Description / Scope" value={description} onChange={(event) => setDescription(event.target.value)} />
      <div className="flex justify-end"><Button onClick={() => void saveWorkArea()} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save Work Area'}</Button></div>
    </Card>

    {canEditFinancials ? <div className="grid gap-3 sm:grid-cols-3">
      <Card className="p-3"><p className="text-xs text-gray-500">Current Planned Cost</p><p className="mt-1 text-lg font-semibold">{formatCurrency(plannedCost)}</p></Card>
      <Card className="p-3"><p className="text-xs text-gray-500">Sold Revenue Allocation</p><p className="mt-1 text-lg font-semibold">{formatCurrency(contractRevenue)}</p></Card>
      <Card className="p-3"><p className="text-xs text-gray-500">Expected Margin</p><p className={`mt-1 text-lg font-semibold ${expectedMargin >= 0 ? 'text-brand-700' : 'text-accent-700'}`}>{formatCurrency(expectedMargin)}</p></Card>
    </div> : null}

    {WORK_AREA_CATEGORY_ORDER.map((category) => <Card key={category} className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-brand-100 p-4">
        <div><h2 className="font-semibold">{WORK_AREA_CATEGORY_LABEL[category]}</h2><p className="text-xs text-gray-500">{groupedLines[category].length} item{groupedLines[category].length === 1 ? '' : 's'}</p></div>
        {canEditFinancials ? <Button size="sm" variant="secondary" onClick={() => void openCatalog(category)}><Plus size={14} /> Add {WORK_AREA_CATEGORY_ADD_LABEL[category]}</Button> : null}
      </div>
      {groupedLines[category].length === 0 ? <p className="p-4 text-sm text-gray-500">No {WORK_AREA_CATEGORY_LABEL[category].toLowerCase()} planned.</p> : <div className="divide-y divide-brand-100">{groupedLines[category].map((line) => {
        const draft = lineDrafts[line.id] ?? { quantity: String(line.quantity), unitCost: String(line.unitCost), description: line.description };
        return <div key={line.id} className="space-y-3 p-4">
          <div className={`grid items-end gap-3 ${canEditFinancials ? 'sm:grid-cols-[minmax(0,1fr)_9rem_10rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_9rem_auto]'}`}>
            <div className="min-w-0"><p className="truncate font-semibold">{line.itemName || line.description || 'Untitled Item'}</p><p className="text-xs text-gray-500">{line.unit}{line.sourceEstimateLineItemId ? ' · Sold Estimate line' : ' · Job-only resource'}</p></div>
            <Input label={category === 'labour' || line.unit === 'hr' ? 'Hours' : 'Quantity'} type="number" min={0} value={draft.quantity} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...draft, quantity: event.target.value } }))} />
            {canEditFinancials ? <Input label={`Planned Cost / ${line.unit}`} type="number" min={0} value={draft.unitCost} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...draft, unitCost: event.target.value } }))} /> : null}
            <div className="flex items-center justify-end gap-1"><Button size="sm" variant="secondary" onClick={() => void saveLine(line)} disabled={saving}>Save</Button>{canEditFinancials ? <Button size="sm" variant="ghost" title="Remove resource" onClick={() => void mutate({ action: 'remove-line', workAreaId: workArea.id, lineItemId: line.id })}><Trash2 size={14} className="text-accent-700" /></Button> : null}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextArea label="Description / Notes" rows={2} value={draft.description} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...draft, description: event.target.value } }))} />
            {canEditFinancials ? <div className="pb-2 text-right text-xs text-gray-500"><p>Planned total <span className="font-semibold text-gray-900">{formatCurrency((Number(draft.quantity) || 0) * (Number(draft.unitCost) || 0))}</span></p><p>Contract revenue <span className="font-semibold text-gray-900">{formatCurrency(line.contractRevenue ?? line.total)}</span></p></div> : null}
          </div>
        </div>;
      })}</div>}
    </Card>)}

    {canEditFinancials ? <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-semibold">Remove Work Area</h2><p className="text-sm text-gray-500">The original Estimate remains unchanged.</p></div><Button variant="danger" onClick={async () => { if (window.confirm('Delete this Job Work Area from the current plan?') && await mutate({ action: 'delete-work-area', workAreaId: workArea.id })) navigate(`/jobs/${job.id}?tab=work-areas`); }}><Trash2 size={14} /> Delete Work Area</Button></Card> : null}

    {catalogOpen ? <div className="fixed inset-0 z-50"><div className="absolute inset-0 bg-black/50" onClick={() => setCatalogOpen(false)} /><aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl" aria-label={`Add ${WORK_AREA_CATEGORY_ADD_LABEL[catalogCategory]}`}>
      <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3"><div><h2 className="font-semibold">Add {WORK_AREA_CATEGORY_ADD_LABEL[catalogCategory]}</h2><p className="text-xs text-gray-500">New resources affect planned cost, not contract revenue.</p></div><button type="button" title="Close" onClick={() => setCatalogOpen(false)} className="rounded-md p-2 text-gray-500"><X size={18} /></button></div>
      <div className="flex-1 overflow-y-auto p-4"><div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder={`Search ${WORK_AREA_CATEGORY_LABEL[catalogCategory].toLowerCase()}...`} className="h-10 w-full rounded-lg border border-brand-100 pl-9 pr-3 text-sm" /></div>
        {catalogLoading ? <p className="text-sm text-gray-500">Loading resources...</p> : catalogError ? <p className="text-sm text-accent-700">{catalogError}</p> : visibleCandidates.length === 0 ? <EmptyState title="No matching resources" /> : <div className="space-y-2">{visibleCandidates.map((candidate) => {
          const alreadyAdded = job.operationalWorkAreas?.flatMap((area) => area.lineItems).some((line) => (candidate.budgetItemId && line.sourceBudgetItemId === candidate.budgetItemId) || (candidate.materialCatalogItemId && line.materialCatalogItemId === candidate.materialCatalogItemId));
          return <div key={`${candidate.budgetItemId ?? ''}:${candidate.materialCatalogItemId ?? ''}:${candidate.sourceEntityId ?? candidate.name}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-brand-100 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{candidate.name}</p><p className="mt-1 text-xs text-gray-500">Cost {candidate.costRate == null ? 'Needs review' : `${formatCurrency(candidate.costRate)}/${candidate.unit}`} · Recommended {candidate.sellRate == null ? 'Unavailable' : `${formatCurrency(candidate.sellRate)}/${candidate.unit}`}</p></div><Button size="sm" variant="secondary" disabled={alreadyAdded || saving} onClick={async () => { const ok = await mutate({ action: 'add-resource', workAreaId: workArea.id, sourceBudgetItemId: candidate.budgetItemId, materialCatalogItemId: candidate.materialCatalogItemId }); if (ok) setCatalogOpen(false); }}>{alreadyAdded ? 'Added' : 'Add'}</Button></div>;
        })}</div>}
      </div>
    </aside></div> : null}
  </div>;
}