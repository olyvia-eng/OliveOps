import { Card } from '../ui';
import { formatCurrency } from '../../utils';
import type { JobLabourSummary, JobLabourTotal, JobLabourVariance } from '../../utils/jobLabourSummary.js';

const hours = (value: number) => `${value.toFixed(1)} hr`;
const cost = (value: number | null) => value === null ? 'Unavailable' : formatCurrency(value);

function varianceLabel(variance: JobLabourVariance, kind: 'hours' | 'cost') {
  const value = variance[kind];
  if (value === null) return { text: 'Variance unavailable', className: 'text-gray-500' };
  const suffix = kind === 'hours' ? ' hr' : '';
  const amount = kind === 'cost' ? formatCurrency(Math.abs(value)) : `${Math.abs(value).toFixed(1)}${suffix}`;
  if (value > 0) return { text: `+${amount} over estimate`, className: 'text-accent-700' };
  if (value < 0) return { text: `-${amount} under estimate`, className: 'text-emerald-700' };
  return { text: 'On estimate', className: 'text-gray-500' };
}

function TotalColumn({ label, total, variance }: { label: string; total: JobLabourTotal; variance?: JobLabourVariance }) {
  const costVariance = variance ? varianceLabel(variance, 'cost') : null;
  const hoursVariance = variance ? varianceLabel(variance, 'hours') : null;
  return <div className="border-b border-gray-100 pb-4 last:border-0 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4 sm:last:border-r-0">
    <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
    <p className="mt-2 text-lg font-semibold text-gray-900">{total.hoursAvailable ? hours(total.hours) : 'Unavailable'}</p>
    <p className="text-lg font-semibold text-gray-900">{cost(total.cost)}</p>
    {total.unavailableReason ? <p className="mt-1 text-xs text-gray-500">{total.unavailableReason}</p> : null}
    {costVariance ? <p className={`mt-2 text-xs font-medium ${costVariance.className}`}>{costVariance.text}</p> : null}
    {hoursVariance ? <p className={`text-xs ${hoursVariance.className}`}>{hoursVariance.text}</p> : null}
  </div>;
}

export default function JobLabourSummaryCard({ summary, loading, error }: { summary: JobLabourSummary | null; loading: boolean; error: string }) {
  if (loading) return <Card className="p-4"><p className="text-sm text-gray-500">Calculating labour costs...</p></Card>;
  if (error) return <Card className="p-4"><h2 className="font-semibold text-gray-900">Labour</h2><p className="mt-2 text-sm text-accent-700">{error}</p></Card>;
  if (!summary) return null;

  return <Card className="p-4">
    <div><h2 className="font-semibold text-gray-900">Labour</h2><p className="text-sm text-gray-500">Estimated class plan compared with scheduled and actual Employee cost.</p></div>
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <TotalColumn label="Estimated" total={summary.estimated} />
      <TotalColumn label="Scheduled" total={summary.scheduled} variance={summary.variance.scheduledVsEstimated} />
      <TotalColumn label="Actual" total={summary.actual} variance={summary.variance.actualVsEstimated} />
    </div>

    {summary.byLabourClass.length ? <section className="mt-6 border-t border-gray-100 pt-4"><h3 className="text-sm font-semibold text-gray-900">By Labour Class</h3><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500"><th className="py-2 font-medium">Labour Class</th><th className="py-2 text-right font-medium">Estimated</th><th className="py-2 text-right font-medium">Scheduled</th><th className="py-2 text-right font-medium">Actual</th></tr></thead><tbody className="divide-y divide-gray-50">{summary.byLabourClass.map((row) => <tr key={row.id}><td className="py-2 font-medium text-gray-900">{row.name}</td><td className="py-2 text-right">{hours(row.estimatedHours)} · {formatCurrency(row.estimatedCost)}</td><td className="py-2 text-right">{hours(row.scheduledHours)} · {row.scheduledCostAvailable ? formatCurrency(row.scheduledCost) : 'Unavailable'}</td><td className="py-2 text-right">{hours(row.actualHours)} · {row.actualCostAvailable ? formatCurrency(row.actualCost) : 'Unavailable'}</td></tr>)}</tbody></table></div></section> : null}

    {(summary.scheduledEmployees.length || summary.actualEmployees.length) ? <section className="mt-6 grid gap-6 border-t border-gray-100 pt-4 lg:grid-cols-2">
      <div><h3 className="text-sm font-semibold text-gray-900">Scheduled Employees</h3>{summary.scheduledEmployees.length ? <div className="mt-2 divide-y divide-gray-50">{summary.scheduledEmployees.map((row) => <div key={row.employeeId} className="flex items-start justify-between gap-3 py-2 text-sm"><div><p className="font-medium text-gray-900">{row.employeeName}</p><p className="text-xs text-gray-500">{row.labourClassName}</p></div><p className="text-right">{hours(row.hours)}<br /><span className="text-xs text-gray-500">{row.costAvailable ? formatCurrency(row.cost) : 'Unavailable'}</span></p></div>)}</div> : <p className="mt-2 text-sm text-gray-500">No scheduled Employees.</p>}</div>
      <div><h3 className="text-sm font-semibold text-gray-900">Actual Employees</h3>{summary.actualEmployees.length ? <div className="mt-2 divide-y divide-gray-50">{summary.actualEmployees.map((row) => <div key={row.employeeId} className="flex items-start justify-between gap-3 py-2 text-sm"><div><p className="font-medium text-gray-900">{row.employeeName}</p><p className="text-xs text-gray-500">{row.labourClassName}</p></div><p className="text-right">{hours(row.hours)}<br /><span className="text-xs text-gray-500">{row.costAvailable ? formatCurrency(row.cost) : 'Unavailable'}</span></p></div>)}</div> : <p className="mt-2 text-sm text-gray-500">No closed Job Time Entries.</p>}</div>
    </section> : null}
  </Card>;
}