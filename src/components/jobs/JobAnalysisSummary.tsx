import { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { AlertCircle, CheckCircle2, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { JobPerformance, JobPerformanceCostRow } from '../../utils/jobPerformanceModel.js';
import { formatCurrency } from '../../utils';
import { Card } from '../ui';

type SummaryMode = 'estimated' | 'actual' | 'variance';
type ValueMode = 'dollars' | 'percent';

const segmentColors = {
  labour: '#059669',
  equipment: '#0284c7',
  material: '#d97706',
  subcontractor: '#e11d48',
  overhead: '#6b7280',
  profit: '#536246',
  unspent: '#a3b18a',
} as const;

const categoryLabels = { labour: 'Labour cost', equipment: 'Equipment cost', material: 'Material cost', subcontractor: 'Subcontractor cost' } as const;
const percent = (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(1)}%`;

function Segments<T extends string>({ values, value, labels, onChange, ariaLabel }: { values: readonly T[]; value: T; labels: Record<T, string>; onChange: (value: T) => void; ariaLabel: string }) {
  return <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-brand-100 bg-brand-50 p-1 dark:border-brand-600 dark:bg-brand-800" role="group" aria-label={ariaLabel}>
    {values.map((item) => <button key={item} type="button" aria-pressed={value === item} onClick={() => onChange(item)} className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ${value === item ? 'bg-white text-brand-700 shadow-sm dark:bg-brand-600 dark:text-white' : 'text-gray-500 dark:text-brand-300'}`}>{labels[item]}</button>)}
  </div>;
}

function VarianceValue({ row, valueMode }: { row: JobPerformanceCostRow; valueMode: ValueMode }) {
  if (row.variance === null) return <span className="inline-flex items-center gap-1.5 text-gray-400"><AlertCircle size={14} /> Unavailable</span>;
  const amount = valueMode === 'dollars'
    ? formatCurrency(Math.abs(row.variance))
    : row.estimatedCost !== null && row.estimatedCost > 0 ? `${Math.abs(row.variance / row.estimatedCost * 100).toFixed(1)}%` : 'Unavailable';
  if (amount === 'Unavailable') return <span className="inline-flex items-center gap-1.5 text-gray-400"><AlertCircle size={14} /> Unavailable</span>;
  if (row.variance > 0) return <span className="inline-flex items-center gap-1.5 font-medium text-red-700 dark:text-red-300"><TrendingUp size={14} /> {amount} over estimate</span>;
  if (row.variance < 0) return <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300"><TrendingDown size={14} /> {amount} under estimate to date</span>;
  return <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-brand-200"><Minus size={14} /> On estimate</span>;
}

