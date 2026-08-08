import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select } from '../../components/ui';
import { Layers3, Plus, Trash2, Wallet } from 'lucide-react';
import { useStore } from '../../store';
import type { BudgetStatus } from '../../types';

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
  const [selectedBudgetIds, setSelectedBudgetIds] = useState<string[]>([]);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

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

  const visibleBudgetIds = useMemo(() => budgetRows.map(({ budget }) => budget.id), [budgetRows]);

  useEffect(() => {
    setSelectedBudgetIds((current) => current.filter((id) => visibleBudgetIds.includes(id)));
  }, [visibleBudgetIds]);

  const allVisibleSelected = visibleBudgetIds.length > 0 && visibleBudgetIds.every((id) => selectedBudgetIds.includes(id));
  const someVisibleSelected = visibleBudgetIds.some((id) => selectedBudgetIds.includes(id));

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [allVisibleSelected, someVisibleSelected]);

  const selectedBudgets = useMemo(() => {
    return budgetRows
      .filter(({ budget }) => selectedBudgetIds.includes(budget.id))
      .map(({ budget }) => budget);
  }, [budgetRows, selectedBudgetIds]);

  const uniqueSelectedFiscalYears = [...new Set(selectedBudgets.map((budget) => budget.fiscalYear))];
  const hasMixedFiscalYears = uniqueSelectedFiscalYears.length > 1;
  const canViewCombined = selectedBudgets.length >= 2 && !hasMixedFiscalYears;

  const toggleBudgetSelection = (budgetId: string) => {
    setSelectedBudgetIds((current) => current.includes(budgetId)
      ? current.filter((id) => id !== budgetId)
      : [...current, budgetId]);
  };

  const toggleSelectAllVisible = () => {
    setSelectedBudgetIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !visibleBudgetIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleBudgetIds]));
    });
  };

  const openCombinedBudget = () => {
    if (!canViewCombined) return;
    navigate(`/budgets/combined?ids=${selectedBudgets.map((budget) => budget.id).join(',')}`);
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

    if (!form.division.trim()) {
      setFormError('Division is required.');
      return;
    }

    const created = await addBudget({
      name: form.name.trim(),
      budgetType: 'operating',
      division: form.division.trim(),
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
        subtitle="Choose an individual budget to edit or select multiple budgets for a read-only combined view."
        action={<Button onClick={openNew}><Plus size={16} /> New Budget</Button>}
      />

      {selectedBudgetIds.length > 0 ? (
        <Card className="p-4 mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedBudgetIds.length} budget{selectedBudgetIds.length === 1 ? '' : 's'} selected</p>
              <p className="text-xs text-gray-500 mt-1">
                {hasMixedFiscalYears
                  ? 'Combined budgets must use the same fiscal year.'
                  : selectedBudgetIds.length < 2
                    ? 'Select at least two budgets to open a Combined Budget view.'
                    : 'Open a read-only combined view without changing the underlying budgets.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setSelectedBudgetIds([])}>Clear Selection</Button>
              <Button onClick={openCombinedBudget} disabled={!canViewCombined}><Layers3 size={16} /> View Combined Budget</Button>
            </div>
          </div>
        </Card>
      ) : null}

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
                  <th className="px-4 py-3 font-medium w-12">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      aria-label="Select all visible budgets"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      onClick={(event) => event.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                  </th>
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
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${budget.name}`}
                        checked={selectedBudgetIds.includes(budget.id)}
                        onChange={() => toggleBudgetSelection(budget.id)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{budget.name}</td>
                    <td className="px-4 py-3 text-gray-700">{toFriendlyLabel(budget.division)}</td>
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
          <Input
            label="Division"
            required
            value={form.division}
            onChange={(event) => setField('division', event.target.value)}
            placeholder="e.g. Construction"
          />
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
