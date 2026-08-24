import { useMemo, useState } from 'react';
import { HardHat, Package, Truck, Users } from 'lucide-react';
import { Card, EmptyState } from '../ui';
import { useStore } from '../../store';
import type { Budget, BudgetDivisionPlanningItem } from '../../types';
import { formatCurrency } from '../../utils';
import { buildBudgetPricingRows, prepareBudgetPricingInputs } from '../../pages/budget/budgetPricingModel.js';
import { formatTargetMarginPercent } from '../../pages/budget/budgetAnalysisSummaryModel.js';
import { buildOverheadRecoveryModel } from '../../pages/budget/overheadRecoveryModel.js';
import OverheadRecoveryEditor from './OverheadRecoveryEditor';

interface Props {
  budget: Budget;
  planningItems: BudgetDivisionPlanningItem[];
  canEdit: boolean;
}

type PricingTab = 'labour' | 'equipment' | 'materials' | 'subcontractors';

const pricingTabs = [
  { key: 'labour', rowType: 'labour', label: 'Labour', icon: Users, costLabel: 'Labour Cost', rateLabel: 'Labour Rate' },
  { key: 'equipment', rowType: 'equipment', label: 'Equipment', icon: Truck, costLabel: 'Equipment Cost', rateLabel: 'Equipment Rate' },
  { key: 'materials', rowType: 'material', label: 'Materials', icon: Package, costLabel: 'Material Cost', rateLabel: 'Material Rate' },
  { key: 'subcontractors', rowType: 'subcontractor', label: 'Subcontractors', icon: HardHat, costLabel: 'Subcontractor Cost', rateLabel: 'Subcontractor Rate' },
] as const;

const categoryTerms = (category: BudgetDivisionPlanningItem['category']) => {
  if (category === 'labour') return { label: 'Labour', pool: 'Labour Overhead Pool', denominator: 'Billable Labour Hours', missing: 'billable labour hours' };
  if (category === 'equipment') return { label: 'Equipment', pool: 'Equipment Recovery Pool', denominator: 'Annual Equipment Cost', missing: 'annual equipment cost' };
  if (category === 'materials') return { label: 'Material', pool: 'Material Recovery Pool', denominator: 'Annual Material Cost', missing: 'annual material cost' };
  return { label: 'Subcontractor', pool: 'Subcontractor Recovery Pool', denominator: 'Annual Subcontractor Cost', missing: 'annual subcontractor cost' };
};

const unavailableCostReason = (category: BudgetDivisionPlanningItem['category']) => {
  if (category === 'labour') return 'Complete labour cost information first.';
  if (category === 'equipment') return 'Complete equipment cost and sellable-hours information first.';
  if (category === 'materials') return 'Complete material cost information first.';
  return 'Complete subcontractor cost information first.';
};

