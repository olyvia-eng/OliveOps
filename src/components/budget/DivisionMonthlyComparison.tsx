import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Budget, BudgetDivision } from '../../types';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import { buildEffectiveTimeEntries } from '../../utils/timeCorrections';
import {
  aggregateDivisionFinancialPeriods,
  calculateDivisionMonthlyFinancials,
  compareDivisionFinancialPeriods,
  type DivisionMonthlyFinancialPeriod,
  type DivisionMonthlyMetricKey,
} from '../../pages/budget/divisionMonthlyFinancialModel.js';
import { EmptyState, Modal, Select } from '../ui';

interface Props {
  open: boolean;
  onClose: () => void;
  budget: Budget;
  divisions: BudgetDivision[];
}

const metrics: Array<{ key: DivisionMonthlyMetricKey; label: string; cost?: boolean; margin?: boolean }> = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'labourCost', label: 'Labour Cost', cost: true },
  { key: 'equipmentCost', label: 'Equipment Cost', cost: true },
  { key: 'materialCost', label: 'Material Cost', cost: true },
  { key: 'subcontractorCost', label: 'Subcontractor Cost', cost: true },
  { key: 'overhead', label: 'Overhead', cost: true },
  { key: 'netProfit', label: 'Net Profit' },
  { key: 'netProfitMargin', label: 'Net Profit %', margin: true },
];

