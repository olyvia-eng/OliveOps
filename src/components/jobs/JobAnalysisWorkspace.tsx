import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Job, JobAnalysisPayload, JobCostBill, JobEquipmentUsage, MaterialCatalogItem, SubcontractorCatalogItem } from '../../types';
import { formatCurrency, formatDate } from '../../utils';
import { emitAppToast } from '../../toast';
import { uploadFileToStorage, resolveAttachmentUrl } from '../../utils/fileUpload';
import { Button, Card, EmptyState, Input, Modal, Select, TextArea } from '../ui';
import { createJobVendor, deleteJobCostRecord, loadJobAnalysis, saveJobCostRecord, type JobAnalysisReferences } from '../../pages/jobs/jobAnalysisApi';
import { calculateBillDraftTotals, createCustomBillLine, createEstimateMaterialBillLine, createMaterialBillLine, createSubcontractorBillLine, type BillLineDraft } from './jobBillLineModel.js';

type Editor = { type: 'equipment' | 'vendor' | 'subcontractor'; record?: JobEquipmentUsage | JobCostBill };
const categoryLabel = { labour: 'Labour', equipment: 'Equipment', material: 'Materials', subcontractor: 'Subcontractors' };
const percent = (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(1)}%`;
const money = (value: number | null) => value === null ? 'Unavailable' : formatCurrency(value);

export default function JobAnalysisWorkspace({ job }: { job: Job }) {
  const [scope, setScope] = useState('entire-job');
  const [analysis, setAnalysis] = useState<JobAnalysisPayload | null>(null);
  const [references, setReferences] = useState<JobAnalysisReferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const payload = await loadJobAnalysis(job.id, scope, signal);
      setAnalysis(payload.analysis); setReferences(payload.references);
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError(requestError instanceof Error ? requestError.message : 'Job Analysis could not be loaded.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [job.id, scope]);

  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  if (loading && !analysis) return <Card className="p-8"><p className="text-sm text-gray-500">Loading Job Analysis…</p></Card>;
  if (error && !analysis) return <Card className="p-4"><EmptyState title="Job Analysis could not be loaded" description={error} action={<Button onClick={() => void refresh()}>Try again</Button>} /></Card>;
  if (!analysis || !references) return null;
  const summary = analysis.summary;

  const remove = async (record: JobEquipmentUsage | JobCostBill) => {
    if (!window.confirm('Delete this actual cost record? Job totals will be recalculated.')) return;
    try { await deleteJobCostRecord(job.id, { id: record.id, recordType: record.recordType, revision: record.revision }); await refresh(); }
    catch (requestError) { emitAppToast({ message: requestError instanceof Error ? requestError.message : 'Record could not be deleted.', tone: 'error' }); }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-gray-900">Job Performance</h2><p className="text-sm text-gray-500">Accepted Estimate baseline compared with direct costs recorded to date.</p></div>
      <Select label="Scope" value={scope} onChange={(event) => setScope(event.target.value)} className="min-w-56">
        <option value="entire-job">Entire Job</option>
        {references.workAreas.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        <option value="unallocated">Unallocated</option>
      </Select>
    </div>
    {error ? <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {!analysis.baselineAvailable && scope !== 'unallocated' ? <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">This legacy Job does not contain a complete accepted Estimate cost snapshot. Actual costs remain available.</p> : null}

    <Card className="p-4">
      <h3 className="font-semibold text-gray-900">Job Cost Summary</h3>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
        <Metric label="Estimated cost" value={money(summary.estimatedTotalCost)} />
        <Metric label="Actual cost to date" value={money(summary.actualCostToDate)} />
        <Metric label="Remaining estimate" value={money(summary.remainingEstimatedCost)} />
        <Metric label="Estimate consumed" value={percent(summary.costConsumedPercent)} />
        <Metric label="Contract revenue" value={money(summary.contractRevenue)} />
        <Metric label="Estimated gross profit" value={money(summary.estimatedGrossProfit)} note={percent(summary.estimatedGrossMargin)} />
        <Metric label="Revenue less cost to date" value={money(summary.grossProfitAfterRecordedCosts)} note={percent(summary.grossMarginAfterRecordedCosts)} />
      </dl>
      <p className="mt-4 text-xs text-gray-500">Revenue less cost to date is a current position, not final Job profit or a projected final cost.</p>
    </Card>

    <CostComparisonChart rows={analysis.categories} />

    <Card className="overflow-hidden">
      <div className="p-4"><h3 className="font-semibold text-gray-900">Estimated vs Actual</h3><p className="text-xs text-gray-500">Positive variance is under estimate. Negative variance is over estimate.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">Cost category</th><th className="px-4 py-3 text-right">Estimated</th><th className="px-4 py-3 text-right">Actual to date</th><th className="px-4 py-3 text-right">Variance</th></tr></thead><tbody className="divide-y divide-gray-100">{analysis.categories.map((row) => <tr key={row.category}><td className="px-4 py-3 font-medium text-gray-900">{categoryLabel[row.category]}</td><td className="px-4 py-3 text-right">{money(row.estimated)}</td><td className="px-4 py-3 text-right">{money(row.actual)}</td><td className={`px-4 py-3 text-right font-semibold ${row.variance !== null && row.variance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{money(row.variance)}</td></tr>)}</tbody></table></div>
    </Card>

    <Card className="p-4"><h3 className="font-semibold text-gray-900">Time Analysis</h3><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Estimated hours" value={analysis.labour.estimated.hours.toFixed(1)} /><Metric label="Scheduled hours" value={analysis.labour.scheduled.hoursAvailable ? analysis.labour.scheduled.hours.toFixed(1) : 'Unavailable'} /><Metric label="Actual hours" value={analysis.labour.actual.hours.toFixed(1)} /><Metric label="Actual labour cost" value={money(analysis.labour.actual.cost)} /></div>
      {scope === 'entire-job' ? <div className="mt-5 overflow-x-auto"><p className="mb-2 text-xs font-medium uppercase text-gray-500">By Work Area</p><table className="w-full min-w-[620px] text-sm"><thead className="text-left text-xs text-gray-500"><tr><th className="py-2">Work Area</th><th className="py-2 text-right">Estimated hours</th><th className="py-2 text-right">Actual hours</th><th className="py-2 text-right">Estimated cost</th><th className="py-2 text-right">Actual cost</th></tr></thead><tbody className="divide-y divide-gray-100">{analysis.workAreaBreakdown.map((row) => <tr key={row.workAreaId}><td className="py-2 font-medium">{row.workAreaName}</td><td className="py-2 text-right">{row.estimatedHours.toFixed(1)}</td><td className="py-2 text-right">{row.actualHours.toFixed(1)}</td><td className="py-2 text-right">{money(row.estimatedCost)}</td><td className="py-2 text-right">{money(row.actualCost)}</td></tr>)}</tbody></table></div> : null}
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="text-left text-xs text-gray-500"><tr><th className="py-2">Employee</th><th className="py-2">Labour class</th><th className="py-2 text-right">Hours</th><th className="py-2 text-right">Cost</th></tr></thead><tbody className="divide-y divide-gray-100">{analysis.labour.actualEmployees.map((row) => <tr key={row.employeeId}><td className="py-2 font-medium">{row.employeeName}</td><td className="py-2">{row.labourClassName}</td><td className="py-2 text-right">{row.hours.toFixed(1)}</td><td className="py-2 text-right">{row.costAvailable ? formatCurrency(row.cost) : 'Unavailable'}</td></tr>)}</tbody></table>{!analysis.labour.actualEmployees.length ? <p className="py-5 text-sm text-gray-500">No closed Job Time Entries in this scope.</p> : null}</div>
    </Card>

    <CostSection title="Equipment Usage" addLabel="Record usage" onAdd={() => setEditor({ type: 'equipment' })} records={analysis.equipmentUsage} onEdit={(record) => setEditor({ type: 'equipment', record })} onDelete={remove} />
    <MaterialComparison rows={analysis.materialComparisons} />
    <CostSection title="Material Vendor Bills" addLabel="Add vendor bill" onAdd={() => setEditor({ type: 'vendor' })} records={analysis.vendorBills} onEdit={(record) => setEditor({ type: 'vendor', record })} onDelete={remove} />
    <CostSection title="Subcontractor Bills" addLabel="Add subcontractor bill" onAdd={() => setEditor({ type: 'subcontractor' })} records={analysis.subcontractorBills} onEdit={(record) => setEditor({ type: 'subcontractor', record })} onDelete={remove} />
    <CostEditor job={job} editor={editor} references={references} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); }} />
  </div>;
}