export default function BudgetPricingAnalysis({ budget, planningItems, canEdit }: Props) {
  const { budgetRates, budgetDivisions, employees, updateBudgetDivision } = useStore();
  const divisions = useMemo(() => budgetDivisions.filter((division) => division.budgetId === budget.id && division.status === 'active'), [budget.id, budgetDivisions]);
  const resolvedPlanningItems = useMemo(() => prepareBudgetPricingInputs({ planningItems, employees }), [employees, planningItems]);
  const rows = useMemo(() => buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates, employees }), [budget, budgetRates, divisions, employees, planningItems]);
  const recovery = useMemo(() => buildOverheadRecoveryModel({ budget, divisions, planningItems: resolvedPlanningItems }), [budget, divisions, resolvedPlanningItems]);
  const recoveryWarnings = Object.values(recovery.divisions).flatMap((scope) => scope.warnings);
  const [activePricingTab, setActivePricingTab] = useState<PricingTab>('labour');
  const activeTab = pricingTabs.find((tab) => tab.key === activePricingTab) ?? pricingTabs[0];
  const activeRows = rows.filter((row) => row.type === activeTab.rowType);

  const overheadDisclosure = (row: typeof rows[number]) => {
    const terms = categoryTerms(row.item.category);
    const pool = row.overheadPool ?? 0;
    const denominator = row.recoveryDenominator ?? 0;
    const isCostRecovery = row.item.category !== 'labour';
    const recoveryPercent = ((row.recoveryRate ?? 0) * 100).toFixed(2);
    const denominatorValue = isCostRecovery
      ? formatCurrency(denominator)
      : `${denominator.toLocaleString(undefined, { maximumFractionDigits: 2 })} hrs`;
    const displayedValue = row.recoveryUnavailable ? 'Unavailable' : isCostRecovery ? `${recoveryPercent}%` : `${formatCurrency(row.divisionOverheadPerUnit)}/${row.unit}`;

    return <details>
      <summary className="cursor-pointer font-medium">{displayedValue}</summary>
      <div className="mt-2 space-y-1 text-left text-xs text-gray-500 dark:text-brand-300">
        {isCostRecovery ? <><p>Division Overhead: {formatCurrency(row.divisionOverhead ?? 0)}</p><p>{terms.label} Allocation: {(row.recoveryAllocationPct ?? 0).toFixed(2)}%</p></> : null}
        <p>{terms.pool}: {formatCurrency(pool)}</p>
        <p>{terms.denominator}: {denominatorValue}</p>
        {row.recoveryUnavailableReason === 'configuration' ? <p>Recovery percentages must total 100% before overhead and final rates can be calculated.</p> : row.recoveryUnavailable ? <p>No {terms.missing} is planned, so {formatCurrency(pool)} of {terms.label.toLowerCase()} overhead cannot currently be recovered.</p> : isCostRecovery ? pool > 0 ? <p>{formatCurrency(pool)} ÷ {formatCurrency(denominator)} = {recoveryPercent}% overhead recovery</p> : <p>Recovery Rate: 0.00%</p> : <p>{formatCurrency(pool)} ÷ {denominatorValue} = {formatCurrency(row.divisionOverheadPerUnit)}/{row.unit}</p>}
      </div>
    </details>;
  };

  const pricingTable = (tableRows: typeof rows, costLabel: string, rateLabel: string) => <div className="overflow-x-auto">
    <table className="w-full min-w-[860px] text-sm">
      <thead className="bg-brand-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Division</th><th className="px-4 py-3 text-right">{costLabel}</th><th className="px-4 py-3 text-right">Overhead</th><th className="px-4 py-3 text-right">Target Net Profit</th><th className="px-4 py-3 text-right">{rateLabel}</th></tr></thead>
      <tbody className="divide-y divide-brand-100 dark:divide-brand-600">{tableRows.map((row) => {
        const isUnavailable = row.recommendedRate <= 0;
        return <tr key={row.key} id={`pricing-${row.divisionId}-${row.item.id}`}>
          <td className="px-4 py-3 font-medium">{row.item.name || row.item.description}</td>
          <td className="px-4 py-3 text-gray-500">{row.divisionName}</td>
          <td className="px-4 py-3 text-right">{row.costRate > 0 ? `${formatCurrency(row.costRate)}/${row.unit}` : 'Unavailable'}</td>
          <td className="px-4 py-3 text-right">{overheadDisclosure(row)}</td>
          <td className="px-4 py-3 text-right">{formatTargetMarginPercent(row.targetMarginPct)}</td>
          {isUnavailable ? <td className="px-4 py-3 text-right"><p className="font-medium text-gray-700 dark:text-brand-100">Unavailable</p><p className="mt-1 text-xs font-normal text-gray-500 dark:text-brand-300">{row.recoveryUnavailableReason === 'configuration' ? 'Set recovery percentages to total 100%.' : row.recoveryUnavailable ? `Overhead cannot be recovered without planned ${categoryTerms(row.item.category).missing}.` : unavailableCostReason(row.item.category)}</p></td> : <>
            <td className="px-4 py-3 text-right"><p className="font-semibold">{formatCurrency(row.recommendedRate)}/{row.unit}</p><details className="mt-1 text-xs text-gray-500 dark:text-brand-300"><summary className="cursor-pointer">Calculation</summary><div className="mt-1 space-y-1 text-left"><p>{costLabel}: {formatCurrency(row.costRate)}/{row.unit}</p>{row.item.category === 'labour' ? <><p>Overhead Recovery: {formatCurrency(row.divisionOverheadPerUnit)}/{row.unit}</p><p>Breakeven Rate: {formatCurrency(row.recoveredCostPerUnit)}/{row.unit}</p></> : <><p>Overhead Recovery: {((row.recoveryRate ?? 0) * 100).toFixed(2)}%</p><p>Cost After OH Recovery: {formatCurrency(row.recoveredCostPerUnit)}/{row.unit}</p></>}<p>Target Net Profit: {formatTargetMarginPercent(row.targetMarginPct)}</p><p className="font-medium text-gray-700 dark:text-brand-100">{rateLabel}: {row.item.category === 'labour' ? <>{formatCurrency(row.recoveredCostPerUnit)} ÷ (1 - {formatTargetMarginPercent(row.targetMarginPct)})</> : <>{formatCurrency(row.costRate)} × (1 + {((row.recoveryRate ?? 0) * 100).toFixed(2)}%) ÷ (1 - {formatTargetMarginPercent(row.targetMarginPct)})</>} = {formatCurrency(row.recommendedRate)}/{row.unit}</p></div></details></td>
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

    {rows.length === 0 ? <Card><EmptyState title="No pricing items yet" description="Add Labour, Equipment, Materials, or Subcontractors to this Budget to calculate customer pricing." /></Card> : <section className="space-y-3"><div><h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Pricing</h2><p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Review Budget-calculated rates by Division and see exactly how cost, overhead recovery, and target net profit contribute to each rate.</p></div>{recoveryWarnings.length > 0 ? <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status"><p className="font-semibold">Some overhead cannot be recovered from the current plan.</p>{recoveryWarnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}</div> : null}<div className="overflow-x-auto"><div className="inline-flex min-w-max rounded-xl border border-brand-100 bg-white p-1 dark:border-brand-600 dark:bg-brand-700" role="tablist" aria-label="Pricing category">{pricingTabs.map((tab) => { const Icon = tab.icon; return <button key={tab.key} type="button" role="tab" aria-selected={activePricingTab === tab.key} aria-controls={`${tab.key}-pricing-panel`} onClick={() => setActivePricingTab(tab.key)} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activePricingTab === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-800'}`}><Icon size={16} />{tab.label}</button>; })}</div></div><Card className="overflow-hidden" id={`${activePricingTab}-pricing-panel`} role="tabpanel"><div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600"><h3 className="font-semibold text-gray-900 dark:text-brand-50">{activeTab.label} Pricing</h3></div>{activeRows.length > 0 ? pricingTable(activeRows, activeTab.costLabel, activeTab.rateLabel) : <EmptyState title={`No ${activeTab.label.toLowerCase()} planned`} description={`Add ${activeTab.label} to a Division to calculate pricing.`} />}</Card></section>}
  </div>;
}
