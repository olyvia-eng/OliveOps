import { useMemo, useState } from 'react';
import { Pencil, PlusCircle, Search, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import { closeDetailWorkspace, openDetailWorkspace, readDetailWorkspaceQuery } from '../../components/detail-workspace/detailWorkspaceQuery';
import { Button, Card, EmptyState, Input, Modal, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import type { SubcontractorCatalogItem } from '../../types';
import { formatCurrency } from '../../utils';

const WORKSPACE_QUERY = { recordParam: 'subcontractor', tabParam: 'subcontractorTab', defaultTab: 'overview' } as const;
type FormValue = Pick<SubcontractorCatalogItem, 'name' | 'contactName' | 'email' | 'phone' | 'trade' | 'unit' | 'defaultUnitCost' | 'notes'>;
const emptyForm = (): FormValue => ({ name: '', contactName: '', email: '', phone: '', trade: '', unit: 'job', defaultUnitCost: 0, notes: '' });

export default function SubcontractorsCatalogSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const items = useStore((state) => state.subcontractorCatalogItems);
  const planningItems = useStore((state) => state.budgetDivisionPlanningItems);
  const budgets = useStore((state) => state.budgets);
  const divisions = useStore((state) => state.budgetDivisions);
  const addItem = useStore((state) => state.addSubcontractorCatalogItem);
  const updateItem = useStore((state) => state.updateSubcontractorCatalogItem);
  const deleteItem = useStore((state) => state.deleteSubcontractorCatalogItem);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormValue>(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const workspace = readDetailWorkspaceQuery(searchParams, WORKSPACE_QUERY);
  const selected = items.find((item) => item.id === workspace.recordId) ?? null;

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...items].sort((a, b) => a.name.localeCompare(b.name)).filter((item) => !normalized || [item.name, item.trade, item.contactName, item.email, item.phone].some((value) => value?.toLowerCase().includes(normalized)));
  }, [items, query]);
  const usage = selected ? planningItems.filter((item) => item.category === 'subcontractors' && (item.subcontractorCatalogItemId ?? item.vendorId) === selected.id) : [];

  const openAdd = () => { setEditingId(null); setForm(emptyForm()); setError(''); setModalOpen(true); };
  const openEdit = (item: SubcontractorCatalogItem) => {
    setEditingId(item.id);
    setForm({ name: item.name, contactName: item.contactName ?? '', email: item.email ?? '', phone: item.phone ?? '', trade: item.trade ?? '', unit: item.unit, defaultUnitCost: item.defaultUnitCost, notes: item.notes });
    setError('');
    setModalOpen(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.unit.trim() || !Number.isFinite(form.defaultUnitCost) || form.defaultUnitCost < 0) {
      setError('Enter a company name, unit, and default cost of zero or greater.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = { ...form, name: form.name.trim(), contactName: form.contactName?.trim(), email: form.email?.trim(), phone: form.phone?.trim(), trade: form.trade?.trim(), unit: form.unit.trim(), notes: form.notes.trim() };
    try {
      if (editingId) await updateItem(editingId, payload);
      else await addItem(payload);
      setModalOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save subcontractor.');
    } finally { setSaving(false); }
  };

  return <>
    <DetailWorkspace
      open={Boolean(selected)}
      detailKey={selected?.id}
      expanded={workspace.mode === 'expanded'}
      list={<Card className="overflow-hidden">
        <div className="border-b border-brand-100 p-4 dark:border-brand-600 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Subcontractors Catalog</h2><p className="text-sm text-gray-500">{items.length} subcontractor{items.length === 1 ? '' : 's'}</p></div><Button onClick={openAdd}><PlusCircle size={16} />Add Subcontractor</Button></div>
          <div className="relative mt-4 max-w-xl"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, trade, or contact..." /></div>
        </div>
        {visibleItems.length === 0 ? <div className="p-5"><EmptyState title={items.length ? 'No subcontractors match this search' : 'No subcontractors yet'} description={items.length ? 'Try a different search.' : 'Add reusable subcontractor identity and default direct costs.'} /></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-gray-50 text-left text-gray-500"><th className="px-4 py-3">Company</th><th className="px-4 py-3">Trade / Service</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3 text-right">Default Cost</th></tr></thead><tbody className="divide-y">{visibleItems.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSearchParams(openDetailWorkspace(searchParams, WORKSPACE_QUERY, item.id))}><td className="px-4 py-3 font-semibold">{item.name}</td><td className="px-4 py-3 text-gray-600">{item.trade || '—'}</td><td className="px-4 py-3">{item.unit}</td><td className="px-4 py-3 text-right">{formatCurrency(item.defaultUnitCost)}</td></tr>)}</tbody></table></div>}
      </Card>}
      detail={selected ? <div className="min-w-0">
        <div className="flex items-start justify-between border-b p-4"><div><h2 className="font-semibold">{selected.name}</h2><p className="text-sm text-gray-500">{selected.trade || 'Subcontractor resource'}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => openEdit(selected)}><Pencil size={14} />Edit</Button><button aria-label="Close" onClick={() => setSearchParams(closeDetailWorkspace(searchParams, WORKSPACE_QUERY))}><X size={18} /></button></div></div>
        <div className="space-y-5 p-4"><dl className="grid grid-cols-[1fr_auto] gap-3 text-sm"><dt className="text-gray-500">Default Cost</dt><dd className="font-semibold">{formatCurrency(selected.defaultUnitCost)} / {selected.unit}</dd><dt className="text-gray-500">Contact</dt><dd>{selected.contactName || '—'}</dd><dt className="text-gray-500">Email</dt><dd>{selected.email || '—'}</dd><dt className="text-gray-500">Phone</dt><dd>{selected.phone || '—'}</dd></dl>{selected.notes ? <p className="whitespace-pre-wrap text-sm text-gray-600">{selected.notes}</p> : null}<div><h3 className="text-sm font-semibold">Budget / Division Usage</h3>{usage.length ? <div className="mt-2 space-y-2">{usage.map((record) => <div key={record.id} className="border-t pt-2 text-sm"><p className="font-medium">{budgets.find((budget) => budget.id === record.budgetId)?.name ?? 'Unavailable Budget'} / {divisions.find((division) => division.id === record.divisionId)?.name ?? 'Unavailable Division'}</p><p className="text-gray-500">{formatCurrency(record.rate ?? 0)} / {record.unit || 'unit'}</p></div>)}</div> : <p className="mt-2 text-sm text-gray-500">Not used in a Budget yet.</p>}</div><Button variant="danger" size="sm" onClick={() => { if (window.confirm(`Delete ${selected.name} from the Catalog? Existing Budget and Estimate snapshots will remain unchanged.`)) { deleteItem(selected.id); setSearchParams(closeDetailWorkspace(searchParams, WORKSPACE_QUERY)); } }}><Trash2 size={14} />Delete</Button></div>
      </div> : null}
    />
    <Modal open={modalOpen} onClose={() => !saving && setModalOpen(false)} title={editingId ? 'Edit Subcontractor' : 'Add Subcontractor'} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={() => (document.getElementById('subcontractor-form') as HTMLFormElement | null)?.requestSubmit()} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></>}>
      <form id="subcontractor-form" onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Input label="Company Name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><Input label="Trade / Service" value={form.trade} onChange={(event) => setForm({ ...form, trade: event.target.value })} /><Input label="Contact Name" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /><Input label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><Input label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><Input label="Unit" required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /><Input label="Default Cost" type="number" min={0} step={0.01} value={form.defaultUnitCost} onChange={(event) => setForm({ ...form, defaultUnitCost: Number(event.target.value || 0) })} /><div className="sm:col-span-2"><TextArea label="Notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>{error ? <p className="sm:col-span-2 text-sm text-accent-700">{error}</p> : null}</form>
    </Modal>
  </>;
}