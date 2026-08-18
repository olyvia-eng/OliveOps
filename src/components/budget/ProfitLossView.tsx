import { AlertCircle } from 'lucide-react';
import { Card } from '../ui';
import { formatCurrency } from '../../utils';
import type { BudgetFinancials, DivisionFinancials } from '../../pages/budget/budgetFinancialModel';

const amount = (value: number | null) => value === null ? '—' : formatCurrency(value);
const percentage = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

function Kpis({ revenue, grossProfit, grossMargin, operatingProfit, operatingMargin }: { revenue: number; grossProfit: number | null; grossMargin: number | null; operatingProfit: number | null; operatingMargin: number | null }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    <Kpi label="Revenue" value={formatCurrency(revenue)} />
    <Kpi label="Gross Profit" value={amount(grossProfit)} />
    <Kpi label="Gross Margin" value={percentage(grossMargin)} />
    <Kpi label="Operating Profit" value={amount(operatingProfit)} />
    <Kpi label="Operating Margin" value={percentage(operatingMargin)} />
  </div>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <Card className="p-4"><p className="text-xs font-medium uppercase text-gray-500 dark:text-brand-300">{label}</p><p className="mt-2 text-xl font-semibold text-gray-900 dark:text-brand-50">{value}</p></Card>;
}

function IncompleteNotice({ missingCategories }: { missingCategories: string[] }) {
  if (missingCategories.length === 0) return null;
  return <div className="flex gap-3 border-y border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"><AlertCircle className="mt-0.5 shrink-0" size={18} /><div><p className="text-sm font-semibold">Budget incomplete</p><p className="mt-0.5 text-sm">Complete {missingCategories.map((item) => item.charAt(0).toUpperCase() + item.slice(1)).join(', ')} planning before relying on profit or margin.</p></div></div>;
}

function SectionHeading({ children }: { children: string }) {
  return <tr><th colSpan={2} className="border-t border-gray-200 px-5 pb-2 pt-6 text-left text-xs font-semibold uppercase text-gray-500 dark:border-brand-600 dark:text-brand-300">{children}</th></tr>;
}

function Row({ label, value, total = false, muted = false }: { label: string; value: number | null; total?: boolean; muted?: boolean }) {
  return <tr className={total ? 'border-t-2 border-gray-300 font-semibold text-gray-950 dark:border-brand-500 dark:text-brand-50' : muted ? 'text-gray-400' : 'text-gray-700 dark:text-brand-100'}><td className={`px-5 py-2 ${total ? 'uppercase' : 'pl-8'}`}>{label}</td><td className="px-5 py-2 text-right tabular-nums">{amount(value)}</td></tr>;
}

function MarginRow({ label, value }: { label: string; value: number | null }) {
  return <tr className="font-medium text-gray-700 dark:text-brand-100"><td className="px-5 pb-4 pl-8 pt-1">{label}</td><td className="px-5 pb-4 pt-1 text-right tabular-nums">{percentage(value)}</td></tr>;
}

export function DivisionProfitLossView({ fiscalYear, financials }: { fiscalYear: string; financials: DivisionFinancials }) {
  return <div className="space-y-5">
    <div><p className="text-sm text-gray-500 dark:text-brand-300">{fiscalYear} Budget</p><h2 className="mt-1 text-2xl font-semibold text-gray-950 dark:text-brand-50">Profit &amp; Loss</h2></div>
    <Kpis revenue={financials.revenue} grossProfit={financials.grossProfit} grossMargin={financials.grossMargin} operatingProfit={financials.operatingProfitBeforeCompanyOverhead} operatingMargin={financials.operatingMarginBeforeCompanyOverhead} />
    <IncompleteNotice missingCategories={financials.missingCategories} />
    <Card className="overflow-hidden"><table className="w-full text-sm"><tbody>
      <SectionHeading>Revenue</SectionHeading><Row label="Budgeted Revenue" value={financials.revenue} /><Row label="Total Revenue" value={financials.revenue} total />
      <SectionHeading>Direct Costs</SectionHeading><Row label="Labour" value={financials.directLabour} /><Row label="Equipment" value={financials.directEquipment} /><Row label="Materials" value={financials.materials} /><Row label="Subcontractors" value={financials.subcontractors} /><Row label="Total Direct Costs" value={financials.totalDirectCosts} total />
      <Row label="Gross Profit" value={financials.grossProfit} total /><MarginRow label="Gross Margin" value={financials.grossMargin} />
      <SectionHeading>Overhead</SectionHeading><Row label="Allocated Labour Overhead" value={financials.overheadLabour} /><Row label="Allocated Equipment Overhead" value={financials.overheadEquipment} /><Row label="Division Overhead" value={financials.divisionOverhead} /><Row label="Allocated Company Overhead" value={null} muted /><Row label="Total Overhead before Company Overhead" value={financials.totalOverheadBeforeCompany} total />
      <Row label="Operating Profit before Company Overhead" value={financials.operatingProfitBeforeCompanyOverhead} total /><MarginRow label="Operating Margin before Company Overhead" value={financials.operatingMarginBeforeCompanyOverhead} />
    </tbody></table><p className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500 dark:border-brand-600 dark:text-brand-300">Company Overhead is not allocated to Divisions yet. No allocation method is assumed in this statement.</p></Card>
  </div>;
}

