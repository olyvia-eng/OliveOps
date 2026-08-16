import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FolderArchive, Plus, Wallet } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import type { BudgetStatus } from '../../types';

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
  const { budgets, budgetGroups, addBudget } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin';

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

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Plan the year once, then organize revenue and costs by operating division."
        action={canEdit ? <Button onClick={openCreate}><Plus size={16} /> New Budget</Button> : undefined}
      />

      {budgets.length === 0 ? (
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
          {budgets.slice().sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear) || a.name.localeCompare(b.name)).map((budget) => (
            <button
              key={budget.id}
              type="button"
              onClick={() => navigate(`/budgets/${budget.id}?tab=info`)}
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left hover:bg-brand-50 dark:hover:bg-brand-800"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-900 dark:text-brand-50">{budget.name}</span>
                  <Badge label={budget.status} className={statusClass[budget.status]} />
                  {!budget.planningModel ? <Badge label="Legacy planning" className="bg-amber-50 text-amber-800" /> : null}
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">{budget.fiscalYear}{budget.description ? ` · ${budget.description}` : ''}</p>
              </div>
              <ArrowRight size={18} className="shrink-0 text-brand-500" />
            </button>
          ))}
        </div>
      )}

      {budgetGroups.length > 0 ? (
        <section className="mt-8" aria-labelledby="legacy-rollups-title">
          <div className="mb-3">
            <h2 id="legacy-rollups-title" className="text-sm font-semibold text-gray-900 dark:text-brand-50">Legacy budget roll-ups</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-brand-300">Existing grouped budgets remain available for read-only compatibility.</p>
          </div>
          <div className="divide-y divide-brand-100 border-y border-brand-100 bg-white dark:divide-brand-600 dark:border-brand-600 dark:bg-brand-700">
            {budgetGroups.map((group) => (
              <Link key={group.id} to={`/budgets/groups/${group.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-brand-50 dark:hover:bg-brand-800">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-brand-100"><FolderArchive size={16} /> {group.name}</span>
                <span className="text-xs text-gray-500 dark:text-brand-300">{group.year} · {group.budgetIds.length} budgets</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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
    </div>
  );
}