export default function JobAnalysisSummary({ performance }: { performance: JobPerformance }) {
  const [mode, setMode] = useState<SummaryMode>('estimated');
  const [valueMode, setValueMode] = useState<ValueMode>('dollars');
  const [modePending, startModeTransition] = useTransition();
  const deferredPerformance = useDeferredValue(performance);
  const recalculating = modePending || deferredPerformance !== performance;
  const revenue = deferredPerformance.revenue.contract;
  const formatValue = (value: number | null, basis = revenue) => valueMode === 'dollars'
    ? (value === null ? 'Unavailable' : formatCurrency(value))
    : (value === null || basis === null || basis <= 0 ? 'Unavailable' : percent(value / basis * 100));
  const estimatedUsesInternalCosts = deferredPerformance.baseline.available;
  const distributionSegments = useMemo(() => mode === 'estimated'
    ? (deferredPerformance.baseline.available ? deferredPerformance.economics.estimatedChartSegments : deferredPerformance.economics.contractValueChartSegments)
    : deferredPerformance.economics.actualChartSegments, [deferredPerformance, mode]);
  const chartSegments = useMemo(() => distributionSegments.filter((segment) => segment.amount > 0), [distributionSegments]);
  const varianceBars = useMemo(() => deferredPerformance.costs.categories.flatMap((row) => row.variance === null ? [] : [{ label: categoryLabels[row.category].replace(' cost', ''), variance: row.variance }]), [deferredPerformance]);
  const estimatedRows = deferredPerformance.costs.categories.map((row) => ({ label: categoryLabels[row.category], value: row.estimatedCost }));
  const actualRows = deferredPerformance.costs.categories.map((row) => ({ label: categoryLabels[row.category], value: row.actualCost }));

  if (recalculating) return <Card className="overflow-hidden" aria-busy="true"><div className="grid min-h-[420px] animate-pulse gap-6 p-6 lg:grid-cols-2"><div className="space-y-4"><div className="h-6 w-48 rounded bg-gray-200" /><div className="h-10 rounded bg-gray-100" /><div className="h-48 rounded bg-gray-100" /></div><div className="h-72 rounded bg-gray-100" /></div></Card>;

  return <Card className="overflow-hidden">
    <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
      <section className="p-5 sm:p-6" aria-labelledby="job-financial-summary-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase text-gray-500 dark:text-brand-300">Job Economics</p><h2 id="job-financial-summary-heading" className="mt-1 text-xl font-semibold text-gray-950 dark:text-brand-50">Financial Summary</h2></div>
          <div className="inline-flex rounded-lg border border-brand-100 bg-brand-50 p-1 dark:border-brand-600 dark:bg-brand-800" role="group" aria-label="Financial value display">
            {(['dollars', 'percent'] as const).map((mode) => <button key={mode} type="button" aria-pressed={valueMode === mode} onClick={() => setValueMode(mode)} className={`min-w-9 rounded-md px-2.5 py-1 text-sm font-semibold ${valueMode === mode ? 'bg-white text-brand-700 shadow-sm dark:bg-brand-600 dark:text-white' : 'text-gray-500 dark:text-brand-300'}`}>{mode === 'dollars' ? '$' : '%'}</button>)}
          </div>
        </div>
        <div className="mt-4"><Segments values={['estimated', 'actual', 'variance'] as const} value={mode} labels={{ estimated: 'Estimated', actual: 'Actual to date', variance: 'Variance' }} onChange={(nextMode) => startModeTransition(() => setMode(nextMode))} ariaLabel="Job Analysis mode" /></div>

        {mode !== 'variance' ? <dl className="mt-5 divide-y divide-gray-200 dark:divide-brand-600">
          <div className="flex items-center justify-between gap-4 pb-4"><dt className="font-semibold text-gray-950 dark:text-brand-50">Contract revenue, excluding tax</dt><dd className="text-lg font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatValue(revenue)}</dd></div>
          {(mode === 'estimated' ? estimatedRows : actualRows).map((row) => <div key={row.label} className="flex items-center justify-between gap-4 py-2.5"><dt className="text-sm text-gray-600 dark:text-brand-200">{row.label}</dt><dd className="text-sm font-medium tabular-nums text-gray-800 dark:text-brand-100">{formatValue(row.value)}</dd></div>)}
          <div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-sm text-gray-600 dark:text-brand-200">{mode === 'estimated' ? 'Overhead cost' : 'Recorded overhead to date'}</dt><dd className="text-sm font-medium tabular-nums text-gray-800 dark:text-brand-100">{formatValue(mode === 'estimated' ? deferredPerformance.costs.estimatedOverhead : deferredPerformance.costs.actualOverhead)}</dd></div>
          <div className="flex items-center justify-between gap-4 border-t-2 border-gray-300 py-3 dark:border-brand-500"><dt className="font-semibold text-gray-950 dark:text-brand-50">{mode === 'estimated' ? 'Total estimated cost' : 'Total actual cost to date'}</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{mode === 'estimated' ? formatValue(deferredPerformance.costs.estimatedDirect) : <>{formatValue(deferredPerformance.economics.knownActualCost)}{!deferredPerformance.economics.actualCostComplete ? <span className="ml-2 text-xs font-medium text-amber-700">known</span> : null}</>}</dd></div>
          {mode === 'estimated' ? <><div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-sm font-semibold text-brand-800 dark:text-brand-100">Expected profit</dt><dd className="font-semibold tabular-nums text-brand-800 dark:text-brand-100">{formatValue(deferredPerformance.profit.estimatedGross)}</dd></div><div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-sm text-gray-600 dark:text-brand-200">Expected profit margin</dt><dd className="text-sm font-medium tabular-nums">{percent(deferredPerformance.profit.estimatedGrossMargin)}</dd></div></> : <><div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-sm font-semibold text-brand-800 dark:text-brand-100">Margin after recorded costs</dt><dd className="font-semibold tabular-nums text-brand-800 dark:text-brand-100">{formatValue(deferredPerformance.economics.marginAfterRecordedCosts)}</dd></div><div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-sm text-gray-600 dark:text-brand-200">Cost consumed</dt><dd className="text-sm font-medium tabular-nums">{percent(deferredPerformance.economics.costConsumedPct)}</dd></div></>}
        </dl> : <div className="mt-5 divide-y divide-gray-200 dark:divide-brand-600">{deferredPerformance.costs.categories.map((row) => <div key={row.category} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-sm text-gray-600 dark:text-brand-200">{categoryLabels[row.category]}</span><VarianceValue row={row} valueMode={valueMode} /></div>)}<div className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-sm text-gray-600 dark:text-brand-200">Overhead cost</span><span className="inline-flex items-center gap-1.5 text-gray-400"><AlertCircle size={14} /> Unavailable</span></div></div>}

        {!deferredPerformance.baseline.available && mode === 'estimated' ? <div className="mt-4 flex gap-2 border-t border-amber-200 pt-4 text-sm text-amber-800"><AlertCircle className="mt-0.5 shrink-0" size={16} /><p>{deferredPerformance.baseline.unavailableReason}</p></div> : null}
        {mode !== 'estimated' ? <div className="mt-4 border-t border-gray-200 pt-4 text-xs text-gray-500 dark:border-brand-600 dark:text-brand-300"><p>{mode === 'actual' ? 'This is the contract value less costs recorded to date. It is not the final Job profit until all costs are recorded.' : deferredPerformance.costs.varianceConvention}</p>{!deferredPerformance.economics.actualCostComplete ? <p className="mt-2 font-medium text-amber-700">Incomplete cost data: {deferredPerformance.costs.unavailableCategories.join(', ')} unavailable.</p> : null}</div> : null}
      </section>

      <section className="border-t border-gray-200 bg-gray-50 p-5 sm:p-6 lg:border-l lg:border-t-0 dark:border-brand-600 dark:bg-brand-800/40" aria-labelledby="cost-distribution-heading">
        <div><p className="text-xs font-semibold uppercase text-gray-500 dark:text-brand-300">{mode === 'variance' ? 'Cost Variance' : mode === 'estimated' && !estimatedUsesInternalCosts ? 'Contract Value Distribution' : 'Cost Distribution'}</p><h3 id="cost-distribution-heading" className="mt-1 text-base font-semibold text-gray-950 dark:text-brand-50">{mode === 'estimated' ? estimatedUsesInternalCosts ? 'Planned internal cost allocation' : 'Contract value distribution' : mode === 'actual' ? 'Recorded actual-cost distribution' : 'Actual cost compared with accepted estimate'}</h3>{mode === 'estimated' && !estimatedUsesInternalCosts ? <p className="mt-1 text-sm text-gray-500">How the accepted pre-tax contract value is distributed by category.</p> : null}</div>
        {mode === 'variance' ? (varianceBars.length ? <div className="mt-4 h-56" aria-label="Cost variance by category"><ResponsiveContainer width="100%" height="100%"><BarChart data={varianceBars} layout="vertical" margin={{ left: 16, right: 16 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `$${Number(value).toLocaleString()}`} /><YAxis type="category" dataKey="label" width={90} /><ReferenceLine x={0} stroke="#6b7280" /><Tooltip formatter={(value) => formatCurrency(Number(value))} /><Bar dataKey="variance" fill="#536246" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div> : <div className="mt-4 flex min-h-56 items-center justify-center text-center text-sm text-gray-500">No categories have both accepted internal cost and actual cost data.</div>) : chartSegments.length ? <div className="mt-4 h-56" aria-label={mode === 'estimated' ? estimatedUsesInternalCosts ? 'Estimated internal cost distribution chart' : 'Accepted contract value distribution chart' : 'Recorded actual cost distribution chart'}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartSegments} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={48} outerRadius={88} strokeWidth={2}>{chartSegments.map((segment) => <Cell key={segment.key} fill={segmentColors[segment.key]} />)}</Pie><Tooltip formatter={(value) => formatCurrency(Number(value))} /></PieChart></ResponsiveContainer></div> : <div className="mt-4 flex min-h-56 items-center justify-center text-center text-sm text-gray-500">{mode === 'actual' ? 'No recorded actual costs yet.' : 'Accepted contract allocation unavailable.'}</div>}
        {mode === 'variance' ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{varianceBars.map((item) => <div key={item.label} className="flex justify-between gap-3 text-xs"><span className="text-gray-600">{item.label}</span><span className="font-medium tabular-nums text-gray-800">{formatCurrency(item.variance)}</span></div>)}</div> : <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">{distributionSegments.map((segment) => <div key={segment.key} className="flex min-w-0 items-start justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-gray-600 dark:text-brand-200"><span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: segmentColors[segment.key] }} /><span className="break-words">{segment.label}</span></span><span className="shrink-0 text-right font-medium tabular-nums text-gray-800 dark:text-brand-100">{formatCurrency(segment.amount)}<br /><span className="font-normal text-gray-500">{percent(segment.percent)}</span></span></div>)}</div>}
        <table className="sr-only"><caption>{mode === 'estimated' ? estimatedUsesInternalCosts ? 'Estimated internal cost distribution' : 'Accepted contract value distribution' : mode === 'actual' ? 'Actual cost distribution to date' : 'Cost variance by category'}</caption><thead><tr><th>Category</th><th>Value</th></tr></thead><tbody>{mode === 'variance' ? varianceBars.map((item) => <tr key={item.label}><td>{item.label}</td><td>{formatCurrency(item.variance)}</td></tr>) : distributionSegments.map((segment) => <tr key={segment.key}><td>{segment.label}</td><td>{formatCurrency(segment.amount)}</td></tr>)}</tbody></table>
        {mode !== 'estimated' && deferredPerformance.economics.overContractAmount > 0 ? <div className="mt-4 flex gap-2 border-t border-red-200 pt-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300"><TrendingUp className="mt-0.5 shrink-0" size={16} /><p><strong>{formatCurrency(deferredPerformance.economics.overContractAmount)} over contract value.</strong></p></div> : null}
        {mode === 'actual' && !deferredPerformance.economics.actualCostComplete ? <div className="mt-4 flex gap-2 border-t border-amber-200 pt-4 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200"><AlertCircle className="mt-0.5 shrink-0" size={16} /><p>Unavailable actual costs: {deferredPerformance.costs.unavailableCategories.join(', ')}.</p></div> : null}
        {mode === 'variance' && deferredPerformance.costs.varianceUnavailableCategories.length ? <div className="mt-4 flex gap-2 border-t border-amber-200 pt-4 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200"><AlertCircle className="mt-0.5 shrink-0" size={16} /><p>No comparable accepted and actual cost data for: {deferredPerformance.costs.varianceUnavailableCategories.join(', ')}.</p></div> : null}
        {mode !== 'estimated' ? <div className="mt-4 flex gap-2 border-t border-brand-100 pt-4 text-sm text-brand-800 dark:border-brand-600 dark:text-brand-100"><CheckCircle2 className="mt-0.5 shrink-0" size={16} /><p>{deferredPerformance.economics.statusMessage}</p></div> : null}
      </section>
    </div>
  </Card>;
}