import { ArrowLeft, Plus } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui';
import { useStore } from '../../store';
import { formatCurrency, formatDate } from '../../utils';
import DivisionPlanningTab from '../../components/budget/DivisionPlanningTab';
import { calculateDivisionFinancials } from './budgetFinancialModel';
import { DivisionProfitLossView } from '../../components/budget/ProfitLossView';

type DivisionTab = 'overview' | 'labour' | 'equipment' | 'materials' | 'subcontractors' | 'overhead' | 'profit-loss';

const tabs: Array<{ key: DivisionTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'labour', label: 'Labour' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'materials', label: 'Materials' },
  { key: 'subcontractors', label: 'Subcontractors' },
  { key: 'overhead', label: 'Overhead' },
  { key: 'profit-loss', label: 'Profit & Loss' },
];

export default function DivisionWorkspacePage({ currentUserRole }: { currentUserRole: string }) {
  const { budgetId, divisionId } = useParams<{ budgetId: string; divisionId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { budgets, budgetDivisions, budgetDivisionPlanningItems } = useStore();
  const budget = budgets.find((item) => item.id === budgetId);
  const division = budgetDivisions.find((item) => item.id === divisionId && item.budgetId === budgetId);
  const requestedTab = searchParams.get('tab') ?? 'overview';
  const activeTab = (requestedTab === 'other-costs' ? 'overhead' : requestedTab) as DivisionTab;
  const activeTabLabel = tabs.find((item) => item.key === activeTab)?.label;
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin';
  const setTab = (tab: DivisionTab) => setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('tab', tab); return next; });

  if (!budget || !division) {
    return <Card><EmptyState title="Division not found" description="This Division may not belong to the selected Budget or is still syncing." action={<Button onClick={() => navigate(`/budgets/${budgetId}?tab=divisions`)}>Back to Divisions</Button>} /></Card>;
  }

  const dateRange = `${formatDate(budget.startDate ?? `${budget.fiscalYear}-01-01`)} – ${formatDate(budget.endDate ?? `${budget.fiscalYear}-12-31`)}`;
  const financials = calculateDivisionFinancials({ divisions: budgetDivisions.filter((item) => item.budgetId === budget.id), planningItems: budgetDivisionPlanningItems.filter((item) => item.budgetId === budget.id) }, division.id);

  return (
    <div>
      <nav className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-brand-300" aria-label="Breadcrumb">
        <Link to="/budgets" className="hover:text-brand-700">Budgets</Link><span>/</span><Link to={`/budgets/${budget.id}?tab=divisions`} className="hover:text-brand-700">{budget.name}</Link><span>/</span><span className="text-gray-800 dark:text-brand-100">{division.name}</span>{activeTab !== 'overview' && activeTabLabel ? <><span>/</span><span className="text-gray-800 dark:text-brand-100">{activeTabLabel}</span></> : null}
      </nav>
      <PageHeader title={division.name} subtitle={`${budget.name} · ${dateRange}`} action={<Button variant="secondary" onClick={() => navigate(`/budgets/${budget.id}?tab=divisions`)}><ArrowLeft size={15} /> Back to Divisions</Button>} />
      <div className="mb-4 flex items-center gap-2"><Badge label="Division" className="bg-brand-100 text-brand-700" /><Badge label={division.status} className={division.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'} /></div>
      <div className="mb-6 overflow-x-auto"><div className="inline-flex min-w-max rounded-xl border border-brand-100 bg-white p-1 dark:border-brand-600 dark:bg-brand-700" role="tablist">{tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => setTab(tab.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${activeTab === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-800'}`}>{tab.label}</button>)}</div></div>

      {activeTab === 'overview' ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Revenue Target" value={formatCurrency(financials.revenue)} /><Metric label="Direct Cost" value={financials.isComplete ? formatCurrency(financials.totalDirectCosts) : '—'} sub={financials.isComplete ? 'From Budget planning' : 'Budget incomplete'} /><Metric label="Gross Profit" value={financials.grossProfit === null ? '—' : formatCurrency(financials.grossProfit)} /><Metric label="Gross Margin" value={financials.grossMargin === null ? '—' : `${financials.grossMargin.toFixed(1)}%`} /></div><Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Cost Breakdown</h2><p className="mt-1 text-sm text-gray-500 dark:text-brand-300">All values use the same allocation-aware financial calculation as Profit &amp; Loss.</p><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">{tabs.filter((tab) => tab.key !== 'overview').map((tab) => <button key={tab.key} type="button" onClick={() => setTab(tab.key)} className="border-y border-brand-100 px-3 py-3 text-left text-sm font-medium text-gray-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-100 dark:hover:bg-brand-800">{tab.label}</button>)}</div></Card><Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Quick Actions</h2><div className="mt-3 flex flex-wrap gap-2">{tabs.filter((tab) => tab.key !== 'overview' && tab.key !== 'profit-loss').map((tab) => <Button key={tab.key} variant="secondary" onClick={() => setTab(tab.key)}><Plus size={14} /> Add {tab.label.replace(/s$/, '')}</Button>)}</div></Card></div> : null}

      {activeTab === 'labour' || activeTab === 'equipment' || activeTab === 'materials' || activeTab === 'subcontractors' || activeTab === 'overhead' ? <DivisionPlanningTab budget={budget} division={division} category={activeTab} canEdit={canEdit} /> : null}
      {activeTab === 'profit-loss' ? <DivisionProfitLossView fiscalYear={budget.fiscalYear} financials={financials} /> : null}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card className="p-4"><p className="text-xs font-medium uppercase text-gray-500 dark:text-brand-300">{label}</p><p className="mt-2 text-xl font-semibold text-gray-900 dark:text-brand-50">{value}</p>{sub ? <p className="mt-1 text-xs text-gray-400">{sub}</p> : null}</Card>;
}