function CostComparisonChart({ rows }: { rows: JobAnalysisPayload['categories'] }) {
  const data = rows.map((row) => ({ category: categoryLabel[row.category], Estimated: row.estimated, Actual: row.actual }));
  return <Card className="p-4"><div><h3 className="font-semibold text-gray-900">Cost Comparison</h3><p className="text-xs text-gray-500">Accepted Estimate cost compared with actual cost recorded to date.</p></div><div className="mt-4 h-56" aria-label="Estimated and actual cost by category"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ left: 8, right: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="category" tick={{ fontSize: 12 }} /><YAxis tickFormatter={(value) => `$${Number(value).toLocaleString()}`} width={72} tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => money(value === null || value === undefined ? null : Number(value))} /><Legend /><Bar dataKey="Estimated" fill="#536246" radius={[3, 3, 0, 0]} /><Bar dataKey="Actual" fill="#d97706" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div><table className="sr-only"><caption>Estimated and actual cost by category</caption><thead><tr><th>Category</th><th>Estimated</th><th>Actual</th></tr></thead><tbody>{data.map((row) => <tr key={row.category}><td>{row.category}</td><td>{money(row.Estimated)}</td><td>{money(row.Actual)}</td></tr>)}</tbody></table></Card>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) { return <div><dt className="text-xs font-medium text-gray-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{value}</dd>{note ? <span className="text-xs text-gray-500">{note}</span> : null}</div>; }

function MaterialComparison({ rows }: { rows: JobAnalysisPayload['materialComparisons'] }) {
  if (!rows.length) return null;
  return <Card className="overflow-hidden"><div className="border-b border-gray-200 p-4"><h3 className="font-semibold text-gray-900">Materials</h3><p className="text-xs text-gray-500">Accepted Estimate lines compared with all linked purchases, including repeated purchases and overages.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">Material</th><th className="px-4 py-3">Work Area</th><th className="px-4 py-3 text-right">Estimated Qty.</th><th className="px-4 py-3 text-right">Estimated Total</th><th className="px-4 py-3 text-right">Actual Qty.</th><th className="px-4 py-3 text-right">Actual Total</th><th className="px-4 py-3 text-right">Remaining / Overage</th><th className="px-4 py-3 text-right">Cost Variance</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row, index) => <tr key={row.estimateMaterialSnapshotId ?? `${row.materialCatalogItemId ?? 'custom'}-${index}`}><td className="px-4 py-3 font-medium text-gray-900">{row.description}<span className="ml-1 text-xs font-normal text-gray-500">/{row.unit}</span></td><td className="px-4 py-3 text-gray-600">{row.workAreaName ?? 'Unallocated'}</td><td className="px-4 py-3 text-right tabular-nums">{row.estimatedQuantity}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(row.estimatedTotalCost)}</td><td className="px-4 py-3 text-right tabular-nums">{row.actualQuantity}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCurrency(row.actualTotalCost)}</td><td className={`px-4 py-3 text-right font-medium tabular-nums ${row.remainingQuantity < 0 ? 'text-red-700' : 'text-gray-900'}`}>{Math.abs(row.remainingQuantity)} {row.unit} {row.remainingQuantity < 0 ? 'over' : 'remaining'}</td><td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.costVariance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatCurrency(Math.abs(row.costVariance))} {row.costVariance > 0 ? 'over' : 'under'}</td></tr>)}</tbody></table></div></Card>;
}

function CostSection({ title, addLabel, records, onAdd, onEdit, onDelete }: { title: string; addLabel: string; records: Array<JobEquipmentUsage | JobCostBill>; onAdd: () => void; onEdit: (record: JobEquipmentUsage | JobCostBill) => void; onDelete: (record: JobEquipmentUsage | JobCostBill) => void }) {
  return <Card className="overflow-hidden"><div className="flex items-center justify-between gap-3 p-4"><h3 className="font-semibold text-gray-900">{title}</h3><Button size="sm" onClick={onAdd}><Plus size={15} /> {addLabel}</Button></div>{records.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-gray-100">{records.map((record) => { const equipment = record.recordType === 'equipment'; const party = !equipment ? record.vendorNameSnapshot ?? record.subcontractorNameSnapshot : ''; return <tr key={record.id}><td className="px-4 py-3">{formatDate(equipment ? record.date : record.invoiceDate)}</td><td className="px-4 py-3 font-medium">{equipment ? record.equipmentNameSnapshot : `${party || 'Supplier'}${record.invoiceNumber ? ` · ${record.invoiceNumber}` : ''}`}</td><td className="px-4 py-3 text-gray-600">{equipment ? `${record.quantity} ${record.unit}` : record.description || `${record.lineItems.length} line item${record.lineItems.length === 1 ? '' : 's'}`}</td><td className="px-4 py-3 text-right font-semibold">{formatCurrency(equipment ? record.cost : record.total)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{!equipment && record.attachmentFileId ? <button title="Download invoice" className="p-2 text-gray-500" onClick={() => void resolveAttachmentUrl({ fileId: record.attachmentFileId }).then((url) => url && window.open(url, '_blank', 'noopener,noreferrer'))}><Download size={15} /></button> : null}<button title="Edit" className="p-2 text-gray-500" onClick={() => onEdit(record)}><Pencil size={15} /></button><button title="Delete" className="p-2 text-red-600" onClick={() => onDelete(record)}><Trash2 size={15} /></button></div></td></tr>; })}</tbody></table></div> : <EmptyState title={`No ${title.toLowerCase()} recorded`} description="Actual totals update after a record is saved." />}</Card>;
}

function CostEditor({ job, editor, references, onClose, onSaved }: { job: Job; editor: Editor | null; references: JobAnalysisReferences; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = editor?.record;
  const existingBill = existing && existing.recordType !== 'equipment' ? existing : undefined;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<BillLineDraft[]>([]);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [catalogOpen, setCatalogOpen] = useState<'estimate-materials' | 'materials' | 'subcontractors' | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!editor) return;
    if (existing?.recordType === 'equipment') setForm({ equipmentId: existing.equipmentId, date: existing.date, quantity: String(existing.quantity), unit: existing.unit, workAreaId: existing.workAreaId ?? '', notes: existing.notes ?? '' });
    else setForm({ vendorId: existingBill?.vendorId ?? '', subcontractorId: existingBill?.subcontractorId ?? '', invoiceNumber: existingBill?.invoiceNumber ?? '', invoiceDate: existingBill?.invoiceDate ?? new Date().toISOString().slice(0, 10), dueDate: existingBill?.dueDate ?? '', description: existingBill?.description ?? '', notes: existingBill?.notes ?? '', taxRate: String(existingBill?.taxRate ?? 0), newVendorName: '' });
    setLines(existingBill?.lineItems.map((line) => ({ ...line, workAreaId: line.workAreaId ?? '' })) ?? []);
    setAttachment(null);
    setCatalogOpen(null);
    setCatalogSearch('');
    setSelectedMaterialIds(new Set());
  }, [editor, existing, existingBill]);
  if (!editor) return null;
  const field = (name: string) => ({ value: form[name] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [name]: event.target.value })) });
  const updateLine = <K extends keyof BillLineDraft>(index: number, property: K, value: BillLineDraft[K]) => {
    setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [property]: value } : item));
  };
  const billTotals = calculateBillDraftTotals(lines, Number(form.taxRate ?? 0));
  const chooseSubcontractor = (item: SubcontractorCatalogItem) => {
    setForm((current) => ({ ...current, subcontractorId: item.id }));
    if (lines.length === 0) setLines([createSubcontractorBillLine(item)]);
    setCatalogOpen(null);
    setCatalogSearch('');
  };
  const addSelectedMaterials = () => {
    const selected = references.materials.filter((material) => selectedMaterialIds.has(material.id));
    setLines((current) => [...current, ...selected.map((material) => createMaterialBillLine(material))]);
    setCatalogOpen(null);
    setCatalogSearch('');
    setSelectedMaterialIds(new Set());
  };
  const addSelectedEstimateMaterials = () => {
    const selected = references.estimateMaterials.filter((material) => material.estimateMaterialSnapshotId && selectedMaterialIds.has(material.estimateMaterialSnapshotId));
    setLines((current) => [...current, ...selected.map((material) => createEstimateMaterialBillLine({ ...material, estimateMaterialSnapshotId: material.estimateMaterialSnapshotId!, workAreaId: material.workAreaId! }))]);
    setCatalogOpen(null);
    setCatalogSearch('');
    setSelectedMaterialIds(new Set());
  };
  const save = async () => {
    setSaving(true);
    try {
      let vendorId = form.vendorId;
      if (editor.type === 'vendor' && !vendorId && form.newVendorName.trim()) vendorId = (await createJobVendor(job.id, { name: form.newVendorName })).vendor.id;
      const body: Record<string, unknown> = { id: existing?.id, revision: existing?.revision, recordType: editor.type };
      if (editor.type === 'equipment') Object.assign(body, { equipmentId: form.equipmentId, date: form.date, quantity: Number(form.quantity), unit: form.unit, workAreaId: form.workAreaId, notes: form.notes });
      else Object.assign(body, { vendorId, subcontractorId: form.subcontractorId, invoiceNumber: form.invoiceNumber, invoiceDate: form.invoiceDate, dueDate: form.dueDate, description: form.description, notes: form.notes, taxRate: Number(form.taxRate), lineItems: lines });
      await saveJobCostRecord(job.id, body as Record<string, unknown> & { id?: string });
      if (attachment && existingBill) {
        const uploaded = await uploadFileToStorage({ file: attachment, entityType: 'job-cost-bill', entityId: existingBill.id, category: 'invoice', jobId: job.id });
        await saveJobCostRecord(job.id, { ...body, id: existingBill.id, revision: existingBill.revision + 1, attachmentFileId: uploaded.fileId });
      }
      emitAppToast({ message: 'Job cost saved.', tone: 'success' }); await onSaved();
    } catch (requestError) { emitAppToast({ message: requestError instanceof Error ? requestError.message : 'Job cost could not be saved.', tone: 'error' }); }
    finally { setSaving(false); }
  };
  const bill = editor.type !== 'equipment';
  return <>
    <Modal open onClose={onClose} title={existing ? 'Edit actual cost' : 'Add actual cost'} size={bill ? 'wide' : 'default'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
      <div className="space-y-4">{editor.type === 'equipment' ? <>
        <Select label="Equipment" required {...field('equipmentId')}><option value="">Select equipment</option>{references.equipment.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatCurrency(item.costRateHourly ?? item.hourlyCost)}/hr</option>)}</Select>
        <div className="grid grid-cols-2 gap-3"><Input label="Usage date" type="date" required {...field('date')} /><Input label="Hours or quantity" type="number" min="0.01" step="0.01" required {...field('quantity')} /></div>
        <Input label="Unit" {...field('unit')} />
        <WorkAreaSelect references={references} value={form.workAreaId} onChange={(value) => setForm((current) => ({ ...current, workAreaId: value }))} />
        <TextArea label="Notes" {...field('notes')} />
      </> : <>
        <div className="grid gap-3 sm:grid-cols-2">
          {editor.type === 'vendor' ? <>
            <Select label="Vendor" {...field('vendorId')}><option value="">Select vendor</option>{references.vendors.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
            <Input label="Or create vendor" placeholder="Vendor name" {...field('newVendorName')} />
          </> : <div>
            <p className="mb-1 text-sm font-medium text-gray-700">Subcontractor</p>
            <button type="button" className="flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 text-left text-sm" onClick={() => setCatalogOpen('subcontractors')}>
              <span>{references.subcontractors.find((item) => item.id === form.subcontractorId)?.name ?? 'Choose from Subcontractor Catalog'}</span><Search size={15} className="text-gray-400" />
            </button>
          </div>}
          <Input label="Invoice number" {...field('invoiceNumber')} />
          <Input label="Invoice date" type="date" required {...field('invoiceDate')} />
          <Input label="Due date" type="date" {...field('dueDate')} />
          <Input label="Tax rate (%)" type="number" min="0" max="100" step="0.01" {...field('taxRate')} />
        </div>
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-700">Line items</p>
            <div className="flex flex-wrap gap-2">
              {editor.type === 'vendor' ? <><Button type="button" size="sm" onClick={() => setCatalogOpen('estimate-materials')}><Plus size={14} /> Add from Estimate</Button><Button type="button" size="sm" variant="secondary" onClick={() => setCatalogOpen('materials')}><Plus size={14} /> Add from Material Catalog</Button></> : null}
              <Button type="button" size="sm" variant="secondary" onClick={() => setLines((current) => [...current, createCustomBillLine()])}><Plus size={14} /> Custom Line</Button>
            </div>
          </div>
          {lines.length ? <BillLineTable lines={lines} references={references} onChange={updateLine} onDelete={(index) => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} /> : <p className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">Add a catalog item or custom line to record this invoice.</p>}
          <dl className="ml-auto mt-3 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-gray-500">Subtotal</dt><dd className="text-right font-medium tabular-nums">{formatCurrency(billTotals.subtotal)}</dd>
            <dt className="text-gray-500">Tax</dt><dd className="text-right font-medium tabular-nums">{formatCurrency(billTotals.tax)}</dd>
            <dt className="border-t border-gray-200 pt-2 font-semibold">Total</dt><dd className="border-t border-gray-200 pt-2 text-right font-semibold tabular-nums">{formatCurrency(billTotals.total)}</dd>
          </dl>
        </div>
        <TextArea label="Notes" {...field('notes')} />
        {existingBill ? <Input label="Invoice attachment" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /> : <p className="text-xs text-gray-500">Save the bill, then edit it to attach the vendor invoice.</p>}
      </>}</div>
    </Modal>
    {catalogOpen ? <CatalogSelector mode={catalogOpen} estimateMaterials={references.estimateMaterials} materials={references.materials} subcontractors={references.subcontractors} query={catalogSearch} onQueryChange={setCatalogSearch} selectedMaterialIds={selectedMaterialIds} onToggleMaterial={(id) => setSelectedMaterialIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onChooseSubcontractor={chooseSubcontractor} onAddMaterials={catalogOpen === 'estimate-materials' ? addSelectedEstimateMaterials : addSelectedMaterials} onClose={() => { setCatalogOpen(null); setCatalogSearch(''); setSelectedMaterialIds(new Set()); }} /> : null}
  </>;
}

function BillLineTable({ lines, references, onChange, onDelete }: { lines: BillLineDraft[]; references: JobAnalysisReferences; onChange: <K extends keyof BillLineDraft>(index: number, property: K, value: BillLineDraft[K]) => void; onDelete: (index: number) => void }) {
  return <div className="overflow-x-auto rounded-md border border-gray-200"><div className="min-w-[920px]">
    <div className="grid grid-cols-[minmax(220px,2fr)_90px_100px_120px_120px_minmax(150px,1fr)_44px] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600"><span>Material / Description</span><span>Quantity</span><span>Unit</span><span>Unit Cost</span><span className="text-right">Total</span><span>Work Area</span><span className="sr-only">Delete</span></div>
    {lines.map((line, index) => <div key={line.id ?? `${line.materialCatalogItemId ?? 'custom'}-${index}`} className="grid grid-cols-[minmax(220px,2fr)_90px_100px_120px_120px_minmax(150px,1fr)_44px] items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0">
      <div><Input aria-label={`Description for line ${index + 1}`} value={line.description} onChange={(event) => onChange(index, 'description', event.target.value)} />{line.estimateMaterialSnapshotId ? <p className="mt-1 text-xs text-gray-500">Accepted Estimate</p> : line.materialCatalogItemId ? <p className="mt-1 text-xs text-gray-500">Material Catalog</p> : null}</div>
      <Input aria-label={`Quantity for ${line.description || `line ${index + 1}`}`} type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => onChange(index, 'quantity', Number(event.target.value))} />
      <Input aria-label={`Unit for ${line.description || `line ${index + 1}`}`} value={line.unit} onChange={(event) => onChange(index, 'unit', event.target.value)} />
      <Input aria-label={`Unit Cost for ${line.description || `line ${index + 1}`}`} type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => onChange(index, 'unitCost', Number(event.target.value))} />
      <p className="text-right font-semibold tabular-nums">{formatCurrency(line.quantity * line.unitCost)}</p>
      <Select aria-label={`Work Area for ${line.description || `line ${index + 1}`}`} value={line.workAreaId} onChange={(event) => onChange(index, 'workAreaId', event.target.value)}><option value="">Unallocated</option>{references.workAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</Select>
      <button type="button" title="Delete line" aria-label={`Delete ${line.description || `line ${index + 1}`}`} className="p-2 text-red-600" onClick={() => onDelete(index)}><Trash2 size={16} /></button>
    </div>)}
  </div></div>;
}

