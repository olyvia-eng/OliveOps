import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Layers3 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import {
  buildCombinedBudgetViewModel,
  formatBudgetTabLabel,
  normalizeEquipmentCostType,
  toOptionLabel,
} from './combinedBudgetModel.js';

type CombinedBudgetTab = 'analysis' | 'revenue' | 'labour' | 'materials' | 'equipment' | 'subcontractors' | 'overhead';

const categoryTabs: Array<{ key: CombinedBudgetTab; label: string }> = [
  { key: 'revenue', label: 'Sales / Revenue' },
  { key: 'labour', label: 'Labour' },
  { key: 'materials', label: 'Materials' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'subcontractors', label: 'Subcontractors' },
  { key: 'overhead', label: 'Overhead' },
  { key: 'analysis', label: 'Analysis' },
];

export default function CombinedBudgetPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    budgets,
    budgetItems,
    labourBudgetPlans,
    revenueSalesGoals,
    employees,
  } = useStore();
  const [activeTab, setActiveTab] = useState<CombinedBudgetTab>('analysis');

  const selectedIds = useMemo(() => {
    const raw = searchParams.get('ids') ?? '';
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }, [searchParams]);

  const combined = useMemo(() => {
    return buildCombinedBudgetViewModel({
      budgetIds: selectedIds,
      budgets,
      budgetItems,
      labourBudgetPlans,
      revenueSalesGoals,
      employees,
    });
  }, [budgetItems, budgets, employees, labourBudgetPlans, revenueSalesGoals, selectedIds]);

  if (!combined.ok) {
    return (
      <div>
        <PageHeader
          title="Combined Budget"
          subtitle="Review a read-only rollup of multiple compatible budgets."
          action={<Button variant="secondary" onClick={() => navigate('/budgets')}><ArrowLeft size={16} /> Back to Budgets</Button>}
        />
        <EmptyState
          icon={<Layers3 aria-hidden="true" />}
          title="Combined Budget unavailable"
          description={combined.error}
          action={<Button onClick={() => navigate('/budgets')}>Go to Budgets</Button>}
        />
      </div>
    );
  }

  const selectedBudgetNames = combined.selectedBudgets.map((budget) => budget.name).join(' + ');
  const activeCategoryItems = activeTab === 'analysis'
    ? combined.combinedItems
    : activeTab === 'overhead'
      ? [
          ...combined.grouped.overhead,
          ...combined.grouped.marketing,
          ...combined.grouped.insurance,
          ...combined.grouped.other,
        ]
      : combined.grouped[activeTab];

  return (
    <div>
      <PageHeader
        title="Combined Budget"
        subtitle="Read-only reporting view across multiple existing budgets. Individual budgets remain the source of truth."
        action={<Button variant="secondary" onClick={() => navigate('/budgets')}><ArrowLeft size={16} /> Back to Budgets</Button>}
      />

      <div className="space-y-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label="Read Only" className="bg-gray-100 text-gray-700" />
          <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{combined.fiscalYear}</span>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">{combined.selectedBudgets.length} budgets included</span>
        </div>
        <Card className="p-4">
          <p className="text-sm font-semibold text-gray-900">{selectedBudgetNames}</p>
          <p className="text-xs text-gray-500 mt-1">Included Budgets</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {combined.selectedBudgets.map((budget) => (
              <span key={budget.id} className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                {budget.name} · {toOptionLabel(budget.division)}
              </span>
            ))}
          </div>
          {combined.hasPotentialOverlapWarning ? (
            <p className="mt-3 text-xs text-accent-700">Company-wide budgets are treated as independent records. If your company budget already manually includes division figures, combining it with division budgets may double count those amounts.</p>
          ) : null}
        </Card>
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="inline-flex border border-gray-200 rounded-xl p-1 bg-white min-w-max" role="tablist" aria-label="Combined budget sections">
          {categoryTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'analysis' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-xs text-gray-500">Revenue</p>
              <p className="text-xl font-bold text-brand-700">{formatCurrency(combined.combinedRevenueBudgeted)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-gray-500">Gross Profit</p>
              <p className={`text-xl font-bold ${combined.combinedGrossProfit >= 0 ? 'text-gray-900' : 'text-accent-700'}`}>{formatCurrency(combined.combinedGrossProfit)}</p>
              <p className="text-xs text-gray-500 mt-1">Margin {combined.combinedGrossMargin.toFixed(1)}%</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-gray-500">Expenses</p>
              <p className="text-xl font-bold text-accent-700">{formatCurrency(combined.combinedExpenseBudgeted)}</p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Category Analysis</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium text-right">Budgeted</th>
                    <th className="px-4 py-3 font-medium text-right">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {combined.categoryAnalysisRows.map((row) => (
                    <tr key={row.category} className="hover:bg-gray-50">
                      <td className="px-4 py-2 capitalize">{row.category}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(row.budgeted)}</td>
                      <td className="px-4 py-2 text-right text-gray-500">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Budget Item Traceability</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1080px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                    <th className="px-4 py-3 font-medium">Budget</th>
                    <th className="px-4 py-3 font-medium">Division</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Cost Code</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium text-right">Budgeted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {combined.combinedItems.map((item) => (
                    <tr key={`${item.sourceBudgetId}-${item.id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{item.sourceBudgetName}</td>
                      <td className="px-4 py-2 text-gray-700">{toOptionLabel(item.sourceBudgetDivision)}</td>
                      <td className="px-4 py-2 capitalize">{item.category}</td>
                      <td className="px-4 py-2 text-gray-700">{item.costCode?.trim() ? item.costCode : '—'}</td>
                      <td className="px-4 py-2 text-gray-700">{item.description}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(item.budgeted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'revenue' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-xs text-gray-500">Combined Revenue</p>
              <p className="text-xl font-bold text-brand-700">{formatCurrency(combined.totalsByCategory.revenue.budgeted)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-gray-500">Revenue Goal</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(combined.combinedRevenueGoal)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-gray-500">Revenue / Day Needed</p>
              <p className="text-xl font-bold text-gray-900">{combined.revenuePerDayNeeded === null ? 'Mixed working days' : formatCurrency(combined.revenuePerDayNeeded)}</p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Revenue Goal Traceability</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[880px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                    <th className="px-4 py-3 font-medium">Budget</th>
                    <th className="px-4 py-3 font-medium">Division</th>
                    <th className="px-4 py-3 font-medium text-right">Goal Revenue</th>
                    <th className="px-4 py-3 font-medium text-right">Working Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {combined.revenueGoalRows.map((row) => (
                    <tr key={row.budgetId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{row.budgetName}</td>
                      <td className="px-4 py-2 text-gray-700">{toOptionLabel(row.budgetDivision)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(row.goalRevenue)}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{row.workingDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'labour' ? (
        <div className="space-y-6">
          <Card className="p-4">
            <p className="text-xs text-gray-500">Total Annual Labour Cost</p>
            <p className="text-2xl font-bold text-brand-700">{formatCurrency(combined.labourTotals.annualLabourCost)}</p>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Employee Labour Planner</h2>
              <p className="text-sm text-gray-500 mt-1">Rows remain traceable to the source budget. This combined view is read only.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1280px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                    <th className="px-4 py-3 font-medium">Budget</th>
                    <th className="px-4 py-3 font-medium">Division</th>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Wage Type</th>
                    <th className="px-4 py-3 font-medium text-right">Hours / Year</th>
                    <th className="px-4 py-3 font-medium text-right">Billable %</th>
                    <th className="px-4 py-3 font-medium text-right">Annual Labour Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {combined.labourPlannerRows.map((row) => (
                    <tr key={`${row.budgetId}-${row.employee.id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{row.budgetName}</td>
                      <td className="px-4 py-2 text-gray-700">{toOptionLabel(row.budgetDivision)}</td>
                      <td className="px-4 py-2 text-gray-700">{row.employee.name}</td>
                      <td className="px-4 py-2 text-gray-700">{row.roleTitle}</td>
                      <td className="px-4 py-2 text-gray-700">{row.plan.compType === 'hourly' ? 'Hourly' : 'Salary'}</td>
                      <td className="px-4 py-2 text-right">{row.hoursPerYear.toFixed(0)}</td>
                      <td className="px-4 py-2 text-right">{row.billablePct.toFixed(1)}%</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatCurrency(row.totalEmployeeCostPerYear)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab !== 'analysis' && activeTab !== 'revenue' && activeTab !== 'labour' ? (
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-xs text-gray-500">{formatBudgetTabLabel(activeTab)}</p>
            <p className="text-xl font-bold text-gray-900">
              {activeTab === 'materials' ? formatCurrency(combined.totalsByCategory.materials.budgeted) : null}
              {activeTab === 'equipment' ? formatCurrency(combined.totalsByCategory.equipment.budgeted) : null}
              {activeTab === 'subcontractors' ? formatCurrency(combined.totalsByCategory.subcontractors.budgeted) : null}
              {activeTab === 'overhead' ? formatCurrency(combined.totalsByCategory.overhead.budgeted) : null}
            </p>
          </Card>

          {activeTab === 'equipment' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Financed Equipment</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(combined.equipmentByCostType.financed.budgeted)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Leased Equipment</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(combined.equipmentByCostType.leased.budgeted)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Owned Equipment</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(combined.equipmentByCostType.owned.budgeted)}</p>
              </Card>
            </div>
          ) : null}

          {activeCategoryItems.length === 0 ? (
            <EmptyState title={`No ${activeTab} items for ${combined.fiscalYear}`} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1080px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                      <th className="px-4 py-3 font-medium">Budget</th>
                      <th className="px-4 py-3 font-medium">Division</th>
                      <th className="px-4 py-3 font-medium">Cost Code</th>
                      <th className="px-4 py-3 font-medium">Description</th>
                      {activeTab === 'equipment' ? <th className="px-4 py-3 font-medium">Equipment Type</th> : null}
                      <th className="px-4 py-3 font-medium text-right">Budgeted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeCategoryItems.map((item) => (
                      <tr key={`${item.sourceBudgetId}-${item.id}`} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900">{item.sourceBudgetName}</td>
                        <td className="px-4 py-2 text-gray-700">{toOptionLabel(item.sourceBudgetDivision)}</td>
                        <td className="px-4 py-2 text-gray-700">{item.costCode?.trim() ? item.costCode : '—'}</td>
                        <td className="px-4 py-2 text-gray-700">{item.description}</td>
                        {activeTab === 'equipment' ? <td className="px-4 py-2 text-gray-700 capitalize">{normalizeEquipmentCostType(item.equipmentCostType).replace('_', ' ')}</td> : null}
                        <td className="px-4 py-2 text-right">{formatCurrency(item.budgeted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
