import { Pencil, Trash2 } from 'lucide-react';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import DetailWorkspaceTabs from '../../components/detail-workspace/DetailWorkspaceTabs';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import type { Budget, BudgetDivision, BudgetGroup, BudgetItem, BudgetRate, EquipmentAsset, EquipmentBudgetAllocation } from '../../types';
import { formatCurrency } from '../../utils';
import { buildEquipmentCatalogPricingRows } from './equipmentCatalogPricingModel.js';

export type EquipmentDetailTab = 'overview' | 'pricing' | 'budgets';

interface EquipmentDetailPanelProps {
  equipment: EquipmentAsset;
  activeTab: EquipmentDetailTab;
  expanded: boolean;
  budgets: Budget[];
  budgetDivisions: BudgetDivision[];
  budgetGroups: BudgetGroup[];
  budgetItems: BudgetItem[];
  allocations: EquipmentBudgetAllocation[];
  pricingRates: BudgetRate[];
  onTabChange: (tab: EquipmentDetailTab) => void;
  onEdit: () => void;
  onDelete: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'budgets', label: 'Budgets' },
] satisfies Array<{ key: EquipmentDetailTab; label: string }>;

const ownershipLabel = (value: EquipmentAsset['costType']) => value.charAt(0).toUpperCase() + value.slice(1);
const valueOrDash = (value?: string | number | null) => value === undefined || value === null || value === '' ? '—' : String(value);