function CatalogSelector({ mode, estimateMaterials, materials, subcontractors, query, onQueryChange, selectedMaterialIds, onToggleMaterial, onChooseSubcontractor, onAddMaterials, onClose }: { mode: 'estimate-materials' | 'materials' | 'subcontractors'; estimateMaterials: JobAnalysisPayload['materialComparisons']; materials: MaterialCatalogItem[]; subcontractors: SubcontractorCatalogItem[]; query: string; onQueryChange: (value: string) => void; selectedMaterialIds: Set<string>; onToggleMaterial: (id: string) => void; onChooseSubcontractor: (item: SubcontractorCatalogItem) => void; onAddMaterials: () => void; onClose: () => void }) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleMaterials = useMemo(() => materials.filter((item) => item.active !== false && (!normalizedQuery || [item.name, item.unit, item.notes].some((value) => value?.toLowerCase().includes(normalizedQuery)))), [materials, normalizedQuery]);
  const visibleSubcontractors = useMemo(() => subcontractors.filter((item) => !normalizedQuery || [item.name, item.trade, item.unit, item.contactName].some((value) => value?.toLowerCase().includes(normalizedQuery))), [subcontractors, normalizedQuery]);
  const visibleEstimateMaterials = useMemo(() => estimateMaterials.filter((item) => !normalizedQuery || [item.description, item.workAreaName, item.unit].some((value) => value?.toLowerCase().includes(normalizedQuery))), [estimateMaterials, normalizedQuery]);
  const materialMode = mode === 'materials';
  const estimateMode = mode === 'estimate-materials';
  const visibleItems = estimateMode ? visibleEstimateMaterials : materialMode ? visibleMaterials : visibleSubcontractors;
  return <Modal open onClose={onClose} title={estimateMode ? 'Accepted Estimate Materials' : materialMode ? 'Material Catalog' : 'Subcontractor Catalog'} size="wide" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>{mode !== 'subcontractors' ? <Button onClick={onAddMaterials} disabled={selectedMaterialIds.size === 0}>Add selected ({selectedMaterialIds.size})</Button> : null}</>}>
    <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={estimateMode ? 'Search Estimate materials or Work Areas...' : materialMode ? 'Search materials...' : 'Search company or trade...'} aria-label={estimateMode ? 'Search accepted Estimate materials' : materialMode ? 'Search Material Catalog' : 'Search Subcontractor Catalog'} className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
    <div className="mt-4 max-h-[55vh] overflow-y-auto border-y border-gray-200">{estimateMode ? visibleEstimateMaterials.map((item) => { const id = item.estimateMaterialSnapshotId!; const selected = selectedMaterialIds.has(id); return <button key={id} type="button" aria-pressed={selected} onClick={() => onToggleMaterial(id)} className="grid w-full grid-cols-[24px_minmax(0,1fr)_130px_130px_150px] items-center gap-3 border-b border-gray-100 px-3 py-3 text-left last:border-b-0 hover:bg-gray-50"><span className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'}`}>{selected ? <Check size={14} /> : null}</span><span><span className="block font-medium text-gray-900">{item.description}</span><span className="text-xs text-gray-500">{item.workAreaName ?? 'Unallocated'}</span></span><span className="text-sm text-gray-600">Estimate {item.estimatedQuantity} {item.unit}<br />{money(item.estimatedUnitCost)} / {item.unit}</span><span className="text-sm text-gray-600">Billed {item.actualQuantity} {item.unit}<br />{formatCurrency(item.actualTotalCost)}</span><span className={`text-right text-sm font-semibold ${item.remainingQuantity < 0 ? 'text-red-700' : 'text-gray-900'}`}>{Math.abs(item.remainingQuantity)} {item.unit}<br />{item.remainingQuantity < 0 ? 'over estimate' : 'remaining'}</span></button>; }) : materialMode ? visibleMaterials.map((item) => { const selected = selectedMaterialIds.has(item.id); return <button key={item.id} type="button" aria-pressed={selected} onClick={() => onToggleMaterial(item.id)} className="grid w-full grid-cols-[24px_minmax(0,1fr)_100px_130px] items-center gap-3 border-b border-gray-100 px-3 py-3 text-left last:border-b-0 hover:bg-gray-50"><span className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'}`}>{selected ? <Check size={14} /> : null}</span><span className="font-medium text-gray-900">{item.name}</span><span className="text-sm text-gray-600">{item.unit}</span><span className="text-right text-sm font-semibold">{formatCurrency(item.defaultUnitCost)} / {item.unit}</span></button>; }) : visibleSubcontractors.map((item) => <button key={item.id} type="button" onClick={() => onChooseSubcontractor(item)} className="grid w-full grid-cols-[minmax(0,1fr)_140px_150px] gap-3 border-b border-gray-100 px-3 py-3 text-left last:border-b-0 hover:bg-gray-50"><span><span className="block font-medium text-gray-900">{item.name}</span><span className="text-xs text-gray-500">{item.trade || 'General subcontractor'}</span></span><span className="text-sm text-gray-600">{item.unit}</span><span className="text-right text-sm font-semibold">{formatCurrency(item.defaultUnitCost)} / {item.unit}</span></button>)}</div>
    {visibleItems.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">No catalog items match this search.</p> : null}
  </Modal>;
}

function WorkAreaSelect({ references, value, onChange }: { references: JobAnalysisReferences; value: string; onChange: (value: string) => void }) { return <Select label="Work Area" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Unallocated</option>{references.workAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</Select>; }