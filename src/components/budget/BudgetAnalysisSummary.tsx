import { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { BudgetFinancials } from '../../pages/budget/budgetFinancialModel';
import { buildBudgetAnalysisSummary, normalizeTargetMargin, targetMarginFromDollars, type AnalysisValueMode } from '../../pages/budget/budgetAnalysisSummaryModel.js';
import { formatCurrency } from '../../utils';
import { Card, Input } from '../ui';

interface Props {
  financials: BudgetFinancials;
  targetMarginPct?: number;
  canEdit: boolean;
  onTargetMarginChange: (targetMarginPct: number) => Promise<unknown> | unknown;
}

const segmentStyles = {
  labour: 'bg-emerald-600',
  equipment: 'bg-sky-600',
  materials: 'bg-amber-500',
  subcontractors: 'bg-rose-500',
  overhead: 'bg-gray-500',
  targetProfit: 'bg-brand-600',
} as const;

const formatPercent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

export default function BudgetAnalysisSummary({ financials, targetMarginPct, canEdit, onTargetMarginChange }: Props) {
  const [mode, setMode] = useState<AnalysisValueMode>('dollars');
  const [canonicalMargin, setCanonicalMargin] = useState(() => normalizeTargetMargin(targetMarginPct));
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const summary = useMemo(() => buildBudgetAnalysisSummary(financials, canonicalMargin), [canonicalMargin, financials]);
  const displayTarget = (nextMode: AnalysisValueMode, margin = canonicalMargin) => nextMode === 'percent'
    ? String(Number(margin.toFixed(2)))
    : String(Number((summary.revenue * margin / 100).toFixed(2)));

  useEffect(() => {
    const next = normalizeTargetMargin(targetMarginPct);
    setCanonicalMargin(next);
    setDraft(mode === 'percent' ? String(Number(next.toFixed(2))) : String(Number((financials.revenue * next / 100).toFixed(2))));
  }, [financials.revenue, mode, targetMarginPct]);

  const changeMode = (nextMode: AnalysisValueMode) => {
    if (nextMode === mode) return;
    setDraft(displayTarget(nextMode));
    setMode(nextMode);
  };

  const commitTarget = async () => {
    const parsed = Number(draft);
    if (!canEdit || !Number.isFinite(parsed) || parsed < 0) {
      setDraft(displayTarget(mode));
      return;
    }
    const nextMargin = mode === 'percent'
      ? normalizeTargetMargin(parsed)
      : targetMarginFromDollars(parsed, summary.revenue);
    setCanonicalMargin(nextMargin);
    setDraft(mode === 'percent' ? String(Number(nextMargin.toFixed(2))) : String(Number((summary.revenue * nextMargin / 100).toFixed(2))));
    if (Math.abs(nextMargin - normalizeTargetMargin(targetMarginPct)) < 0.0001) return;
    setSaving(true);
    try {
      await onTargetMarginChange(nextMargin);
    } finally {
      setSaving(false);
    }
  };

  const targetLine = summary.lines.find((line) => line.key === 'targetProfit');
  const statementLines = summary.lines.filter((line) => line.key !== 'targetProfit');
  const valueFor = (amount: number, percent: number | null) => mode === 'dollars' ? formatCurrency(amount) : formatPercent(percent);

  return <Card className="overflow-hidden">
    <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
      <section className="p-5 sm:p-6" aria-labelledby="financial-summary-heading">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-brand-300">Budget Economics</p>
            <h2 id="financial-summary-heading" className="mt-1 text-xl font-semibold text-gray-950 dark:text-brand-50">Financial Summary</h2>
          </div>
          <div className="inline-flex rounded-lg border border-brand-100 bg-brand-50 p-1 dark:border-brand-600 dark:bg-brand-800" role="group" aria-label="Financial value display">
            {(['dollars', 'percent'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)} className={`min-w-9 rounded-md px-2.5 py-1 text-sm font-semibold ${mode === value ? 'bg-white text-brand-700 shadow-sm dark:bg-brand-600 dark:text-white' : 'text-gray-500 dark:text-brand-300'}`}>{value === 'dollars' ? '$' : '%'}</button>)}
          </div>
        </div>

        <dl className="mt-5 divide-y divide-gray-200 dark:divide-brand-600">
          {statementLines.map((line) => <div key={line.key} className={`flex items-center justify-between gap-4 py-2.5 ${line.key === 'revenue' ? 'pb-4 pt-0' : ''}`}><dt className={line.key === 'revenue' ? 'font-semibold text-gray-950 dark:text-brand-50' : 'text-sm text-gray-600 dark:text-brand-200'}>{line.label}</dt><dd className={`tabular-nums ${line.key === 'revenue' ? 'text-lg font-semibold text-gray-950 dark:text-brand-50' : 'text-sm font-medium text-gray-800 dark:text-brand-100'}`}>{valueFor(line.amount, line.percentOfRevenue)}</dd></div>)}
          <div className="flex items-center justify-between gap-4 border-t-2 border-gray-300 py-3 dark:border-brand-500">
            <div><dt className="font-semibold text-brand-800 dark:text-brand-100">Net Profit</dt><dd className="mt-0.5 text-xs text-gray-500 dark:text-brand-300">Target margin used by Pricing</dd></div>
            <div className="w-36">
              <Input aria-label={`Target Net Profit in ${mode}`} type="number" min={0} max={mode === 'percent' ? 95 : undefined} step={mode === 'percent' ? 0.1 : 1} value={draft} disabled={!canEdit || saving || (mode === 'dollars' && summary.revenue <= 0)} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commitTarget()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
              <p className="mt-1 text-right text-xs font-medium text-brand-700 dark:text-brand-200">{mode === 'dollars' ? formatPercent(targetLine?.percentOfRevenue ?? null) : formatCurrency(targetLine?.amount ?? 0)}</p>
            </div>
          </div>
        </dl>

        <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-brand-600 dark:text-brand-300">
          <div className="flex justify-between gap-4"><span>Current Budget Profit</span><span className="font-medium tabular-nums text-gray-700 dark:text-brand-100">{formatCurrency(summary.currentProfit)} · {formatPercent(summary.currentProfitMarginPct)}</span></div>
          {summary.shortfall > 0 ? <p className="mt-2 text-amber-700 dark:text-amber-300">Current Budget is {(summary.targetNetProfitPct - (summary.currentProfitMarginPct ?? 0)).toFixed(1)} percentage points below the {summary.targetNetProfitPct.toFixed(1)}% target.</p> : <p className="mt-2">Current revenue supports the selected Net Profit target.</p>}
        </div>
      </section>

      <section className="border-t border-gray-200 bg-gray-50 p-5 sm:p-6 lg:border-l lg:border-t-0 dark:border-brand-600 dark:bg-brand-800/40" aria-labelledby="revenue-distribution-heading">
        <p className="text-xs font-semibold uppercase text-gray-500 dark:text-brand-300">Revenue Distribution</p>
        <h3 id="revenue-distribution-heading" className="mt-1 text-base font-semibold text-gray-950 dark:text-brand-50">Where each revenue dollar goes</h3>
        <div className="relative mt-7">
          <div className="flex h-12 overflow-hidden rounded-md bg-gray-200 dark:bg-brand-700" aria-label="Revenue distribution chart">
            {summary.chartSegments.map((segment) => <div key={segment.key} className={`${segmentStyles[segment.key]} min-w-0`} style={{ width: `${segment.widthPct}%` }} title={`${segment.label}: ${formatCurrency(segment.amount)}`} />)}
            {summary.surplusAfterTarget > 0 ? <div className="bg-gray-300 dark:bg-brand-600" style={{ width: `${summary.surplusAfterTarget / summary.chartTotal * 100}%` }} title={`Revenue above target: ${formatCurrency(summary.surplusAfterTarget)}`} /> : null}
          </div>
          {summary.shortfall > 0 ? <div className="absolute -top-2 h-16 border-l-2 border-dashed border-gray-900 dark:border-white" style={{ left: `${summary.revenueMarkerPct}%` }}><span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-gray-700 dark:text-brand-100">Revenue limit</span></div> : null}
        </div>
        <div className="mt-6 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {summary.chartSegments.map((segment) => <div key={segment.key} className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-gray-600 dark:text-brand-200"><span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${segmentStyles[segment.key]}`} />{segment.label}</span><span className="font-medium tabular-nums text-gray-800 dark:text-brand-100">{formatCurrency(segment.amount)}</span></div>)}
          {summary.surplusAfterTarget > 0 ? <div className="flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-2 text-gray-600 dark:text-brand-200"><span className="h-2.5 w-2.5 rounded-sm bg-gray-300 dark:bg-brand-600" />Above target</span><span className="font-medium tabular-nums">{formatCurrency(summary.surplusAfterTarget)}</span></div> : null}
        </div>
        {summary.shortfall > 0 ? <div className="mt-5 flex gap-2 border-t border-amber-200 pt-4 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200"><AlertCircle className="mt-0.5 shrink-0" size={16} /><p><span className="font-semibold">{formatCurrency(summary.shortfall)} revenue gap.</span> Planned costs plus Target Net Profit require {formatCurrency(summary.requiredRevenue)}.</p></div> : null}
      </section>
    </div>
  </Card>;
}