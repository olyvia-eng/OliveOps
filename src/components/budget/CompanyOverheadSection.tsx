import { useRef, useState } from 'react';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal } from '../ui';
import { useStore } from '../../store';
import type { Budget, BudgetItem } from '../../types';
import { formatCurrency } from '../../utils';

interface Props {
  budget: Budget;
  items: BudgetItem[];
  total: number;
  canEdit: boolean;
}

type OverheadForm = {
  description: string;
  costCode: string;
  annualAmount: string;
};

const emptyForm = (): OverheadForm => ({ description: '', costCode: '', annualAmount: '' });

export default function CompanyOverheadSection({ budget, items, total, canEdit }: Props) {
  const { addBudgetItem, updateBudgetItem, deleteBudgetItem } = useStore();
  const [editing, setEditing] = useState<BudgetItem | 'new' | null>(null);
  const [form, setForm] = useState<OverheadForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<BudgetItem | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const saveInFlight = useRef(false);
  const deleteInFlight = useRef(false);

  const annualAmount = Number(form.annualAmount);
  const formIsValid = Boolean(form.description.trim()) && form.annualAmount.trim() !== '' && Number.isFinite(annualAmount) && annualAmount > 0;

  const openNew = () => {
    setEditing('new');
    setForm(emptyForm());
    setFormError('');
  };

  const openEdit = (item: BudgetItem) => {
    setEditing(item);
    setForm({ description: item.description, costCode: item.costCode ?? '', annualAmount: String(item.budgeted) });
    setFormError('');
  };

  const save = async () => {
    if (!editing || !formIsValid || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setFormError('');
    const data = {
      description: form.description.trim(),
      costCode: form.costCode.trim(),
      budgeted: annualAmount,
    };
    try {
      const saved = editing === 'new'
        ? await addBudgetItem({
            budgetId: budget.id,
            category: 'overhead',
            ...data,
            actual: 0,
            period: `${budget.fiscalYear}-01`,
          })
        : await updateBudgetItem(editing.id, data);
      if (!saved) {
        setFormError('Company overhead could not be saved. Check your connection and try again.');
        return;
      }
      setEditing(null);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleteInProgress(true);
    setDeleteError('');
    try {
      const deleted = await deleteBudgetItem(deleting.id);
      if (!deleted) {
        setDeleteError('Company overhead could not be deleted. Check your connection and try again.');
        return;
      }
      setDeleting(null);
    } finally {
      deleteInFlight.current = false;
      setDeleteInProgress(false);
    }
  };

  const addAction = canEdit ? <Button onClick={openNew}><Plus size={16} /> Add Company Overhead</Button> : undefined;

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Company Overhead</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Company-wide operating costs that are not specific to one division.</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-brand-400">These costs remain separate from Division Overhead and are included when calculating overall company profitability.</p>
      </div>
      {addAction}
    </div>

    {items.length === 0 ? <Card><EmptyState icon={<Wallet />} title="No company overhead yet" description="Add company-wide operating costs that aren't specific to an individual division." action={addAction} /></Card> : <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-brand-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800 dark:text-brand-300"><tr><th className="px-4 py-3">Overhead Cost</th><th className="px-4 py-3">Cost Code</th><th className="px-4 py-3 text-right">Annual Amount</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-600">{items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.description}</td><td className="px-4 py-3 text-gray-500">{item.costCode || '—'}</td><td className="px-4 py-3 text-right font-medium">{formatCurrency(item.budgeted)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{canEdit ? <><Button variant="ghost" size="sm" onClick={() => openEdit(item)} aria-label={`Edit ${item.description}`} title="Edit"><Pencil size={14} /></Button><Button variant="ghost" size="sm" onClick={() => { setDeleting(item); setDeleteError(''); }} aria-label={`Delete ${item.description}`} title="Delete"><Trash2 size={14} className="text-accent-700" /></Button></> : null}</div></td></tr>)}</tbody>
          <tfoot><tr className="border-t-2 border-brand-200 font-semibold dark:border-brand-500"><td className="px-4 py-3" colSpan={2}>Total Company Overhead</td><td className="px-4 py-3 text-right">{formatCurrency(total)}</td><td /></tr></tfoot>
        </table>
      </div>
    </Card>}

    <Modal open={editing !== null} onClose={() => { if (!saving) setEditing(null); }} title={editing === 'new' ? 'Add Company Overhead' : 'Edit Company Overhead'} footer={<><Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !formIsValid}>{saving ? 'Saving…' : 'Save Company Overhead'}</Button></>}>
      <div className="space-y-4">
        <Input label="Overhead cost" required value={form.description} onChange={(event) => { setForm((current) => ({ ...current, description: event.target.value })); setFormError(''); }} placeholder="Accounting" />
        <Input label="Cost code" value={form.costCode} onChange={(event) => { setForm((current) => ({ ...current, costCode: event.target.value })); setFormError(''); }} placeholder="ADMIN-001" />
        <Input label="Annual amount" required type="number" min={0.01} step={0.01} inputMode="decimal" value={form.annualAmount} onChange={(event) => { setForm((current) => ({ ...current, annualAmount: event.target.value })); setFormError(''); }} placeholder="12000.00" />
        {formError ? <p className="text-sm text-red-600" role="alert">{formError}</p> : null}
      </div>
    </Modal>

    <Modal open={deleting !== null} onClose={() => { if (!deleteInProgress) setDeleting(null); }} title="Delete Company Overhead" footer={<><Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteInProgress}>Cancel</Button><Button variant="danger" onClick={() => void confirmDelete()} disabled={deleteInProgress}>{deleteInProgress ? 'Deleting…' : 'Delete'}</Button></>}>
      <p className="text-gray-600">Delete {deleting?.description ?? 'this company overhead cost'}? This cannot be undone.</p>
      {deleteError ? <p className="mt-3 text-sm text-red-600" role="alert">{deleteError}</p> : null}
    </Modal>
  </div>;
}