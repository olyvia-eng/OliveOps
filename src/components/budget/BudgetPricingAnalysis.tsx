import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Input } from '../ui';
import { useStore } from '../../store';
import type { Budget, BudgetDivisionPlanningItem, BudgetRate } from '../../types';
import { formatCurrency } from '../../utils';
import { buildBudgetPricingRows } from '../../pages/budget/budgetPricingModel.js';
import { buildOverheadRecoveryModel } from '../../pages/budget/overheadRecoveryModel.js';
import OverheadRecoveryEditor from './OverheadRecoveryEditor';

interface Props {
  budget: Budget;
  planningItems: BudgetDivisionPlanningItem[];
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

export default function BudgetPricingAnalysis({ budget, planningItems, canEdit }: Props) {
  const { budgetRates, budgetDivisions, addBudgetRate, updateBudgetRate, updateBudgetDivision } = useStore();
  const divisions = useMemo(() => budgetDivisions.filter((division) => division.budgetId === budget.id && division.status === 'active'), [budget.id, budgetDivisions]);
  const rows = useMemo(() => buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates }), [budget, budgetRates, divisions, planningItems]);
  const recovery = useMemo(() => buildOverheadRecoveryModel({ budget, divisions, planningItems }), [budget, divisions, planningItems]);
  const recoveryWarnings = Object.values(recovery.divisions).flatMap((scope) => scope.warnings);
  const labourRows = rows.filter((row) => row.type === 'labour');
  const equipmentRows = rows.filter((row) => row.type === 'equipment');
  const otherRows = rows.filter((row) => row.type !== 'labour' && row.type !== 'equipment');
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

  const pricingTable = (tableRows: typeof rows, costLabel: string, rateLabel: string) => <div className="overflow-x-auto">
    <table className="w-full min-w-[1120px] text-sm">
      <thead className="bg-brand-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Division</th><th className="px-4 py-3 text-right">{costLabel}</th><th className="px-4 py-3 text-right">Overhead</th><th className="px-4 py-3 text-right">Target Net Profit</th><th className="px-4 py-3 text-right">{rateLabel}</th><th className="px-4 py-3">Approved Rate</th><th className="px-4 py-3">Status</th></tr></thead>
      <tbody className="divide-y divide-brand-100 dark:divide-brand-600">{tableRows.map((row) => {
        const state = rateStates[row.key] ?? { draft: '', persisted: '', status: 'idle' };
        const approved = rateValue(state.draft);
        const isDirty = !ratesMatch(state.draft, state.persisted);
        const isUnavailable = row.recommendedRate <= 0;
        const usesRecommended = approved !== null && Math.abs(approved - row.recommendedRate) < 0.005;
        return <tr key={row.key} id={`pricing-${row.divisionId}-${row.item.id}`}>
          <td className="px-4 py-3 font-medium">{row.item.name || row.item.description}</td>
          <td className="px-4 py-3 text-gray-500">{row.divisionName}</td>
          <td className="px-4 py-3 text-right">{row.costRate > 0 ? `${formatCurrency(row.costRate)}/${row.unit}` : 'Unavailable'}</td>
          <td className="px-4 py-3 text-right">{row.aggregateLabour ? <details><summary className="cursor-pointer font-medium">{formatCurrency(row.divisionOverheadPerUnit)}/hr</summary><div className="mt-2 space-y-1 text-xs text-gray-500"><p>Overhead allocated to labour: {formatCurrency(row.overheadPool ?? 0)}</p><p>Planned billable labour hours: {(row.billableHours ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p><p>Overhead recovery: {formatCurrency(row.divisionOverheadPerUnit)}/hr</p></div></details> : formatCurrency(row.divisionOverheadPerUnit)}</td>
          <td className="px-4 py-3 text-right">{row.targetMarginPct.toFixed(0)}%</td>
          {isUnavailable ? <>
            <td className="px-4 py-3 text-right"><p className="font-medium text-gray-700 dark:text-brand-100">Rate unavailable</p><p className="mt-1 text-xs font-normal text-gray-500 dark:text-brand-300">{unavailableReason(row.item.category)}</p></td>
            <td className="px-4 py-3 text-gray-400" colSpan={2}>—</td>
          </> : <>
            <td className="px-4 py-3 text-right"><p className="font-semibold">{formatCurrency(row.recommendedRate)}/{row.unit}</p><details className="mt-1 text-xs text-gray-500"><summary className="cursor-pointer">Calculation</summary><div className="mt-1 space-y-1"><p>{costLabel}: {formatCurrency(row.costRate)}/{row.unit}</p><p>Overhead: {formatCurrency(row.divisionOverheadPerUnit)}/{row.unit}</p><p>Breakeven: {formatCurrency(row.recoveredCostPerUnit)}/{row.unit}</p><p>Target Net Profit: {row.targetMarginPct.toFixed(0)}%</p><p>{formatCurrency(row.recoveredCostPerUnit)} ÷ (1 - {row.targetMarginPct.toFixed(0)}% Target Net Profit) = {formatCurrency(row.recommendedRate)}/{row.unit}</p></div></details></td>
            <td className="w-44 px-4 py-3"><Input aria-label={`Approved rate for ${row.item.name || row.item.description} in ${row.divisionName}`} type="number" min={0} step={0.01} value={state.draft} disabled={!canEdit || state.status === 'saving'} onChange={(event) => setDraft(row.key, event.target.value)} placeholder={row.recommendedRate.toFixed(2)} />{state.error ? <p className="mt-1 text-xs text-red-600" role="alert">{state.error}</p> : null}</td>
            <td className="px-4 py-3"><p className="mb-2 text-xs font-medium text-gray-600">{approved === null ? 'Not approved' : usesRecommended ? 'Using recommended rate' : 'Custom rate'}</p>{canEdit ? <Button type="button" size="sm" variant={isDirty ? 'primary' : 'secondary'} disabled={!isDirty || approved === null || approved <= 0 || state.status === 'saving'} onClick={() => void save(row)}>{state.status === 'saving' ? 'Saving…' : state.status === 'failed' ? 'Try Again' : isDirty ? 'Save' : 'Saved ✓'}</Button> : null}</td>
          </>}
        </tr>;
      })}</tbody>
    </table>
  </div>;

  return <div className="space-y-5">
    <section className="space-y-3">
      <div><h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Overhead Recovery</h2><p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Choose how each Division recovers its allocated overhead through customer pricing.</p></div>
      {divisions.map((division) => <OverheadRecoveryEditor key={division.id} title={division.name} description={`Allocated overhead: ${formatCurrency(recovery.divisions[division.id]?.totalOverhead ?? 0)}`} totalOverhead={recovery.divisions[division.id]?.totalOverhead ?? 0} policy={division.overheadRecoveryPolicy} canEdit={canEdit} onSave={(overheadRecoveryPolicy) => updateBudgetDivision(budget.id, division.id, { overheadRecoveryPolicy })} />)}
      {divisions.length === 0 ? <Card><EmptyState title="No Divisions yet" description="Add a Division before configuring overhead recovery." /></Card> : null}
    </section>

    {rows.length === 0 ? <Card><EmptyState title="No pricing items yet" description="Add Labour, Equipment, Materials, or Subcontractors to this Budget before approving Estimate pricing." /></Card> : <section className="space-y-3"><div><h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Pricing Recommendations</h2><p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Review the calculated rates for each Division, then explicitly approve the customer-facing rates Estimates may use.</p></div>{recoveryWarnings.length > 0 ? <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status"><p className="font-semibold">Some overhead cannot be recovered from the current plan.</p>{recoveryWarnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}</div> : null}{labourRows.length > 0 ? <Card className="overflow-hidden"><div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600"><h3 className="font-semibold text-gray-900 dark:text-brand-50">Labour Pricing</h3></div>{pricingTable(labourRows, 'Labour Cost', 'Labour Rate')}</Card> : null}{equipmentRows.length > 0 ? <Card className="overflow-hidden"><div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600"><h3 className="font-semibold text-gray-900 dark:text-brand-50">Equipment Pricing</h3></div>{pricingTable(equipmentRows, 'Equipment Cost', 'Equipment Rate')}</Card> : null}{otherRows.length > 0 ? <Card className="overflow-hidden"><div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600"><h3 className="font-semibold text-gray-900 dark:text-brand-50">Material &amp; Subcontractor Pricing</h3></div>{pricingTable(otherRows, 'Unit Cost', 'Customer Rate')}</Card> : null}</section>}
  </div>;
}
