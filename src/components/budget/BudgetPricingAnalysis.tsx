import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Input } from '../ui';
import { useStore } from '../../store';
import type { Budget, BudgetDivisionPlanningItem, BudgetRate } from '../../types';
import { formatCurrency } from '../../utils';
import { buildBudgetPricingRows } from '../../pages/budget/budgetPricingModel.js';
import { buildOverheadRecoveryModel } from '../../pages/budget/overheadRecoveryModel.js';

interface Props {
  budget: Budget;
  planningItems: BudgetDivisionPlanningItem[];
  companyOverhead: number;
  canEdit: boolean;
}

type RateSaveState = {
  draft: string;
  persisted: string;
  status: 'idle' | 'saving' | 'failed';
  error?: string;
};

const rateValue = (value: string) => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
};

const ratesMatch = (draft: string, persisted: string) => rateValue(draft) === rateValue(persisted);

const unavailableReason = (category: BudgetDivisionPlanningItem['category']) => {
  if (category === 'labour') return 'Complete labour cost information first.';
  if (category === 'equipment') return 'Complete equipment cost and sellable-hours information first.';
  if (category === 'materials') return 'Complete material cost information first.';
  return 'Complete subcontractor cost information first.';
};

export default function BudgetPricingAnalysis({ budget, planningItems, companyOverhead, canEdit }: Props) {
  const { budgetRates, budgetDivisions, addBudgetRate, updateBudgetRate } = useStore();
  const divisions = useMemo(() => budgetDivisions.filter((division) => division.budgetId === budget.id && division.status === 'active'), [budget.id, budgetDivisions]);
  const rows = useMemo(() => buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates, companyOverhead }), [budget, budgetRates, companyOverhead, divisions, planningItems]);
  const recovery = useMemo(() => buildOverheadRecoveryModel({ budget, divisions, planningItems, companyOverhead }), [budget, companyOverhead, divisions, planningItems]);
  const recoveryWarnings = [...recovery.company.warnings, ...Object.values(recovery.divisions).flatMap((scope) => scope.warnings)];
  const [rateStates, setRateStates] = useState<Record<string, RateSaveState>>({});
  const savesInFlight = useRef(new Set<string>());

  useEffect(() => {
    setRateStates((current) => Object.fromEntries(rows.map((row) => {
      const existing = current[row.key];
      const persisted = row.approvedRate > 0 ? String(row.approvedRate) : '';
      const hasLocalChanges = existing && (!ratesMatch(existing.draft, existing.persisted) || existing.status !== 'idle');
      return [row.key, hasLocalChanges ? existing : { draft: persisted, persisted, status: 'idle' }];
    })));
  }, [budget.id, budgetRates, rows]);

  const setDraft = (id: string, draft: string) => {
    setRateStates((current) => {
      const existing = current[id] ?? { draft: '', persisted: '', status: 'idle' };
      return { ...current, [id]: { ...existing, draft, status: 'idle', error: undefined } };
    });
  };

  const save = async (row: typeof rows[number]) => {
    const state = rateStates[row.key];
    const requested = rateValue(state?.draft ?? '');
    if (requested === null || requested <= 0 || savesInFlight.current.has(row.key)) return;
    savesInFlight.current.add(row.key);
    setRateStates((current) => ({ ...current, [row.key]: { ...current[row.key], status: 'saving', error: undefined } }));
    const approvedRate = Math.max(0, Number.isFinite(requested) ? requested : 0);
    const markup = row.costRate > 0 ? Math.max(0, ((approvedRate / row.costRate) - 1) * 100) : 0;
    const payload: Omit<BudgetRate, 'id' | 'createdAt' | 'updatedAt'> = {
      budgetId: budget.id,
      pricingVersion: 2,
      divisionId: row.divisionId,
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
      directCostPerUnit: row.costRate,
      divisionOverheadRecoveryPerUnit: row.divisionOverheadPerUnit,
      companyOverheadRecoveryPerUnit: row.companyOverheadPerUnit,
      recoveredCostPerUnit: row.recoveredCostPerUnit,
      targetMarginPercent: budget.targetMarginPct ?? 20,
      recommendedSellPrice: row.recommendedRate,
      defaultMarkupPercent: markup,
      defaultSellPrice: approvedRate,
      active: true,
      sortOrder: row.rate?.sortOrder ?? rows.findIndex((value) => value.item.id === row.item.id),
    };
    try {
      if (row.rate?.pricingVersion === 2) await updateBudgetRate(row.rate.id, payload);
      else await addBudgetRate(payload);
      const persisted = String(approvedRate);
      setRateStates((current) => ({ ...current, [row.key]: { draft: persisted, persisted, status: 'idle' } }));
    } catch {
      setRateStates((current) => ({
        ...current,
        [row.key]: {
          ...current[row.key],
          status: 'failed',
          error: 'Rate could not be saved. Check your connection and try again.',
        },
      }));
    } finally {
      savesInFlight.current.delete(row.key);
    }
  };

  if (rows.length === 0) return <Card><EmptyState title="No pricing items yet" description="Add Labour, Equipment, Materials, or Subcontractors to this Budget before approving Estimate pricing." /></Card>;

  return <Card className="overflow-hidden">
    <div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600">
      <h2 className="font-semibold text-gray-900 dark:text-brand-50">Estimate Pricing</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Review Budget-calculated recommendations and approve the customer-facing rates Estimates may use.</p>
    </div>
    {recoveryWarnings.length > 0 ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status"><p className="font-semibold">Some overhead cannot be recovered from the current plan.</p>{recoveryWarnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}</div> : null}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="bg-brand-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Direct Cost</th><th className="px-4 py-3 text-right">Division OH</th><th className="px-4 py-3 text-right">Company OH</th><th className="px-4 py-3 text-right">Recommended</th><th className="px-4 py-3">Approved Rate</th><th className="px-4 py-3">Status</th></tr></thead>
        <tbody className="divide-y divide-brand-100 dark:divide-brand-600">{rows.map((row) => {
          const state = rateStates[row.key] ?? { draft: '', persisted: '', status: 'idle' };
          const approved = rateValue(state.draft);
          const isDirty = !ratesMatch(state.draft, state.persisted);
          const isUnavailable = row.recommendedRate <= 0;
          const usesRecommended = approved !== null && Math.abs(approved - row.recommendedRate) < 0.005;
          return <tr key={row.key} id={`pricing-${row.divisionId}-${row.item.id}`}>
            <td className="px-4 py-3 font-medium"><p>{row.item.name || row.item.description}</p><p className="mt-1 text-xs font-normal text-gray-500">{row.divisionName}</p></td>
            <td className="px-4 py-3 capitalize text-gray-500">{row.type}</td>
            <td className="px-4 py-3 text-right">{row.costRate > 0 ? `${formatCurrency(row.costRate)}/${row.unit}` : 'Unavailable'}</td>
            <td className="px-4 py-3 text-right">{formatCurrency(row.divisionOverheadPerUnit)}</td>
            <td className="px-4 py-3 text-right">{formatCurrency(row.companyOverheadPerUnit)}</td>
            {isUnavailable ? <>
              <td className="px-4 py-3 text-right"><p className="font-medium text-gray-700 dark:text-brand-100">Rate unavailable</p><p className="mt-1 text-xs font-normal text-gray-500 dark:text-brand-300">{unavailableReason(row.item.category)}</p></td>
              <td className="px-4 py-3 text-gray-400" colSpan={2}>—</td>
            </> : <>
              <td className="px-4 py-3 text-right"><p className="font-semibold">{formatCurrency(row.recommendedRate)}/{row.unit}</p><details className="mt-1 text-xs text-gray-500"><summary className="cursor-pointer">Calculation</summary><p className="mt-1">({formatCurrency(row.costRate)} + {formatCurrency(row.divisionOverheadPerUnit)} + {formatCurrency(row.companyOverheadPerUnit)}) ÷ {(1 - row.targetMarginPct / 100).toFixed(2)}</p></details></td>
              <td className="w-44 px-4 py-3"><Input aria-label={`Approved rate for ${row.item.name || row.item.description} in ${row.divisionName}`} type="number" min={0} step={0.01} value={state.draft} disabled={!canEdit || state.status === 'saving'} onChange={(event) => setDraft(row.key, event.target.value)} placeholder={row.recommendedRate.toFixed(2)} />{state.error ? <p className="mt-1 text-xs text-red-600" role="alert">{state.error}</p> : null}</td>
              <td className="px-4 py-3"><p className="mb-2 text-xs font-medium text-gray-600">{approved === null ? 'Not approved' : usesRecommended ? 'Using recommended rate' : 'Custom rate'}</p>{canEdit ? <Button type="button" size="sm" variant={isDirty ? 'primary' : 'secondary'} disabled={!isDirty || approved === null || approved <= 0 || state.status === 'saving'} onClick={() => void save(row)}>{state.status === 'saving' ? 'Saving…' : state.status === 'failed' ? 'Try Again' : isDirty ? 'Save' : 'Saved ✓'}</Button> : null}</td>
            </>}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </Card>;
}
