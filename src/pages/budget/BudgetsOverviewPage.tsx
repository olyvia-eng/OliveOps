import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Ellipsis, Plus, Trash2, Wallet } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import type { Budget, BudgetStatus } from '../../types';

const currentYear = new Date().getFullYear();

const emptyForm = () => ({
  name: '',
  fiscalYear: String(currentYear + 1),
  description: '',
  startDate: `${currentYear + 1}-01-01`,
  endDate: `${currentYear + 1}-12-31`,
});

const statusClass: Record<BudgetStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-brand-100 text-brand-700',
  archived: 'bg-accent-50 text-accent-700',
};

interface Props {
  currentUserRole: string;
}

export default function BudgetsOverviewPage({ currentUserRole }: Props) {
  const navigate = useNavigate();
  const { budgets, addBudget, deleteBudget } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [budgetToDelete, setBudgetToDelete] = useState<Budget | null>(null);
  const [deleteError, setDeleteError] = useState<{ code?: string; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin';
  const visibleBudgets = budgets.filter((budget) => budget.planningModel === 'divisions_v1');

  const openCreate = () => {
    setForm(emptyForm());
    setError('');
    setModalOpen(true);
  };

  const setYear = (fiscalYear: string) => {
    setForm((current) => ({
      ...current,
      fiscalYear,
      startDate: /^\d{4}$/.test(fiscalYear) ? `${fiscalYear}-01-01` : current.startDate,
      endDate: /^\d{4}$/.test(fiscalYear) ? `${fiscalYear}-12-31` : current.endDate,
    }));
  };

  const createBudget = async () => {
    if (creating) return;
    const name = form.name.trim();
    if (!name) return setError('Budget title is required.');
    if (!/^\d{4}$/.test(form.fiscalYear)) return setError('Budget year must use four digits.');
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) return setError('Enter a valid date range.');

    setCreating(true);
    const created = await addBudget({
      name,
      budgetType: 'operating',
      division: 'company_wide',
      fiscalYear: form.fiscalYear,
      description: form.description.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      planningModel: 'divisions_v1',
      status: 'draft',
    });
    setCreating(false);
    if (!created) return;
    setModalOpen(false);
    navigate(`/budgets/${created.id}?tab=info`);
  };

  const openDeleteConfirmation = (budget: Budget) => {
    setOpenMenuId(null);
    setDeleteError(null);
    setBudgetToDelete(budget);
  };

  const confirmDelete = async () => {
    if (!budgetToDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteBudget(budgetToDelete.id);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError({ code: result.code, message: result.error ?? 'Budget could not be deleted.' });
      return;
    }
    setBudgetToDelete(null);
  };

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Plan the year once, then organize revenue and costs by operating division."
        action={canEdit ? <Button onClick={openCreate}><Plus size={16} /> New Budget</Button> : undefined}
      />

      {visibleBudgets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet />}
            title="No budgets yet"
            description="Create an annual budget, then add the operating divisions you want to plan."
            action={canEdit ? <Button onClick={openCreate}><Plus size={16} /> New Budget</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="divide-y divide-brand-100 border-y border-brand-100 bg-white dark:divide-brand-600 dark:border-brand-600 dark:bg-brand-700">
          {visibleBudgets.slice().sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear) || a.name.localeCompare(b.name)).map((budget) => (
            <div key={budget.id} className="flex items-stretch hover:bg-brand-50 dark:hover:bg-brand-800">
              <button type="button" onClick={() => navigate(`/budgets/${budget.id}?tab=info`)} className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-4 text-left hover:bg-brand-50 dark:hover:bg-brand-800">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-brand-50">{budget.name}</span>
                    <Badge label={budget.status} className={statusClass[budget.status]} />
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">{budget.fiscalYear}{budget.description ? ` · ${budget.description}` : ''}</p>
                </div>
                <ArrowRight size={18} className="shrink-0 text-brand-500" />
              </button>
              {canEdit ? <div className="relative flex items-center pr-3"><Button variant="ghost" size="sm" aria-label={`More actions for ${budget.name}`} aria-expanded={openMenuId === budget.id} onClick={() => setOpenMenuId((current) => current === budget.id ? null : budget.id)}><Ellipsis size={17} /></Button>{openMenuId === budget.id ? <div className="absolute right-3 top-[calc(50%+20px)] z-20 min-w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-brand-600 dark:bg-brand-700"><button type="button" onClick={() => openDeleteConfirmation(budget)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-accent-700 hover:bg-accent-50 dark:hover:bg-brand-600"><Trash2 size={14} /> Delete Budget</button></div> : null}</div> : null}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { if (!creating) setModalOpen(false); }}
        title="Create New Budget"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={creating}>Cancel</Button><Button onClick={() => void createBudget()} disabled={creating}>{creating ? 'Creating...' : 'Create Budget'}</Button></>}
      >
        <div className="space-y-4">
          <Input label="Budget Title" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="2027 Annual Budget" />
          <Input label="Budget Year" required inputMode="numeric" value={form.fiscalYear} onChange={(event) => setYear(event.target.value)} />
          <TextArea label="Description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Company-wide operating budget for the year." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Start Date" type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
            <Input label="End Date" type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={budgetToDelete !== null}
        onClose={() => { if (!deleting) { setBudgetToDelete(null); setDeleteError(null); } }}
        title={`Delete ${budgetToDelete?.name ?? 'Budget'}?`}
        footer={<><Button variant="secondary" onClick={() => { setBudgetToDelete(null); setDeleteError(null); }} disabled={deleting}>Cancel</Button><Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete Budget'}</Button></>}
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-brand-200">This will permanently delete this Budget and its Budget-specific planning data. This action cannot be undone.</p>
          {deleteError ? <div className="rounded-lg border border-accent-200 bg-accent-50 p-3 text-sm text-accent-800"><p className="font-semibold">{deleteError.code === 'BUDGET_IN_USE' ? 'This Budget is currently in use' : 'Budget could not be deleted'}</p><p className="mt-1">{deleteError.message}</p></div> : null}
        </div>
      </Modal>
    </div>
  );
}
