import { Fragment, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Card } from '../ui';
import { formatCurrency } from '../../utils';
import type { Budget, BudgetDivision } from '../../types';
import type { BudgetFinancials, DirectCostDetailCategory, DirectCostDetailItem, DivisionFinancials, OverheadDetailCategory, OverheadDetailItem } from '../../pages/budget/budgetFinancialModel';
import DivisionMonthlyComparison from './DivisionMonthlyComparison';

const amount = (value: number | null) => value === null ? '—' : formatCurrency(value);
const percentage = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

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

const overheadGroups: Array<{ category: OverheadDetailCategory; label: string }> = [
  { category: 'labour', label: 'Labour' },
  { category: 'equipment', label: 'Equipment' },
  { category: 'other', label: 'Other Overhead' },
];

const directCostGroups: Array<{ category: DirectCostDetailCategory; label: string }> = [
  { category: 'labour', label: 'Labour' },
  { category: 'equipment', label: 'Equipment' },
  { category: 'materials', label: 'Materials' },
  { category: 'subcontractors', label: 'Subcontractors' },
];

function DirectCostRows({ items, totals }: { items: DirectCostDetailItem[] | undefined; totals: Record<DirectCostDetailCategory, number> }) {
  const detailItems = items ?? [];
  return <>
    {directCostGroups.map((group) => <Fragment key={group.category}>
      <Row label={group.label} value={totals[group.category]} />
      {detailItems.filter((item) => item.category === group.category).map((item) => <tr key={`${item.category}:${item.itemId}`} className="text-xs text-gray-500 dark:text-brand-300"><td className="px-5 py-1 pl-12">{item.name}</td><td className="px-5 py-1 text-right tabular-nums">{amount(item.amount)}</td></tr>)}
    </Fragment>)}
    <Row label="Total Direct Costs" value={Object.values(totals).reduce((sum, value) => sum + value, 0)} total />
  </>;
}

function OverheadRows({ items, total }: { items: OverheadDetailItem[] | undefined; total: number }) {
  const detailItems = items ?? [];
  const detailTotal = detailItems.reduce((sum, item) => sum + item.amount, 0);
  const unitemizedAmount = total - detailTotal;

  return <>
    {overheadGroups.map((group) => {
      const groupItems = detailItems.filter((item) => item.category === group.category);
      if (groupItems.length === 0) return null;
      return <Fragment key={group.category}>
        <tr><td colSpan={2} className="px-8 pb-1 pt-3 text-xs font-semibold text-gray-500 dark:text-brand-300">{group.label}</td></tr>
        {groupItems.map((item) => <Row key={`${item.category}:${item.itemId}`} label={item.name} value={item.amount} />)}
      </Fragment>;
    })}
    {unitemizedAmount > 0.005 && <Row label="Legacy / unitemized overhead" value={unitemizedAmount} muted />}
    <Row label="Total Overhead" value={total} total />
  </>;
}

export function DivisionProfitLossView({ fiscalYear, financials }: { fiscalYear: string; financials: DivisionFinancials }) {
  return <div className="space-y-5">
    <div><p className="text-sm text-gray-500 dark:text-brand-300">{fiscalYear} Budget</p><h2 className="mt-1 text-2xl font-semibold text-gray-950 dark:text-brand-50">Profit &amp; Loss</h2></div>
    <IncompleteNotice missingCategories={financials.missingCategories} />
    <Card className="overflow-hidden"><table className="w-full text-sm"><tbody>
      <SectionHeading>Revenue</SectionHeading><Row label="Budgeted Revenue" value={financials.revenue} /><Row label="Total Revenue" value={financials.revenue} total />
      <SectionHeading>Direct Costs</SectionHeading><DirectCostRows items={financials.directCostItems} totals={{ labour: financials.directLabour, equipment: financials.directEquipment, materials: financials.materials, subcontractors: financials.subcontractors }} />
      <Row label="Gross Profit" value={financials.grossProfit} total /><MarginRow label="Gross Margin" value={financials.grossMargin} />
      <SectionHeading>Overhead</SectionHeading><OverheadRows items={financials.overheadItems} total={financials.totalOverhead} />
      <Row label="Net Profit" value={financials.operatingProfit} total /><MarginRow label="Net Profit Margin" value={financials.operatingMargin} />
    </tbody></table></Card>
  </div>;
}

export function BudgetProfitLossView({ budget, divisions, financials }: { budget: Budget; divisions: BudgetDivision[]; financials: BudgetFinancials }) {
  const [compareOpen, setCompareOpen] = useState(false);
  const missingCategories = [...new Set(financials.divisions.flatMap((division) => division.missingCategories))];
  return <div className="space-y-5">
    <div className="flex items-end justify-between gap-4"><div><p className="text-sm text-gray-500 dark:text-brand-300">{budget.fiscalYear} Budget</p><h2 className="mt-1 text-2xl font-semibold text-gray-950 dark:text-brand-50">Profit &amp; Loss</h2></div><Button type="button" variant="secondary" onClick={() => setCompareOpen(true)}>Compare</Button></div>
    <IncompleteNotice missingCategories={missingCategories} />
    <Card className="overflow-hidden"><table className="w-full text-sm"><tbody>
      <SectionHeading>Revenue</SectionHeading>{financials.divisions.map((division) => <Row key={division.divisionId} label={division.divisionName} value={division.revenue} />)}<Row label="Total Revenue" value={financials.revenue} total />
      <SectionHeading>Direct Costs</SectionHeading><DirectCostRows items={financials.directCostItems} totals={{ labour: financials.directLabour, equipment: financials.directEquipment, materials: financials.materials, subcontractors: financials.subcontractors }} />
      <Row label="Gross Profit" value={financials.grossProfit} total /><MarginRow label="Gross Margin" value={financials.grossMargin} />
      <SectionHeading>Overhead</SectionHeading><OverheadRows items={financials.overheadItems} total={financials.totalOverhead} />
      <Row label="Net Profit" value={financials.operatingProfit} total /><MarginRow label="Net Profit Margin" value={financials.operatingMargin} />
    </tbody></table></Card>
    <DivisionMonthlyComparison open={compareOpen} onClose={() => setCompareOpen(false)} budget={budget} divisions={divisions} />
  </div>;
}