export default function EquipmentDetailPanel({
  equipment,
  activeTab,
  expanded,
  budgets,
  budgetDivisions,
  budgetGroups,
  budgetItems,
  allocations,
  pricingRates,
  onTabChange,
  onEdit,
  onDelete,
  onExpand,
  onCollapse,
  onClose,
}: EquipmentDetailPanelProps) {
  const pricingRows = buildEquipmentCatalogPricingRows({ pricingRates, budgetDivisions, budgets });
  const isOverheadEquipment = equipment.equipmentClassification === 'overhead';
  const allocatedRows = allocations.map((allocation) => {
    const budget = budgets.find((value) => value.id === allocation.budgetId);
    const budgetGroup = budgetGroups.find((value) => value.id === allocation.budgetGroupId);
    const budgetItem = budgetItems.find((value) => value.id === allocation.budgetItemId);
    const sellableHours = Math.max(0, budgetItem?.sellableHoursPerYear ?? 0);
    return {
      allocation,
      budget,
      budgetGroup,
      budgetItem,
      costRate: sellableHours > 0 ? (budgetItem?.budgeted ?? 0) / sellableHours : null,
    };
  });
  const utilizationRows = allocatedRows.filter((row) => row.budgetItem);

  return (
    <div className="min-w-0">
      <DetailWorkspaceHeader
        title={equipment.name}
        subtitle={(
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{equipment.serialNumber || 'No ID / SKU'}</span>
            <span aria-hidden="true">•</span>
            <span>{equipment.type || 'No type'}</span>
          </span>
        )}
        status={<Badge label={ownershipLabel(equipment.costType)} className="bg-accent-50 text-accent-700" />}
        actions={<Button type="button" variant="secondary" size="sm" onClick={onEdit}><Pencil size={14} /><span className="hidden sm:inline">Edit</span></Button>}
        expanded={expanded}
        onExpand={onExpand}
        onCollapse={onCollapse}
        onClose={onClose}
      />
      <DetailWorkspaceTabs tabs={tabs} activeTab={activeTab} onChange={onTabChange} />

      <div className="space-y-4 p-4 sm:p-5">
        {activeTab === 'overview' ? (
          <>
            <div className={`grid gap-4 ${expanded ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
              <Card className="p-4">
                <h2 className="font-semibold text-gray-900 dark:text-brand-50">Equipment Details</h2>
                <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
                  <dt className="text-gray-500 dark:text-brand-200">Name</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{equipment.name}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">ID / SKU</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{valueOrDash(equipment.serialNumber)}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">Type / Class</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{valueOrDash(equipment.type)}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">Ownership</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{ownershipLabel(equipment.costType)}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">Classification</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{isOverheadEquipment ? 'Overhead Equipment' : 'Billable Equipment'}</dd>
                </dl>
              </Card>

              <Card className="p-4">
                <h2 className="font-semibold text-gray-900 dark:text-brand-50">Operating Costs</h2>
                <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
                  <dt className="text-gray-500 dark:text-brand-200">Yearly fuel cost</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{equipment.yearlyFuelCost !== undefined ? formatCurrency(equipment.yearlyFuelCost) : 'Not recorded'}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">Annual insurance</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{equipment.yearlyInsuranceCost !== undefined ? formatCurrency(equipment.yearlyInsuranceCost) : 'Not recorded'}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">Annual maintenance</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{equipment.yearlyMaintenanceCost !== undefined ? formatCurrency(equipment.yearlyMaintenanceCost) : 'Not recorded'}</dd>
                </dl>
              </Card>
            </div>

            <Card className="p-4">
              <h2 className="font-semibold text-gray-900 dark:text-brand-50">Utilization</h2>
              {utilizationRows.length ? (
                <div className={`mt-3 grid gap-3 ${expanded ? 'md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
                  {utilizationRows.map(({ allocation, budget, budgetItem }) => {
                    const hoursPerDay = budgetItem?.equipmentHoursPerDay;
                    const sellableHours = budgetItem?.sellableHoursPerYear;
                    const operatingDays = hoursPerDay && sellableHours ? sellableHours / hoursPerDay : null;
                    return (
                      <div key={allocation.id} className="rounded-lg border border-brand-100 p-3 dark:border-brand-600">
                        <p className="text-sm font-medium text-gray-900 dark:text-brand-50">{budget?.name ?? 'Unavailable budget'}</p>
                        <p className="mt-2 text-xs text-gray-500 dark:text-brand-200">{hoursPerDay ? `${hoursPerDay} hours/day` : 'Hours/day not recorded'} · {operatingDays ? `${operatingDays.toFixed(1)} operating days/year` : 'Operating days not calculated'}</p>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="mt-3 text-sm text-gray-500 dark:text-brand-200">No utilization assumptions are linked to this equipment yet.</p>}
            </Card>

            {equipment.notes ? <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{equipment.notes}</p></Card> : null}
            <div className="flex justify-end"><Button type="button" variant="danger" size="sm" onClick={onDelete}><Trash2 size={14} />Delete Equipment</Button></div>
          </>
        ) : null}

        {activeTab === 'pricing' ? (
          isOverheadEquipment ? (
            <EmptyState title="Charge-out pricing is not available" description="Overhead equipment costs are recovered through overhead rather than estimate charge-out rates." />
          ) : pricingRows.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="px-4 py-3 font-medium">Division</th><th className="px-4 py-3 text-right font-medium">Equipment Cost</th><th className="px-4 py-3 text-right font-medium">Overhead Recovery</th><th className="px-4 py-3 text-right font-medium">Breakeven</th><th className="px-4 py-3 text-right font-medium">Target Profit</th><th className="px-4 py-3 text-right font-medium">Profit</th><th className="px-4 py-3 text-right font-medium">Calculated Rate</th><th className="px-4 py-3 text-right font-medium">Custom Rate</th><th className="px-4 py-3 text-right font-medium">Estimate Rate</th></tr></thead><tbody className="divide-y divide-gray-100">{pricingRows.map((row) => <tr key={`${row.rate.budgetId}:${row.rate.divisionId ?? 'legacy'}`}><td className="px-4 py-3 font-medium text-gray-900 dark:text-brand-50">{row.divisionName}</td><td className="px-4 py-3 text-right">{row.cost !== null && row.cost > 0 ? `${formatCurrency(row.cost)}/hr` : 'Unavailable'}</td><td className="px-4 py-3 text-right">{row.overheadRecovery !== null ? `${formatCurrency(row.overheadRecovery)}/hr` : 'Unavailable'}</td><td className="px-4 py-3 text-right">{row.breakeven !== null ? `${formatCurrency(row.breakeven)}/hr` : 'Unavailable'}</td><td className="px-4 py-3 text-right">{row.targetMarginPct !== null ? `${row.targetMarginPct.toFixed(2)}%` : 'Unavailable'}</td><td className="px-4 py-3 text-right">{row.profit !== null ? `${formatCurrency(row.profit)}/hr` : 'Unavailable'}</td><td className="px-4 py-3 text-right font-semibold">{row.calculatedRate !== null && row.calculatedRate > 0 ? `${formatCurrency(row.calculatedRate)}/hr` : 'Unavailable'}</td><td className="px-4 py-3 text-right">{row.customRate !== null ? `${formatCurrency(row.customRate)}/hr` : '—'}</td><td className="px-4 py-3 text-right font-semibold">{row.estimateRate !== null ? `${formatCurrency(row.estimateRate)}/hr` : 'Unavailable'}</td></tr>)}</tbody></table></div>
            </Card>
          ) : (
            <EmptyState
              title="Equipment pricing has not been calculated yet"
              description="Complete the Budget overhead and target profit setup to calculate an Estimate rate."
            />
          )
        ) : null}

        {activeTab === 'budgets' ? (
          allocatedRows.length ? (
            <div className="space-y-4">
              {budgetGroups.filter((group) => allocatedRows.some((row) => row.allocation.budgetGroupId === group.id)).map((group) => {
                const groupRows = allocatedRows.filter((row) => row.allocation.budgetGroupId === group.id);
                return (
                  <Card key={group.id} className="overflow-hidden">
                    <div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600"><h2 className="font-semibold text-gray-900 dark:text-brand-50">{group.name}</h2></div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[620px] text-sm">
                        <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="px-4 py-3 font-medium">Budget</th><th className="px-4 py-3 font-medium">Annual Cost Allocation</th><th className="px-4 py-3 text-right font-medium">Annual Allocation</th><th className="px-4 py-3 text-right font-medium">Cost / hr</th></tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {groupRows.map(({ allocation, budget, budgetItem, costRate }) => (
                            <tr key={allocation.id}><td className="px-4 py-3 font-medium text-gray-900 dark:text-brand-50">{budget?.name ?? 'Unavailable budget'}</td><td className="px-4 py-3 text-gray-600 dark:text-brand-100">{allocation.monthsAllocated} months</td><td className="px-4 py-3 text-right text-gray-600 dark:text-brand-100">{formatCurrency(budgetItem?.budgeted ?? 0)}</td><td className="px-4 py-3 text-right text-gray-600 dark:text-brand-100">{costRate !== null ? `${formatCurrency(costRate)}/hr` : 'Not calculated'}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : <EmptyState title="No budget allocations" description="This equipment has not been allocated to an operating budget yet." />
        ) : null}
      </div>
    </div>
  );
}
