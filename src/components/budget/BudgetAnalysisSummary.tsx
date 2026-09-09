import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Target } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { BudgetFinancials } from '../../pages/budget/budgetFinancialModel';
import { buildBudgetAnalysisSummary, formatTargetMarginPercent, isValidTargetMarginInput, MAX_TARGET_MARGIN_PCT, normalizeTargetMargin, type AnalysisValueMode } from '../../pages/budget/budgetAnalysisSummaryModel.js';
import { formatCurrency } from '../../utils';
import { Card, Input } from '../ui';

interface Props {
  financials: BudgetFinancials;
  targetMarginPct?: number;
  canEdit: boolean;
  onTargetMarginChange: (targetMarginPct: number) => Promise<unknown> | unknown;
}

const segmentColors = {
  labour: '#059669',
  equipment: '#0284c7',
  materials: '#d97706',
  subcontractors: '#e11d48',
  overhead: '#6b7280',
  netProfit: '#536246',
} as const;

const formatPercent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

export default function BudgetAnalysisSummary({ financials, targetMarginPct, canEdit, onTargetMarginChange }: Props) {
  const [mode, setMode] = useState<AnalysisValueMode>('dollars');
  const [canonicalMargin, setCanonicalMargin] = useState(() => normalizeTargetMargin(targetMarginPct));
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const summary = useMemo(() => buildBudgetAnalysisSummary(financials, canonicalMargin), [canonicalMargin, financials]);
  const pieData = summary.chartSegments;
  const displayTarget = (margin = canonicalMargin) => String(Number(margin.toFixed(2)));

  useEffect(() => {
    const next = normalizeTargetMargin(targetMarginPct);
    setCanonicalMargin(next);
    setDraft(displayTarget(next));
  }, [targetMarginPct]);

  const changeMode = (nextMode: AnalysisValueMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
  };

  const commitTarget = async () => {
    const parsed = Number(draft);
    if (!canEdit || !isValidTargetMarginInput(parsed)) {
      setDraft(displayTarget());
      return;
    }
    const nextMargin = normalizeTargetMargin(parsed);
    setCanonicalMargin(nextMargin);
    setDraft(displayTarget(nextMargin));
    if (Math.abs(nextMargin - normalizeTargetMargin(targetMarginPct)) < 0.0001) return;
    setSaving(true);
    try {
      await onTargetMarginChange(nextMargin);
    } finally {
      setSaving(false);
    }
  };

  const statementLines = summary.lines.filter((line) => line.key !== 'netProfit');
  const valueFor = (amount: number, percent: number | null) => mode === 'dollars' ? formatCurrency(amount) : formatPercent(percent);
  const totalCostPercent = summary.revenue > 0 ? summary.totalPlannedCosts / summary.revenue * 100 : null;
  const isAboveTarget = summary.currentProfitMarginPct !== null && summary.currentProfitMarginPct > summary.targetNetProfitPct;
  const isAtTarget = summary.currentProfitMarginPct !== null && Math.abs(summary.currentProfitMarginPct - summary.targetNetProfitPct) < 0.001;
  const meetsTarget = isAboveTarget || isAtTarget;
  const targetMarginLabel = formatTargetMarginPercent(summary.targetNetProfitPct);

  return <div className="space-y-6">
    <Card className="overflow-hidden">
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
          {statementLines.map((line) => <div key={line.key} className={`flex items-center justify-between gap-4 py-2.5 ${line.key === 'revenue' ? 'pb-4 pt-0' : ''}`}><dt className={line.key === 'revenue' ? 'font-semibold text-gray-950 dark:text-brand-50' : 'text-sm text-gray-600 dark:text-brand-200'}>{line.key === 'revenue' ? 'Total Revenue' : line.label}</dt><dd className={`tabular-nums ${line.key === 'revenue' ? 'text-lg font-semibold text-gray-950 dark:text-brand-50' : 'text-sm font-medium text-gray-800 dark:text-brand-100'}`}>{valueFor(line.amount, line.percentOfRevenue)}</dd></div>)}
          <div className="flex items-center justify-between gap-4 border-t-2 border-gray-300 py-3 dark:border-brand-500"><dt className="font-semibold text-gray-950 dark:text-brand-50">Total Costs</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{valueFor(summary.totalPlannedCosts, totalCostPercent)}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3"><dt className="font-semibold text-brand-800 dark:text-brand-100">Projected Profit</dt><dd className="font-semibold tabular-nums text-brand-800 dark:text-brand-100">{summary.currentProfit === null ? '—' : valueFor(summary.currentProfit, summary.currentProfitMarginPct)}</dd></div>
        </dl>
      </section>

      <section className="border-t border-gray-200 bg-gray-50 p-5 sm:p-6 lg:border-l lg:border-t-0 dark:border-brand-600 dark:bg-brand-800/40" aria-labelledby="revenue-distribution-heading">
        <div>
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-brand-300">Revenue Distribution</p>
            <h3 id="revenue-distribution-heading" className="mt-1 text-base font-semibold text-gray-950 dark:text-brand-50">Where each revenue dollar goes</h3>
          </div>
        </div>
        <div className="relative mt-4 h-56" aria-label="Revenue distribution pie chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={54} outerRadius={88} strokeWidth={2}>{pieData.map((segment) => <Cell key={segment.key} fill={segmentColors[segment.key]} />)}</Pie><Tooltip formatter={(value) => formatCurrency(Number(value))} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-2xl font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatPercent(summary.currentProfitMarginPct)}</span><span className="mt-0.5 text-xs font-medium text-gray-500 dark:text-brand-300">Projected Margin</span></div></div>
        <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {pieData.map((segment) => <div key={segment.key} className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-gray-600 dark:text-brand-200"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: segmentColors[segment.key] }} />{segment.label}</span><span className="font-medium tabular-nums text-gray-800 dark:text-brand-100">{formatCurrency(segment.amount)}</span></div>)}
        </div>
        {summary.currentProfit !== null && summary.currentProfit < 0 ? <div className="mt-4 border-t border-red-200 pt-3 text-sm text-red-700 dark:border-red-900 dark:text-red-300"><span className="font-semibold">Current loss: {formatCurrency(Math.abs(summary.currentProfit))}</span>. Cost slices are shown at their full positive values; no negative pie slice is drawn.</div> : null}
      </section>
      </div>
    </Card>

    <section aria-labelledby="profit-comparison-heading">
      <h2 id="profit-comparison-heading" className="text-xl font-semibold text-gray-950 dark:text-brand-50">Profit Goal &amp; Comparison</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">See how your current budget compares to your target profit margin.</p>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="border-t-4 border-t-brand-600 p-5 sm:p-6">
          <div className="flex items-start gap-3"><span className="rounded-lg bg-brand-50 p-2 text-brand-700 dark:bg-brand-800 dark:text-brand-200"><Target size={20} /></span><div><h3 className="font-semibold text-gray-950 dark:text-brand-50">Target Profit Margin</h3><p className="mt-1 text-sm text-gray-500 dark:text-brand-300">The profit you want built into your pricing. OliveOps uses this when calculating recommended rates.</p></div></div>
          <div className="mt-5 flex max-w-44 items-center gap-2"><Input aria-label="Target Profit Margin" type="number" min={0} max={MAX_TARGET_MARGIN_PCT} step={0.1} value={draft} disabled={!canEdit || saving} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commitTarget()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><span className="text-lg font-semibold text-gray-700 dark:text-brand-100">%</span></div>
          <p className="mt-3 text-xs text-gray-500 dark:text-brand-300">Default is 20% — adjust this to match your business.{targetMarginPct == null ? ' Using default assumption.' : ''}</p>
        </Card>

        <Card className="border-t-4 border-t-sky-600 p-5 sm:p-6">
          <h3 className="font-semibold text-gray-950 dark:text-brand-50">At Your Target Margin ({targetMarginLabel})</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Revenue and profit needed based on your current budgeted costs.</p>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-gray-600 dark:text-brand-200">Required Revenue</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatCurrency(summary.requiredRevenue)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-gray-600 dark:text-brand-200">Target Profit</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatCurrency(summary.targetNetProfit)}</dd></div>
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-3 dark:border-brand-600"><dt className="font-medium text-gray-700 dark:text-brand-100">Total Costs</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatCurrency(summary.totalPlannedCosts)}</dd></div>
          </dl>
          <p className="mt-5 border-t border-sky-100 pt-4 text-sm leading-6 text-gray-600 dark:border-brand-600 dark:text-brand-200">If you generated <span className="font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(summary.requiredRevenue)}</span> in revenue, you would cover your current budgeted costs and achieve a {targetMarginLabel} profit margin.</p>
        </Card>

        <Card className={`border-t-4 p-5 sm:p-6 ${meetsTarget ? 'border-t-emerald-600' : 'border-t-amber-500'}`}>
          <h3 className="font-semibold text-gray-950 dark:text-brand-50">Your Current Budget</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-brand-300">Based on your {formatCurrency(summary.revenue)} revenue target.</p>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-gray-600 dark:text-brand-200">Revenue</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatCurrency(summary.revenue)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-gray-600 dark:text-brand-200">Projected Profit</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{summary.currentProfit === null ? '—' : formatCurrency(summary.currentProfit)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-gray-600 dark:text-brand-200">Projected Margin</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatPercent(summary.currentProfitMarginPct)}</dd></div>
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-3 dark:border-brand-600"><dt className="font-medium text-gray-700 dark:text-brand-100">Additional Revenue Needed</dt><dd className="font-semibold tabular-nums text-gray-950 dark:text-brand-50">{formatCurrency(summary.additionalRevenueNeeded)}</dd></div>
          </dl>
          <div className={`mt-5 flex gap-2 border-t pt-4 text-sm ${meetsTarget ? 'border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300' : 'border-amber-200 text-amber-800 dark:border-amber-800 dark:text-amber-200'}`}>
            {meetsTarget ? <CheckCircle2 className="mt-0.5 shrink-0" size={17} /> : <AlertCircle className="mt-0.5 shrink-0" size={17} />}
            <p>{isAboveTarget ? <>Your current budget is above your <span className="font-semibold">{targetMarginLabel} target margin</span>.</> : isAtTarget ? <>Your current budget meets your <span className="font-semibold">{targetMarginLabel} target margin</span>.</> : <>You need <span className="font-semibold">{formatCurrency(summary.additionalRevenueNeeded)} more revenue</span> to reach your {targetMarginLabel} target margin.</>}</p>
          </div>
        </Card>
      </div>
    </section>
  </div>;
}