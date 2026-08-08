import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select } from '../../components/ui';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { useStore } from '../../store';
import type { BudgetStatus } from '../../types';
import { BUDGET_DIVISIONS, normalizeBudgetDivision, toBudgetDivisionLabel } from '../../config/budgetDivisions';

const statuses: Array<{ value: BudgetStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

const statusClass: Record<BudgetStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-brand-100 text-brand-700',
  archived: 'bg-accent-50 text-accent-700',
};

const toFriendlyLabel = (value: string) => value
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const emptyBudgetForm = () => ({
  name: '',
  division: 'company_wide',
  fiscalYear: String(new Date().getFullYear()),
  status: 'draft' as BudgetStatus,
});

export default function BudgetsPage() {
  const navigate = useNavigate();
  const { budgets, budgetItems, addBudget, deleteBudget } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyBudgetForm());
  const [formError, setFormError] = useState('');
  const [budgetToDelete, setBudgetToDelete] = useState<string | null>(null);

  const budgetRows = useMemo(() => {
    const hasScopedBudgetItems = budgetItems.some((item) => Boolean(item.budgetId));
    const legacyOwnerBudgetId = !hasScopedBudgetItems
      ? budgets
          .slice()
          .sort((a, b) => (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt))[0]?.id ?? null
      : null;

    return budgets
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((budget) => {
        const includeUnscoped = !hasScopedBudgetItems && budget.id === legacyOwnerBudgetId;
        const totalBudget = budgetItems
          .filter((item) => item.budgetId === budget.id || (includeUnscoped && !item.budgetId))
          .reduce((sum, item) => sum + item.budgeted, 0);

        return {
          budget,
          totalBudget,
        };
      });
  }, [budgetItems, budgets]);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openNew = () => {
    setForm(emptyBudgetForm());
    setFormError('');
    setModalOpen(true);
  };

  const createNewBudget = async () => {
    setFormError('');

    if (!form.name.trim()) {
      setFormError('Budget name is required.');
      return;
    }

    if (!/^\d{4}$/.test(form.fiscalYear)) {
      setFormError('Fiscal year must be 4 digits (YYYY).');
      return;
    }

    const normalizedDivision = normalizeBudgetDivision(form.division, { allowLegacyAliases: false });
    if (!normalizedDivision) {
      setFormError('Division is required.');
      return;
    }

    const created = await addBudget({
      name: form.name.trim(),
      budgetType: 'operating',
      division: normalizedDivision,
      fiscalYear: form.fiscalYear,
      status: form.status,
    });

    if (!created) {
      return;
    }

    setModalOpen(false);
    navigate(`/budgets/${created.id}`);
  };

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Choose a budget to work inside the existing budget detail workflow."
        action={<Button onClick={openNew}><Plus size={16} /> New Budget</Button>}
      />

      {budgetRows.length === 0 ? (
        <EmptyState
          icon={<Wallet aria-hidden="true" />}
          title="Set up your first budget"
          description="Budgets help organize your financial plan and provide pricing rates for estimates."
          action={<Button onClick={openNew}><Plus size={16} /> Create Budget</Button>}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">Budget Name</th>
                  <th className="px-4 py-3 font-medium">Division</th>
                  <th className="px-4 py-3 font-medium">Fiscal Year</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last Updated</th>
                  <th className="px-4 py-3 font-medium text-right">Total Budget</th>
                  <th className="px-4 py-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {budgetRows.map(({ budget, totalBudget }) => (
                  <tr
                    key={budget.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/budgets/${budget.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{budget.name}</td>
                    <td className="px-4 py-3 text-gray-700">{toBudgetDivisionLabel(budget.division)}</td>
                    <td className="px-4 py-3 text-gray-700">{budget.fiscalYear}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass[budget.status]}`}>
                        {statuses.find((value) => value.value === budget.status)?.label ?? toFriendlyLabel(budget.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(budget.updatedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(totalBudget)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setBudgetToDelete(budget.id);
                        }}
                        aria-label={`Delete ${budget.name}`}
                      >
                        <Trash2 size={14} className="text-accent-700" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Budget"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={createNewBudget}>Create Budget</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Input
            label="Budget Name"
            required
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            placeholder="e.g. 2027 Company Operating Budget"
          />
          <Select
            label="Division"
            required
            value={form.division}
            onChange={(event) => setField('division', event.target.value)}
          >
            {BUDGET_DIVISIONS.map((division) => (
              <option key={division} value={division}>{toBudgetDivisionLabel(division)}</option>
            ))}
          </Select>
          <Input
            label="Fiscal Year"
            required
            inputMode="numeric"
            maxLength={4}
            value={form.fiscalYear}
            onChange={(event) => setField('fiscalYear', event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <Select
            label="Status"
            required
            value={form.status}
            onChange={(event) => setField('status', event.target.value as BudgetStatus)}
          >
            {statuses.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </Select>

          {formError && <p className="text-sm text-accent-700">{formError}</p>}
        </div>
      </Modal>

      <Modal
        open={!!budgetToDelete}
        onClose={() => setBudgetToDelete(null)}
        title="Delete Budget"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setBudgetToDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (budgetToDelete) deleteBudget(budgetToDelete);
                setBudgetToDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        )}
      >
        <p className="text-gray-600">Delete this budget?</p>
      </Modal>
    </div>
  );
}