const valueLabel = (value: number | null, margin = false) => value === null ? 'Actual data unavailable' : margin ? `${value.toFixed(1)}%` : formatCurrency(value);
const changeLabel = (value: number | null, margin = false) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}${margin ? ' pts' : '%'}`;

function applicablePeriodIndex(months: DivisionMonthlyFinancialPeriod[]) {
  if (months.length === 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const active = months.findIndex((month) => month.startDate <= today && month.endDate >= today);
  if (active >= 0) return active;
  return today < months[0].startDate ? 0 : months.length - 1;
}

export default function DivisionMonthlyComparison({ open, onClose, budget, divisions }: Props) {
  const { jobs, invoices, timeEntries, timeCorrections, employees, expenses } = useStore();
  const budgetDivisions = useMemo(() => divisions.filter((division) => division.budgetId === budget.id).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)), [budget.id, divisions]);
  const [divisionId, setDivisionId] = useState(budgetDivisions[0]?.id ?? '');
  const [periodKey, setPeriodKey] = useState('');
  const [showYtd, setShowYtd] = useState(false);
  const [trendMetric, setTrendMetric] = useState<DivisionMonthlyMetricKey>('revenue');
  const effectiveTimeEntries = useMemo(() => buildEffectiveTimeEntries(timeEntries, timeCorrections), [timeCorrections, timeEntries]);
  const result = useMemo(() => calculateDivisionMonthlyFinancials({ budget, divisionId, jobs, invoices, timeEntries: effectiveTimeEntries, employees, expenses }), [budget, divisionId, effectiveTimeEntries, employees, expenses, invoices, jobs]);

  useEffect(() => {
    if (!budgetDivisions.some((division) => division.id === divisionId)) setDivisionId(budgetDivisions[0]?.id ?? '');
  }, [budgetDivisions, divisionId]);

  useEffect(() => {
    if (result.months.length === 0) return;
    if (!result.months.some((month) => month.key === periodKey)) setPeriodKey(result.months[applicablePeriodIndex(result.months)].key);
  }, [periodKey, result.months]);

  if (!open) return null;
  const selectedIndex = Math.max(0, result.months.findIndex((month) => month.key === periodKey));
  const selectedMonth = result.months[selectedIndex];
  const selected = showYtd ? aggregateDivisionFinancialPeriods(result.months, selectedIndex) : selectedMonth;
  const previous = showYtd
    ? selectedIndex > 0 ? aggregateDivisionFinancialPeriods(result.months, selectedIndex - 1) : null
    : selectedIndex > 0 ? result.months[selectedIndex - 1] : null;
  const changes = selected ? compareDivisionFinancialPeriods(selected, previous) : null;
  const selectedDivision = budgetDivisions.find((division) => division.id === divisionId);
  const trend = result.months.map((month) => ({ label: month.tabLabel, value: month[trendMetric] }));
  const trendDefinition = metrics.find((metric) => metric.key === trendMetric) ?? metrics[0];

  return <Modal open={open} onClose={onClose} title="Compare Division Performance" size="large">
    {budgetDivisions.length === 0 ? <EmptyState title="No Divisions available" description="Add a Division to this Budget before comparing monthly performance." /> : <div className="space-y-5">
      <div className="max-w-sm"><Select label="Division" value={divisionId} onChange={(event) => { setDivisionId(event.target.value); setShowYtd(false); setPeriodKey(''); }}>{budgetDivisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</Select></div>

      <div className="overflow-x-auto border-y border-brand-100 py-2 dark:border-brand-600"><div className="flex min-w-max gap-1" role="tablist" aria-label="Comparison period">
        {result.periods.map((period) => <button key={period.key} type="button" role="tab" aria-selected={!showYtd && periodKey === period.key} onClick={() => { setPeriodKey(period.key); setShowYtd(false); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${!showYtd && periodKey === period.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-700'}`}>{period.tabLabel}</button>)}
        <button type="button" role="tab" aria-selected={showYtd} onClick={() => setShowYtd(true)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${showYtd ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-700'}`}>YTD</button>
      </div></div>

      {selected && changes ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="overflow-x-auto border-y border-brand-100 dark:border-brand-600"><table className="w-full min-w-[650px] text-sm"><thead><tr className="border-b border-brand-100 text-left text-xs uppercase text-gray-500 dark:border-brand-600 dark:text-brand-300"><th className="px-3 py-3">Metric</th><th className="px-3 py-3 text-right">{showYtd ? `YTD through ${selectedMonth?.label}` : selected.label}</th><th className="px-3 py-3 text-right">{previous ? showYtd ? `YTD through ${result.months[selectedIndex - 1]?.label}` : previous.label : 'Previous period'}</th><th className="px-3 py-3 text-right">Change</th></tr></thead><tbody className="divide-y divide-brand-100 dark:divide-brand-600">
          {metrics.map((metric) => {
            const selectedValue = selected[metric.key];
            const previousValue = previous?.[metric.key] ?? null;
            const change = changes[metric.key];
            const favorable = change !== null && (metric.cost ? change < 0 : change > 0);
            return <tr key={metric.key}><th className="px-3 py-3 text-left font-medium text-gray-700 dark:text-brand-100">{metric.label}</th><td className="px-3 py-3 text-right tabular-nums">{valueLabel(selectedValue, metric.margin)}</td><td className="px-3 py-3 text-right tabular-nums text-gray-500 dark:text-brand-300">{valueLabel(previousValue, metric.margin)}</td><td className={`px-3 py-3 text-right font-medium tabular-nums ${change === null || change === 0 ? 'text-gray-500' : favorable ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{changeLabel(change, metric.margin)}</td></tr>;
          })}
        </tbody></table></div>

        <section className="min-w-0" aria-labelledby="division-trend-heading"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-gray-500 dark:text-brand-300">{selectedDivision?.name}</p><h3 id="division-trend-heading" className="mt-1 font-semibold text-gray-950 dark:text-brand-50">Monthly trend</h3></div><div className="w-48"><Select label="Metric" value={trendMetric} onChange={(event) => setTrendMetric(event.target.value as DivisionMonthlyMetricKey)}>{metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</Select></div></div>
          <div className="mt-4 h-72" aria-label={`${trendDefinition.label} monthly trend chart`}><ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => trendDefinition.margin ? `${value}%` : `$${Math.round(value / 1000)}k`} /><Tooltip formatter={(value) => valueLabel(typeof value === 'number' ? value : null, trendDefinition.margin)} /><Line type="monotone" dataKey="value" stroke="#047857" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} /></LineChart></ResponsiveContainer></div>
        </section>
      </div> : null}

      <section className="border-t border-brand-100 pt-4 dark:border-brand-600"><h3 className="text-sm font-semibold text-gray-800 dark:text-brand-100">Actual data coverage</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(result.sourceStatus).map(([key, source]) => <p key={key} className="text-xs text-gray-500 dark:text-brand-300"><span className="font-semibold text-gray-700 dark:text-brand-100">{metrics.find((metric) => metric.key === key)?.label}:</span> {source.note}</p>)}</div></section>
    </div>}
  </Modal>;
}