import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '../../components/ui';
import { useUnsavedChangesGuard } from '../../components/navigation/UnsavedChangesGuard';
import WorkAreaResourceSection from '../../components/work-areas/WorkAreaResourceSection';
import { WORK_AREA_CATEGORY_LABEL, WORK_AREA_CATEGORY_ORDER } from '../../components/work-areas/workAreaCategories';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { EstimatePricingCatalog, EstimatePricingCatalogItem, JobWorkAreaLineItem, LineItemCategory } from '../../types';
import { formatCurrency } from '../../utils';
import { isEstimateEditorDirty, serializeEstimateEditorState } from '../../utils/estimateDirtyModel.js';
import { formatJobPlanRateInput, jobLineHoursPerWorker, jobLinePlannedQuantity, jobLinePlannedTotal, jobLineWorkers, jobWorkAreaDraftTotals, loadJobWorkAreaDraft, type JobWorkAreaDraft } from '../../utils/jobWorkAreaDraftModel.js';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';

interface Props {
  currentUserRole: string;
}

const editableNumber = (value: number) => formatNumericDisplayValue(Math.round(value * 100) / 100);
const rate = (value: number, unit: string) => `${formatCurrency(value)}/${unit}`;
const workAreaStatusColor: Record<JobWorkAreaDraft['status'], string> = {
  not_started: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-brand-100 text-brand-700',
  on_hold: 'bg-accent-100 text-accent-700',
  complete: 'bg-brand-200 text-brand-800',
};

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
  const [form, setForm] = useState<JobWorkAreaDraft | null>(workArea ? loadJobWorkAreaDraft(workArea) : null);
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>(() => Object.fromEntries((workArea?.lineItems ?? []).map((line) => [line.id, formatJobPlanRateInput(line.unitCost)])));
  const [expandedLineIds, setExpandedLineIds] = useState<Set<string>>(() => new Set());
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
    setForm(workArea ? loadJobWorkAreaDraft(workArea) : null);
    setCostDrafts(Object.fromEntries((workArea?.lineItems ?? []).map((line) => [line.id, formatJobPlanRateInput(line.unitCost)])));
  }, [workArea]);

  const initialSnapshot = useMemo(() => workArea ? serializeEstimateEditorState(loadJobWorkAreaDraft(workArea)) : '', [workArea]);
  const isDirty = useMemo(() => Boolean(form && initialSnapshot && isEstimateEditorDirty(form, JSON.parse(initialSnapshot) as JobWorkAreaDraft)), [form, initialSnapshot]);
  const groupedLines = useMemo(() => WORK_AREA_CATEGORY_ORDER.reduce<Record<LineItemCategory, JobWorkAreaLineItem[]>>((groups, category) => {
    groups[category] = form?.lineItems.filter((line) => line.category === category) ?? [];
    return groups;
  }, { labour: [], equipment: [], material: [], subcontractor: [] }), [form?.lineItems]);
  const totals = useMemo(() => form ? jobWorkAreaDraftTotals(form) : { plannedCost: 0, soldRevenue: 0 }, [form]);

  const visibleCandidates = useMemo(() => {
    if (!catalog) return [];
    const groups: Record<LineItemCategory, EstimatePricingCatalogItem[]> = { labour: catalog.labour, equipment: catalog.equipment, material: catalog.materials, subcontractor: catalog.subcontractors };
    const query = catalogSearch.trim().toLowerCase();
    return groups[catalogCategory].filter((item) => !query || `${item.name} ${item.description} ${item.costCode ?? ''}`.toLowerCase().includes(query));
  }, [catalog, catalogCategory, catalogSearch]);

  const persistWorkArea = async (): Promise<boolean> => {
    if (!job || !workArea || !form || saving || !form.name.trim()) return false;
    setSaving(true);
    const result = await mutateJobPlan(job.id, {
      action: 'save-work-area',
      workAreaId: workArea.id,
      name: form.name,
      description: form.description,
      status: form.status,
      lines: form.lineItems.map((line) => ({
        id: line.id,
        quantity: jobLinePlannedQuantity(line),
        ...(line.category === 'labour' ? { workers: jobLineWorkers(line), hoursPerWorker: jobLineHoursPerWorker(line) } : {}),
        ...(canEditFinancials ? { unitCost: Math.max(0, line.unitCost) } : {}),
        description: line.description,
      })),
    });
    setSaving(false);
    if (result.ok) emitAppToast({ tone: 'success', message: 'Job Work Area saved.' });
    return result.ok;
  };

  const { requestNavigation, guardModal } = useUnsavedChangesGuard({ isDirty, isSaving: saving, onSave: persistWorkArea, subject: 'work area' });

  const updateLine = (lineId: string, changes: Partial<JobWorkAreaLineItem>) => {
    setForm((current) => current ? { ...current, lineItems: current.lineItems.map((line) => line.id === lineId ? { ...line, ...changes } : line) } : current);
  };
  const removeLine = (lineId: string) => setForm((current) => current ? { ...current, lineItems: current.lineItems.filter((line) => line.id !== lineId) } : current);

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

  const addCandidate = async (candidate: EstimatePricingCatalogItem) => {
    if (!job || !workArea || saving) return;
    if (isDirty && !await persistWorkArea()) return;
    setSaving(true);
    const result = await mutateJobPlan(job.id, { action: 'add-resource', workAreaId: workArea.id, sourceBudgetItemId: candidate.budgetItemId, materialCatalogItemId: candidate.materialCatalogItemId });
    setSaving(false);
    if (result.ok) setCatalogOpen(false);
  };

  if (!job || initializing) return <Card className="p-6"><p className="text-sm text-gray-500">{initializing ? 'Preparing the current Job plan...' : 'Job not found.'}</p></Card>;
  if (!workArea || !form) return <div className="space-y-4"><Button variant="secondary" onClick={() => navigate(`/jobs/${job.id}?tab=work-areas`)}><ArrowLeft size={15} /> Back to Job</Button><Card className="p-6"><h2 className="font-semibold">Work Area not found</h2><p className="mt-2 text-sm text-gray-500">This Work Area was removed or is not available.</p></Card></div>;

  const renderLineGroup = (category: LineItemCategory) => {
    const lines = groupedLines[category];
    const labour = category === 'labour';
    const grid = labour ? 'grid-cols-[minmax(190px,1.5fr)_78px_105px_125px_115px_125px_125px_76px]' : 'grid-cols-[minmax(190px,1.5fr)_125px_135px_115px_135px_125px_76px]';
    return <WorkAreaResourceSection key={category} category={category} itemCount={lines.length} canAdd={canEditFinancials} onAdd={() => void openCatalog(category)} emptyText={`No ${WORK_AREA_CATEGORY_LABEL[category].toLowerCase()} planned.`}>
      <div className="mt-4 overflow-x-auto rounded-lg border border-brand-100 dark:border-brand-600">
        <div className={`hidden min-w-[1060px] ${grid} gap-3 border-b border-brand-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-200 lg:grid`}>
          <span>Item</span>{labour ? <><span>Workers</span><span>Hours / Worker</span></> : <span>Hours / Quantity</span>}<span className="text-right">Planned Cost / Unit</span><span className="text-right">Sold Rate</span><span className="text-right">Total Planned Cost</span><span className="text-right">Sold Revenue</span><span className="text-right">Actions</span>
        </div>
        {lines.map((line) => {
          const workers = jobLineWorkers(line);
          const hoursPerWorker = jobLineHoursPerWorker(line);
          const expanded = expandedLineIds.has(line.id);
          const fromEstimate = Boolean(line.sourceEstimateLineItemId);
          return <div key={line.id} className="border-b border-brand-100 bg-brand-50/40 last:border-b-0 dark:border-brand-600 dark:bg-brand-900/20">
            <div className={`grid min-w-[1060px] ${grid} items-center gap-3 px-3 py-3 text-sm`}>
              <div className="min-w-0"><p className="truncate font-semibold text-gray-900 dark:text-brand-50">{line.itemName || line.description || 'Untitled Item'}</p><div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-brand-300"><span>{line.unit}</span>{fromEstimate ? <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500 dark:bg-brand-700 dark:text-brand-200">From Estimate</span> : null}</div></div>
              {labour ? <><input aria-label={`Workers for ${line.itemName}`} type="text" inputMode="numeric" value={workers} onChange={(event) => { const nextWorkers = Math.max(1, Math.floor(parseNumericInputValue(event.target.value) || 1)); updateLine(line.id, { workers: nextWorkers, quantity: nextWorkers * hoursPerWorker }); }} onFocus={(event) => event.currentTarget.select()} className="h-9 w-16 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold dark:border-brand-600 dark:bg-brand-700" /><label className="flex items-center gap-1.5"><input aria-label={`Hours per worker for ${line.itemName}`} type="text" inputMode="decimal" value={editableNumber(hoursPerWorker)} onChange={(event) => { const hours = Math.max(0, parseNumericInputValue(event.target.value)); updateLine(line.id, { hoursPerWorker: hours, quantity: workers * hours }); }} onFocus={(event) => event.currentTarget.select()} className="h-9 w-20 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold dark:border-brand-600 dark:bg-brand-700" /><span className="text-xs text-gray-500">hr</span></label></> : <label className="flex items-center gap-1.5"><input aria-label={`${line.unit === 'hr' ? 'Hours' : 'Quantity'} for ${line.itemName}`} type="text" inputMode="decimal" value={editableNumber(line.quantity)} onChange={(event) => updateLine(line.id, { quantity: Math.max(0, parseNumericInputValue(event.target.value)) })} onFocus={(event) => event.currentTarget.select()} className="h-9 w-20 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold dark:border-brand-600 dark:bg-brand-700" /><span className="text-xs text-gray-500">{line.unit}</span></label>}
              {canEditFinancials ? <label className="flex items-center justify-end gap-1"><span className="text-xs text-gray-500">$</span><input aria-label={`Planned cost for ${line.itemName}`} type="text" inputMode="decimal" value={costDrafts[line.id] ?? formatJobPlanRateInput(line.unitCost)} onChange={(event) => { setCostDrafts((current) => ({ ...current, [line.id]: event.target.value })); updateLine(line.id, { unitCost: Math.max(0, parseNumericInputValue(event.target.value)) }); }} onBlur={() => setCostDrafts((current) => ({ ...current, [line.id]: formatJobPlanRateInput(line.unitCost) }))} onFocus={(event) => event.currentTarget.select()} className="h-9 w-20 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold dark:border-brand-600 dark:bg-brand-700" /><span className="text-xs text-gray-500">/{line.unit}</span></label> : <span className="text-right text-gray-400">Restricted</span>}
              <p className="text-right font-medium tabular-nums text-gray-600 dark:text-brand-200">{fromEstimate ? rate(line.sellPrice, line.unit) : '—'}</p>
              <p className="text-right font-semibold tabular-nums text-gray-900 dark:text-brand-50">{canEditFinancials ? formatCurrency(jobLinePlannedTotal(line)) : '—'}</p>
              <p className="text-right font-medium tabular-nums text-gray-600 dark:text-brand-200">{fromEstimate ? formatCurrency(line.contractRevenue ?? line.total) : '—'}</p>
              <div className="flex items-center justify-end gap-1"><button type="button" title={expanded ? 'Collapse notes' : 'Edit notes'} onClick={() => setExpandedLineIds((current) => { const next = new Set(current); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next; })} className="rounded-md p-2 text-gray-400 hover:bg-white hover:text-brand-700 dark:hover:bg-brand-700"><Pencil size={14} /></button>{canEditFinancials ? <button type="button" title="Remove resource" onClick={() => removeLine(line.id)} className="rounded-md p-2 text-gray-400 hover:bg-white hover:text-accent-700 dark:hover:bg-brand-700"><Trash2 size={14} /></button> : null}</div>
            </div>
            {expanded ? <div className="grid gap-3 border-t border-brand-100 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_15rem] dark:border-brand-600"><label className="block text-xs font-medium text-gray-600 dark:text-brand-200">Description / Notes<textarea rows={2} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm font-normal text-brand-900 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label><div className="self-end rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-brand-700 dark:text-brand-200"><p>Plan changes affect expected cost only.</p>{fromEstimate ? <p className="mt-1 font-medium">Sold revenue remains {formatCurrency(line.contractRevenue ?? line.total)}.</p> : <p className="mt-1 font-medium">Job-added resource</p>}</div></div> : null}
          </div>;
        })}
      </div>
    </WorkAreaResourceSection>;
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-brand-300"><Link to="/jobs" className="hover:text-brand-700">Jobs</Link><span>/</span><Link to={`/jobs/${job.id}?tab=work-areas`} className="hover:text-brand-700">{job.title}</Link><span>/</span><span className="text-gray-700 dark:text-brand-100">{form.name || workArea.name}</span></div>
    <PageHeader title={form.name || workArea.name} subtitle={`${customer?.name ?? 'Unknown Customer'} · Current Job Plan`} action={<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => requestNavigation(`/jobs/${job.id}?tab=work-areas`)}><ArrowLeft size={15} /> Back to Job</Button><Button onClick={() => void persistWorkArea()} disabled={!isDirty || saving || !form.name.trim()}>{saving ? 'Saving...' : 'Save Work Area'}</Button></div>} />
    <div className="flex flex-wrap gap-2"><Badge label={form.status.replaceAll('_', ' ')} className={workAreaStatusColor[form.status]} /><Badge label="Current Job Plan" className="bg-brand-100 text-brand-700" /><Badge label={`Revision ${job.planningRevision ?? 1}`} className="bg-gray-100 text-gray-700" /></div>
    <Card className="space-y-4 p-4"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]"><Input label="Work Area Name" required value={form.name} onChange={(event) => setForm((current) => current ? { ...current, name: event.target.value } : current)} /><Select label="Status" value={form.status} onChange={(event) => setForm((current) => current ? { ...current, status: event.target.value as JobWorkAreaDraft['status'] } : current)}><option value="not_started">Not Started</option><option value="in_progress">In Progress</option><option value="on_hold">On Hold</option><option value="complete">Complete</option></Select></div><label className="block text-sm font-medium text-gray-700 dark:text-brand-100">Description / Scope<textarea rows={3} value={form.description} onChange={(event) => setForm((current) => current ? { ...current, description: event.target.value } : current)} className="mt-1.5 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm font-normal text-brand-900 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label></Card>
    {canEditFinancials ? <Card className="space-y-4 p-4"><div><h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Work Area Totals</h2><p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Compare the current plan with the revenue sold on the Estimate.</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-600 dark:bg-brand-900/20"><p className="text-xs text-gray-500">Planned Cost</p><p className="mt-1 text-lg font-semibold">{formatCurrency(totals.plannedCost)}</p></div><div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-600 dark:bg-brand-900/20"><p className="text-xs text-gray-500">Sold Revenue</p><p className="mt-1 text-lg font-semibold">{formatCurrency(totals.soldRevenue)}</p></div></div></Card> : null}
    {WORK_AREA_CATEGORY_ORDER.map(renderLineGroup)}
    {canEditFinancials ? <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-semibold">Remove Work Area</h2><p className="text-sm text-gray-500">The sold Estimate remains unchanged.</p></div><Button variant="danger" onClick={async () => { if (window.confirm('Delete this Job Work Area from the current plan?') && (await mutateJobPlan(job.id, { action: 'delete-work-area', workAreaId: workArea.id })).ok) navigate(`/jobs/${job.id}?tab=work-areas`); }}><Trash2 size={14} /> Delete Work Area</Button></Card> : null}
    {catalogOpen ? <div className="fixed inset-0 z-50"><div className="absolute inset-0 bg-black/50" onClick={() => setCatalogOpen(false)} /><aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl dark:bg-brand-800" aria-label={`Add ${WORK_AREA_CATEGORY_LABEL[catalogCategory]}`}><div className="flex items-center justify-between border-b border-brand-100 px-4 py-3 dark:border-brand-600"><div><h2 className="font-semibold">Add {WORK_AREA_CATEGORY_LABEL[catalogCategory]}</h2><p className="text-xs text-gray-500">New resources affect planned cost, not sold revenue.</p></div><button type="button" title="Close" onClick={() => setCatalogOpen(false)} className="rounded-md p-2 text-gray-500"><X size={18} /></button></div><div className="flex-1 overflow-y-auto p-4"><div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder={`Search ${WORK_AREA_CATEGORY_LABEL[catalogCategory].toLowerCase()}...`} className="h-10 w-full rounded-lg border border-brand-100 pl-9 pr-3 text-sm dark:border-brand-600 dark:bg-brand-700" /></div>{catalogLoading ? <p className="text-sm text-gray-500">Loading resources...</p> : catalogError ? <p className="text-sm text-accent-700">{catalogError}</p> : visibleCandidates.length === 0 ? <EmptyState title="No matching resources" /> : <div className="space-y-2">{visibleCandidates.map((candidate) => { const alreadyAdded = job.operationalWorkAreas?.flatMap((area) => area.lineItems).some((line) => (candidate.budgetItemId && line.sourceBudgetItemId === candidate.budgetItemId) || (candidate.materialCatalogItemId && line.materialCatalogItemId === candidate.materialCatalogItemId)); return <div key={`${candidate.budgetItemId ?? ''}:${candidate.materialCatalogItemId ?? ''}:${candidate.sourceEntityId ?? candidate.name}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-brand-100 p-3 dark:border-brand-600"><div className="min-w-0"><p className="truncate text-sm font-semibold">{candidate.name}</p><p className="mt-1 text-xs text-gray-500">Cost {candidate.costRate == null ? 'Needs review' : rate(candidate.costRate, candidate.unit)} · Recommended {candidate.sellRate == null ? 'Unavailable' : rate(candidate.sellRate, candidate.unit)}</p></div><Button size="sm" variant="secondary" disabled={alreadyAdded || saving} onClick={() => void addCandidate(candidate)}>{alreadyAdded ? 'Added' : <><Plus size={14} /> Add</>}</Button></div>; })}</div>}</div></aside></div> : null}
    {guardModal}
  </div>;
}