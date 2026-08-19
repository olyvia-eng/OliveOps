import { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, Input } from '../ui';
import { useStore } from '../../store';
import type { Budget, BudgetDivisionPlanningItem, BudgetRate } from '../../types';
import { formatCurrency } from '../../utils';
import { buildBudgetPricingRows } from '../../pages/budget/budgetPricingModel.js';

interface Props {
  budget: Budget;
  planningItems: BudgetDivisionPlanningItem[];
  companyOverhead: number;
  canEdit: boolean;
}

export default function BudgetPricingAnalysis({ budget, planningItems, companyOverhead, canEdit }: Props) {
  const { budgetRates, addBudgetRate, updateBudgetRate } = useStore();
  const rows = useMemo(() => buildBudgetPricingRows({ budget, planningItems, budgetRates, companyOverhead }), [budget, budgetRates, companyOverhead, planningItems]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(rows.map((row) => [row.item.id, row.approvedRate > 0 ? row.approvedRate.toFixed(2) : ''])));
  }, [budget.id, budgetRates, rows]);

  const save = (row: typeof rows[number], requested: number) => {
    const approvedRate = Math.max(0, Number.isFinite(requested) ? requested : 0);
    const markup = row.costRate > 0 ? Math.max(0, ((approvedRate / row.costRate) - 1) * 100) : 0;
    const payload: Omit<BudgetRate, 'id' | 'createdAt' | 'updatedAt'> = {
      budgetId: budget.id,
      budgetItemId: row.item.id,
      employeeId: row.item.employeeId,
      equipmentId: row.item.equipmentId,
      materialCatalogItemId: row.item.materialCatalogItemId,
      vendorId: row.item.vendorId,
      category: row.type,
      itemName: row.item.name || row.item.description || 'Pricing item',
      description: row.item.description || '',
      unit: row.unit,
      unitCost: row.costRate,
      overheadRecoveryPerUnit: row.overheadPerUnit,
      targetMarginPercent: budget.targetMarginPct ?? 20,
      recommendedSellPrice: row.recommendedRate,
      defaultMarkupPercent: markup,
      defaultSellPrice: approvedRate,
      active: true,
      sortOrder: row.rate?.sortOrder ?? rows.findIndex((value) => value.item.id === row.item.id),
    };
    if (row.rate) updateBudgetRate(row.rate.id, payload);
    else addBudgetRate(payload);
  };

  if (rows.length === 0) return <Card><EmptyState title="No pricing items yet" description="Add Labour, Equipment, Materials, or Subcontractors to this Budget before approving Estimate pricing." /></Card>;

  return <Card className="overflow-hidden">
    <div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600">
      <h2 className="font-semibold text-gray-900 dark:text-brand-50">Estimate Pricing</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Review Budget-calculated recommendations and approve the customer-facing rates Estimates may use.</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-brand-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Cost / Unit</th><th className="px-4 py-3 text-right">Overhead / Unit</th><th className="px-4 py-3 text-right">Recommended</th><th className="px-4 py-3">Approved Rate</th><th className="px-4 py-3"><span className="sr-only">Action</span></th></tr></thead>
        <tbody className="divide-y divide-brand-100 dark:divide-brand-600">{rows.map((row) => {
          const draft = drafts[row.item.id] ?? '';
          const approved = Number(draft || 0);
          return <tr key={row.item.id} id={`pricing-${row.item.id}`}>
            <td className="px-4 py-3 font-medium">{row.item.name || row.item.description}</td>
            <td className="px-4 py-3 capitalize text-gray-500">{row.type}</td>
            <td className="px-4 py-3 text-right">{row.costRate > 0 ? `${formatCurrency(row.costRate)}/${row.unit}` : 'Unavailable'}</td>
            <td className="px-4 py-3 text-right">{formatCurrency(row.overheadPerUnit)}</td>
            <td className="px-4 py-3 text-right font-semibold">{row.recommendedRate > 0 ? `${formatCurrency(row.recommendedRate)}/${row.unit}` : 'Unavailable'}</td>
            <td className="w-44 px-4 py-3"><Input aria-label={`Approved rate for ${row.item.name || row.item.description}`} type="number" min={0} step={0.01} value={draft} disabled={!canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [row.item.id]: event.target.value }))} placeholder="Not approved" /></td>
            <td className="px-4 py-3 text-right">{canEdit ? <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={row.recommendedRate <= 0} onClick={() => { setDrafts((current) => ({ ...current, [row.item.id]: row.recommendedRate.toFixed(2) })); save(row, row.recommendedRate); }}>Use Recommended</Button><Button size="sm" disabled={approved <= 0} onClick={() => save(row, approved)}>Save Rate</Button></div> : row.pricingStatus === 'approved' ? 'Approved' : 'Not approved'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </Card>;
}
