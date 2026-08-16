import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Archive, BarChart3, Building2, Pencil, Plus, RotateCcw, Wallet } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import type { Budget, BudgetDivision, BudgetStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils';

 type BudgetTab = 'info' | 'divisions' | 'company-overhead' | 'analysis';
 type BudgetForm = Pick<Budget, 'name' | 'fiscalYear' | 'description' | 'startDate' | 'endDate' | 'status'>;

const statusClass: Record<BudgetStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-brand-100 text-brand-700',
  archived: 'bg-accent-50 text-accent-700',
};

const loadForm = (budget: Budget): BudgetForm => ({
  name: budget.name,
  fiscalYear: budget.fiscalYear,
  description: budget.description ?? '',
  startDate: budget.startDate ?? `${budget.fiscalYear}-01-01`,
  endDate: budget.endDate ?? `${budget.fiscalYear}-12-31`,
  status: budget.status,
});

const serialize = (form: BudgetForm) => JSON.stringify(form);

interface Props { currentUserRole: string; }

export default function BudgetWorkspacePage({ currentUserRole }: Props) {
  const { budgetId } = useParams<{ budgetId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { budgets, budgetDivisions, updateBudget, addBudgetDivision, updateBudgetDivision } = useStore();
  const budget = budgets.find((item) => item.id === budgetId);
  const divisions = useMemo(() => budgetDivisions.filter((item) => item.budgetId === budgetId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [budgetDivisions, budgetId]);
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin';
  const activeTab = (searchParams.get('tab') ?? 'info') as BudgetTab;
  const [form, setForm] = useState<BudgetForm | null>(budget ? loadForm(budget) : null);
  const baseline = useRef<BudgetForm | null>(budget ? loadForm(budget) : null);
  const hydratedId = useRef(budgetId);
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [divisionModal, setDivisionModal] = useState<BudgetDivision | 'new' | null>(null);
  const [divisionForm, setDivisionForm] = useState({ name: '', revenueTarget: '', description: '' });
  const [divisionError, setDivisionError] = useState('');
  const [savingDivision, setSavingDivision] = useState(false);

  useEffect(() => {
    if (!budget) { baseline.current = null; setForm(null); return; }
    const next = loadForm(budget);
    setForm((current) => {
      const changedRecord = hydratedId.current !== budgetId;
      const dirty = Boolean(current && baseline.current && serialize(current) !== serialize(baseline.current));
      if (!changedRecord && dirty) return current;
      hydratedId.current = budgetId;
      baseline.current = next;
      return next;
    });
  }, [budget, budgetId]);

  const validate = (value: BudgetForm) => {
    if (!value.name.trim()) return 'Budget title is required.';
    if (!/^\d{4}$/.test(value.fiscalYear)) return 'Budget year must use four digits.';
    if (!value.startDate || !value.endDate || value.endDate < value.startDate) return 'Enter a valid Budget date range.';
    return null;
  };

  const saveIfDirty = async (force = false) => {
    if (!budget || !form || saveInFlight.current) return false;
    if (!force && baseline.current && serialize(form) === serialize(baseline.current)) return true;
    const error = validate(form);
    if (error) return false;
    saveInFlight.current = true;
    setSaving(true);
    try {
      const saved = await updateBudget(budget.id, { ...form, name: form.name.trim(), description: form.description?.trim() ?? '' });
      if (!saved) return false;
      const next = loadForm(saved);
      baseline.current = next;
      setForm(next);
      return true;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const setTab = async (tab: BudgetTab) => {
    if (tab === activeTab || saveInFlight.current) return;
    if (!(await saveIfDirty())) return;
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('tab', tab); return next; });
  };

  const openDivision = (division?: BudgetDivision) => {
    setDivisionModal(division ?? 'new');
    setDivisionForm({ name: division?.name ?? '', revenueTarget: division ? String(division.revenueTarget) : '', description: division?.description ?? '' });
    setDivisionError('');
  };

  const saveDivision = async () => {
    if (!budget || savingDivision) return;
    const name = divisionForm.name.trim();
    const revenueTarget = Number(divisionForm.revenueTarget || 0);
    if (!name) return setDivisionError('Division name is required.');
    if (!Number.isFinite(revenueTarget) || revenueTarget < 0) return setDivisionError('Revenue target must be zero or greater.');
    setSavingDivision(true);
    const data = { budgetId: budget.id, name, description: divisionForm.description.trim(), revenueTarget };
    const saved = divisionModal === 'new'
      ? await addBudgetDivision({ ...data, status: 'active', sortOrder: divisions.length })
      : divisionModal
        ? await updateBudgetDivision(budget.id, divisionModal.id, data)
        : null;
    setSavingDivision(false);
    if (saved) setDivisionModal(null);
  };

  if (!budget || !form) {
    return <Card><EmptyState title="Budget not found" description="This Budget may have been removed or is still syncing." action={<Button onClick={() => navigate('/budgets')}>Back to Budgets</Button>} /></Card>;
  }

  const activeDivisions = divisions.filter((item) => item.status === 'active');
  const archivedDivisions = divisions.filter((item) => item.status === 'archived');
  const totalRevenueTarget = activeDivisions.reduce((sum, item) => sum + item.revenueTarget, 0);
  const tabs: Array<{ key: BudgetTab; label: string }> = [
    { key: 'info', label: 'Info' }, { key: 'divisions', label: 'Divisions' }, { key: 'company-overhead', label: 'Company Overhead' }, { key: 'analysis', label: 'Analysis' },
  ];
  const dateRange = `${formatDate(form.startDate ?? '')} – ${formatDate(form.endDate ?? '')}`;

  return (
    <div>
      <PageHeader title={form.name} subtitle={dateRange} action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => navigate('/budgets')}><ArrowLeft size={15} /> Back</Button>{canEdit ? <Button onClick={() => void saveIfDirty(true)} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button> : null}</div>} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><Badge label={form.status} className={statusClass[form.status]} /><span className="text-xs text-gray-500">{form.fiscalYear}</span>{!budget.planningModel ? <Link to={`/budgets/${budget.id}/legacy`} className="text-xs font-semibold text-brand-700 hover:underline">Open Legacy Planning</Link> : null}</div>
      <div className="mb-6 overflow-x-auto"><div className="inline-flex min-w-max rounded-xl border border-brand-100 bg-white p-1 dark:border-brand-600 dark:bg-brand-700" role="tablist">{tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => void setTab(tab.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${activeTab === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-800'}`}>{tab.label}</button>)}</div></div>

      {activeTab === 'info' ? <Card className="space-y-4 p-4"><div className="grid gap-3 sm:grid-cols-2"><Input label="Budget Title" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><Input label="Budget Year" required value={form.fiscalYear} onChange={(event) => setForm({ ...form, fiscalYear: event.target.value })} /></div><TextArea label="Description" value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /><div className="grid gap-3 sm:grid-cols-2"><Input label="Start Date" type="date" value={form.startDate ?? ''} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /><Input label="End Date" type="date" value={form.endDate ?? ''} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></div><Select label="Status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as BudgetStatus })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></Select></Card> : null}

      {activeTab === 'divisions' ? <div className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Divisions</h2><p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Manage the operating divisions within this Budget.</p></div>{canEdit ? <Button onClick={() => openDivision()}><Plus size={16} /> Add Division</Button> : null}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Summary label="Total Divisions" value={String(activeDivisions.length)} /><Summary label="Total Revenue Target" value={formatCurrency(totalRevenueTarget)} /><Summary label="Total Direct Cost" value="—" sub="Not calculated yet" /><Summary label="Budget Gross Margin" value="—" sub="Not calculated yet" /></div>{divisions.length === 0 ? <Card><EmptyState icon={<Building2 />} title="No divisions yet" description="Add the operating areas you want to plan within this Budget. Examples might include Snow Removal, Landscaping, Excavation, or Maintenance." action={canEdit ? <Button onClick={() => openDivision()}><Plus size={16} /> Add Division</Button> : undefined} /></Card> : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-brand-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800 dark:text-brand-300"><tr><th className="px-4 py-3">Division</th><th className="px-4 py-3">Revenue Target</th><th className="px-4 py-3">Direct Cost</th><th className="px-4 py-3">Gross Profit</th><th className="px-4 py-3">Margin</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-brand-100 dark:divide-brand-600">{[...activeDivisions, ...archivedDivisions].map((division) => <tr key={division.id} className="cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-800" onClick={() => navigate(`/budgets/${budget.id}/divisions/${division.id}`)}><td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-brand-50">{division.name}</p>{division.description ? <p className="mt-1 text-xs text-gray-500">{division.description}</p> : null}</td><td className="px-4 py-3">{formatCurrency(division.revenueTarget)}</td><td className="px-4 py-3 text-gray-400">—</td><td className="px-4 py-3 text-gray-400">—</td><td className="px-4 py-3 text-gray-400">—</td><td className="px-4 py-3"><Badge label={division.status} className={division.status === 'active' ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'} /></td><td className="px-4 py-3"><div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>{canEdit ? <><Button variant="ghost" size="sm" onClick={() => openDivision(division)} aria-label={`Edit ${division.name}`}><Pencil size={14} /></Button><Button variant="ghost" size="sm" onClick={() => void updateBudgetDivision(budget.id, division.id, { status: division.status === 'active' ? 'archived' : 'active' })} aria-label={`${division.status === 'active' ? 'Archive' : 'Restore'} ${division.name}`}>{division.status === 'active' ? <Archive size={14} /> : <RotateCcw size={14} />}</Button></> : null}</div></td></tr>)}</tbody></table></div></Card>}</div> : null}

      {activeTab === 'company-overhead' ? <Card><EmptyState icon={<Wallet />} title="Company Overhead is moving here" description="Shared operating expenses remain available in Legacy Planning during this transition. No existing overhead data has been moved or recalculated." action={!budget.planningModel ? <Button onClick={() => navigate(`/budgets/${budget.id}/legacy`)}>Open Legacy Planning</Button> : undefined} /></Card> : null}

      {activeTab === 'analysis' ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Summary label="Total Divisions" value={String(activeDivisions.length)} /><Summary label="Revenue Target" value={formatCurrency(totalRevenueTarget)} /><Summary label="Direct Costs" value="—" sub="Not calculated yet" /><Summary label="Operating Profit" value="—" sub="Not calculated yet" /></div><Card className="overflow-hidden"><div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Division Performance</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-brand-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800"><tr><th className="px-4 py-3">Division</th><th className="px-4 py-3">Revenue Target</th><th className="px-4 py-3">Direct Cost</th><th className="px-4 py-3">Gross Profit</th><th className="px-4 py-3">Margin</th><th className="px-4 py-3">Overhead Allocation</th><th className="px-4 py-3">Net Contribution</th></tr></thead><tbody>{activeDivisions.map((division) => <tr key={division.id} className="border-t border-brand-100 dark:border-brand-600"><td className="px-4 py-3 font-medium">{division.name}</td><td className="px-4 py-3">{formatCurrency(division.revenueTarget)}</td>{Array.from({ length: 5 }, (_, index) => <td key={index} className="px-4 py-3 text-gray-400">—</td>)}</tr>)}</tbody></table></div>{activeDivisions.length === 0 ? <EmptyState icon={<BarChart3 />} title="No Division performance yet" description="Add Divisions and revenue targets to begin building this analysis." /> : null}</Card></div> : null}

      <Modal open={divisionModal !== null} onClose={() => { if (!savingDivision) setDivisionModal(null); }} title={divisionModal === 'new' ? 'Add Division' : 'Edit Division'} footer={<><Button variant="secondary" onClick={() => setDivisionModal(null)} disabled={savingDivision}>Cancel</Button><Button onClick={() => void saveDivision()} disabled={savingDivision}>{savingDivision ? 'Saving...' : 'Save Division'}</Button></>}><div className="space-y-4"><Input label="Division Name" required value={divisionForm.name} onChange={(event) => setDivisionForm({ ...divisionForm, name: event.target.value })} placeholder="Snow Removal" /><Input label="Revenue Target" inputMode="decimal" value={divisionForm.revenueTarget} onChange={(event) => setDivisionForm({ ...divisionForm, revenueTarget: event.target.value })} placeholder="500000" /><TextArea label="Description" value={divisionForm.description} onChange={(event) => setDivisionForm({ ...divisionForm, description: event.target.value })} />{divisionError ? <p className="text-sm text-red-600">{divisionError}</p> : null}</div></Modal>
    </div>
  );
}

function Summary({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card className="p-4"><p className="text-xs font-medium uppercase text-gray-500 dark:text-brand-300">{label}</p><p className="mt-2 text-xl font-semibold text-gray-900 dark:text-brand-50">{value}</p>{sub ? <p className="mt-1 text-xs text-gray-400">{sub}</p> : null}</Card>;
}