export function BudgetProfitLossView({ fiscalYear, financials, onDivisionClick }: { fiscalYear: string; financials: BudgetFinancials; onDivisionClick: (divisionId: string) => void }) {
  const missingCategories = [...new Set(financials.divisions.flatMap((division) => division.missingCategories))];
  return <div className="space-y-5">
    <div><p className="text-sm text-gray-500 dark:text-brand-300">{fiscalYear} Budget</p><h2 className="mt-1 text-2xl font-semibold text-gray-950 dark:text-brand-50">Profit &amp; Loss</h2></div>
    <Kpis revenue={financials.revenue} grossProfit={financials.grossProfit} grossMargin={financials.grossMargin} operatingProfit={financials.operatingProfit} operatingMargin={financials.operatingMargin} />
    <IncompleteNotice missingCategories={missingCategories} />
    <Card className="overflow-hidden"><table className="w-full text-sm"><tbody>
      <SectionHeading>Revenue</SectionHeading>{financials.divisions.map((division) => <Row key={division.divisionId} label={division.divisionName} value={division.revenue} />)}<Row label="Total Revenue" value={financials.revenue} total />
      <SectionHeading>Direct Costs</SectionHeading><Row label="Labour" value={financials.directLabour} /><Row label="Equipment" value={financials.directEquipment} /><Row label="Materials" value={financials.materials} /><Row label="Subcontractors" value={financials.subcontractors} /><Row label="Total Direct Costs" value={financials.totalDirectCosts} total />
      <Row label="Gross Profit" value={financials.grossProfit} total /><MarginRow label="Gross Margin" value={financials.grossMargin} />
      <SectionHeading>Overhead</SectionHeading><Row label="Overhead Labour" value={financials.overheadLabour} /><Row label="Overhead Equipment" value={financials.overheadEquipment} /><Row label="Division Overhead" value={financials.divisionOverhead} /><Row label="Company Overhead" value={financials.companyOverhead} /><Row label="Total Overhead" value={financials.totalOverhead} total />
      <Row label="Operating Profit" value={financials.operatingProfit} total /><MarginRow label="Operating Margin" value={financials.operatingMargin} />
    </tbody></table></Card>
    <Card className="overflow-hidden"><div className="border-b border-gray-200 px-5 py-3 dark:border-brand-600"><h3 className="font-semibold text-gray-950 dark:text-brand-50">Division Breakdown</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-brand-800 dark:text-brand-300"><tr><th className="px-5 py-3">Division</th><th className="px-5 py-3 text-right">Revenue</th><th className="px-5 py-3 text-right">Direct Cost</th><th className="px-5 py-3 text-right">Gross Profit</th><th className="px-5 py-3 text-right">Margin</th></tr></thead><tbody className="divide-y divide-gray-200 dark:divide-brand-600">{financials.divisions.map((division) => <tr key={division.divisionId} className="cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-800" onClick={() => onDivisionClick(division.divisionId)}><td className="px-5 py-3 font-medium text-brand-700 dark:text-brand-200">{division.divisionName}</td><td className="px-5 py-3 text-right tabular-nums">{formatCurrency(division.revenue)}</td><td className="px-5 py-3 text-right tabular-nums">{formatCurrency(division.totalDirectCosts)}</td><td className="px-5 py-3 text-right tabular-nums">{amount(division.grossProfit)}</td><td className="px-5 py-3 text-right tabular-nums">{percentage(division.grossMargin)}</td></tr>)}</tbody></table></div></Card>
  </div>;
}