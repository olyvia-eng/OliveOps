import { useCallback, useEffect, useState } from 'react';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Job, JobAnalysisPayload, JobCostBill, JobEquipmentUsage } from '../../types';
import { formatCurrency, formatDate } from '../../utils';
import { emitAppToast } from '../../toast';
import { uploadFileToStorage, resolveAttachmentUrl } from '../../utils/fileUpload';
import { Button, Card, EmptyState, Input, Modal, Select, TextArea } from '../ui';
import { createJobVendor, deleteJobCostRecord, loadJobAnalysis, saveJobCostRecord, type JobAnalysisReferences } from '../../pages/jobs/jobAnalysisApi';

type Editor = { type: 'equipment' | 'vendor' | 'subcontractor'; record?: JobEquipmentUsage | JobCostBill };
type BillLineDraft = { id?: string; description: string; quantity: number; unit: string; unitCost: number; workAreaId: string; materialCatalogItemId?: string };
const categoryLabel = { labour: 'Labour', equipment: 'Equipment', material: 'Materials', subcontractor: 'Subcontractors' };
const blankLine = (): BillLineDraft => ({ description: '', quantity: 1, unit: 'ea', unitCost: 0, workAreaId: '' });
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

    <Card className="overflow-hidden">
      <div className="p-4"><h3 className="font-semibold text-gray-900">Estimated vs Actual</h3><p className="text-xs text-gray-500">Positive variance is under estimate. Negative variance is over estimate.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">Cost category</th><th className="px-4 py-3 text-right">Estimated</th><th className="px-4 py-3 text-right">Actual to date</th><th className="px-4 py-3 text-right">Variance</th></tr></thead><tbody className="divide-y divide-gray-100">{analysis.categories.map((row) => <tr key={row.category}><td className="px-4 py-3 font-medium text-gray-900">{categoryLabel[row.category]}</td><td className="px-4 py-3 text-right">{money(row.estimated)}</td><td className="px-4 py-3 text-right">{money(row.actual)}</td><td className={`px-4 py-3 text-right font-semibold ${row.variance !== null && row.variance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{money(row.variance)}</td></tr>)}</tbody></table></div>
    </Card>

    <Card className="p-4"><h3 className="font-semibold text-gray-900">Time Analysis</h3><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Estimated hours" value={analysis.labour.estimated.hours.toFixed(1)} /><Metric label="Scheduled hours" value={analysis.labour.scheduled.hoursAvailable ? analysis.labour.scheduled.hours.toFixed(1) : 'Unavailable'} /><Metric label="Actual hours" value={analysis.labour.actual.hours.toFixed(1)} /><Metric label="Actual labour cost" value={money(analysis.labour.actual.cost)} /></div>
      {scope === 'entire-job' ? <div className="mt-5 overflow-x-auto"><p className="mb-2 text-xs font-medium uppercase text-gray-500">By Work Area</p><table className="w-full min-w-[620px] text-sm"><thead className="text-left text-xs text-gray-500"><tr><th className="py-2">Work Area</th><th className="py-2 text-right">Estimated hours</th><th className="py-2 text-right">Actual hours</th><th className="py-2 text-right">Estimated cost</th><th className="py-2 text-right">Actual cost</th></tr></thead><tbody className="divide-y divide-gray-100">{analysis.workAreaBreakdown.map((row) => <tr key={row.workAreaId}><td className="py-2 font-medium">{row.workAreaName}</td><td className="py-2 text-right">{row.estimatedHours.toFixed(1)}</td><td className="py-2 text-right">{row.actualHours.toFixed(1)}</td><td className="py-2 text-right">{money(row.estimatedCost)}</td><td className="py-2 text-right">{money(row.actualCost)}</td></tr>)}</tbody></table></div> : null}
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="text-left text-xs text-gray-500"><tr><th className="py-2">Employee</th><th className="py-2">Labour class</th><th className="py-2 text-right">Hours</th><th className="py-2 text-right">Cost</th></tr></thead><tbody className="divide-y divide-gray-100">{analysis.labour.actualEmployees.map((row) => <tr key={row.employeeId}><td className="py-2 font-medium">{row.employeeName}</td><td className="py-2">{row.labourClassName}</td><td className="py-2 text-right">{row.hours.toFixed(1)}</td><td className="py-2 text-right">{row.costAvailable ? formatCurrency(row.cost) : 'Unavailable'}</td></tr>)}</tbody></table>{!analysis.labour.actualEmployees.length ? <p className="py-5 text-sm text-gray-500">No closed Job Time Entries in this scope.</p> : null}</div>
    </Card>

    <CostSection title="Equipment Usage" addLabel="Record usage" onAdd={() => setEditor({ type: 'equipment' })} records={analysis.equipmentUsage} onEdit={(record) => setEditor({ type: 'equipment', record })} onDelete={remove} />
    <CostSection title="Material Vendor Bills" addLabel="Add vendor bill" onAdd={() => setEditor({ type: 'vendor' })} records={analysis.vendorBills} onEdit={(record) => setEditor({ type: 'vendor', record })} onDelete={remove} />
    <CostSection title="Subcontractor Bills" addLabel="Add subcontractor bill" onAdd={() => setEditor({ type: 'subcontractor' })} records={analysis.subcontractorBills} onEdit={(record) => setEditor({ type: 'subcontractor', record })} onDelete={remove} />
    <CostEditor job={job} editor={editor} references={references} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); }} />
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) { return <div><dt className="text-xs font-medium text-gray-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{value}</dd>{note ? <span className="text-xs text-gray-500">{note}</span> : null}</div>; }

function CostSection({ title, addLabel, records, onAdd, onEdit, onDelete }: { title: string; addLabel: string; records: Array<JobEquipmentUsage | JobCostBill>; onAdd: () => void; onEdit: (record: JobEquipmentUsage | JobCostBill) => void; onDelete: (record: JobEquipmentUsage | JobCostBill) => void }) {
  return <Card className="overflow-hidden"><div className="flex items-center justify-between gap-3 p-4"><h3 className="font-semibold text-gray-900">{title}</h3><Button size="sm" onClick={onAdd}><Plus size={15} /> {addLabel}</Button></div>{records.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-gray-100">{records.map((record) => { const equipment = record.recordType === 'equipment'; const party = !equipment ? record.vendorNameSnapshot ?? record.subcontractorNameSnapshot : ''; return <tr key={record.id}><td className="px-4 py-3">{formatDate(equipment ? record.date : record.invoiceDate)}</td><td className="px-4 py-3 font-medium">{equipment ? record.equipmentNameSnapshot : `${party || 'Supplier'}${record.invoiceNumber ? ` · ${record.invoiceNumber}` : ''}`}</td><td className="px-4 py-3 text-gray-600">{equipment ? `${record.quantity} ${record.unit}` : record.description || `${record.lineItems.length} line item${record.lineItems.length === 1 ? '' : 's'}`}</td><td className="px-4 py-3 text-right font-semibold">{formatCurrency(equipment ? record.cost : record.total)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{!equipment && record.attachmentFileId ? <button title="Download invoice" className="p-2 text-gray-500" onClick={() => void resolveAttachmentUrl({ fileId: record.attachmentFileId }).then((url) => url && window.open(url, '_blank', 'noopener,noreferrer'))}><Download size={15} /></button> : null}<button title="Edit" className="p-2 text-gray-500" onClick={() => onEdit(record)}><Pencil size={15} /></button><button title="Delete" className="p-2 text-red-600" onClick={() => onDelete(record)}><Trash2 size={15} /></button></div></td></tr>; })}</tbody></table></div> : <EmptyState title={`No ${title.toLowerCase()} recorded`} description="Actual totals update after a record is saved." />}</Card>;
}

function CostEditor({ job, editor, references, onClose, onSaved }: { job: Job; editor: Editor | null; references: JobAnalysisReferences; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = editor?.record;
  const existingBill = existing && existing.recordType !== 'equipment' ? existing : undefined;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<BillLineDraft[]>([blankLine()]);
  const [attachment, setAttachment] = useState<File | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (existing?.recordType === 'equipment') setForm({ equipmentId: existing.equipmentId, date: existing.date, quantity: String(existing.quantity), unit: existing.unit, workAreaId: existing.workAreaId ?? '', notes: existing.notes ?? '' });
    else setForm({ vendorId: existingBill?.vendorId ?? '', subcontractorId: existingBill?.subcontractorId ?? '', invoiceNumber: existingBill?.invoiceNumber ?? '', invoiceDate: existingBill?.invoiceDate ?? new Date().toISOString().slice(0, 10), dueDate: existingBill?.dueDate ?? '', description: existingBill?.description ?? '', notes: existingBill?.notes ?? '', taxRate: String(existingBill?.taxRate ?? 0), newVendorName: '' });
    setLines(existingBill?.lineItems.map((line) => ({ ...line, workAreaId: line.workAreaId ?? '' })) ?? [blankLine()]); setAttachment(null);
  }, [editor, existing, existingBill]);
  if (!editor) return null;
  const field = (name: string) => ({ value: form[name] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [name]: event.target.value })) });
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
  return <Modal open onClose={onClose} title={existing ? 'Edit actual cost' : 'Add actual cost'} size={bill ? 'wide' : 'default'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
    <div className="space-y-4">{editor.type === 'equipment' ? <><Select label="Equipment" required {...field('equipmentId')}><option value="">Select equipment</option>{references.equipment.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatCurrency(item.costRateHourly ?? item.hourlyCost)}/hr</option>)}</Select><div className="grid grid-cols-2 gap-3"><Input label="Usage date" type="date" required {...field('date')} /><Input label="Hours or quantity" type="number" min="0.01" step="0.01" required {...field('quantity')} /></div><Input label="Unit" {...field('unit')} /><WorkAreaSelect references={references} value={form.workAreaId} onChange={(value) => setForm((current) => ({ ...current, workAreaId: value }))} /><TextArea label="Notes" {...field('notes')} /></> : <>
      <div className="grid gap-3 sm:grid-cols-2">{editor.type === 'vendor' ? <><Select label="Vendor" {...field('vendorId')}><option value="">Select vendor</option>{references.vendors.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Input label="Or create vendor" placeholder="Vendor name" {...field('newVendorName')} /></> : <Select label="Subcontractor" required {...field('subcontractorId')}><option value="">Select subcontractor</option>{references.subcontractors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}<Input label="Invoice number" {...field('invoiceNumber')} /><Input label="Invoice date" type="date" required {...field('invoiceDate')} /><Input label="Due date" type="date" {...field('dueDate')} /><Input label="Tax rate (%)" type="number" min="0" max="100" step="0.01" {...field('taxRate')} /></div>
      <div><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-gray-700">Line items</p><Button type="button" size="sm" variant="secondary" onClick={() => setLines((current) => [...current, blankLine()])}><Plus size={14} /> Add line</Button></div><div className="space-y-3">{lines.map((line, index) => <div key={line.id ?? index} className="grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-12"><Input className="sm:col-span-4" aria-label="Description" placeholder="Description" value={line.description} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><Input className="sm:col-span-2" aria-label="Quantity" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} /><Input className="sm:col-span-2" aria-label="Unit cost" type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unitCost: Number(event.target.value) } : item))} /><Select className="sm:col-span-3" aria-label="Work Area" value={line.workAreaId} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, workAreaId: event.target.value } : item))}><option value="">Unallocated</option>{references.workAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</Select><button type="button" title="Remove line" className="p-2 text-red-600" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button></div>)}</div></div>
      <TextArea label="Notes" {...field('notes')} />
      {existingBill ? <Input label="Invoice attachment" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /> : <p className="text-xs text-gray-500">Save the bill, then edit it to attach the vendor invoice.</p>}
    </>}</div>
  </Modal>;
}

function WorkAreaSelect({ references, value, onChange }: { references: JobAnalysisReferences; value: string; onChange: (value: string) => void }) { return <Select label="Work Area" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Unallocated</option>{references.workAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</Select>; }