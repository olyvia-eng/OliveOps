import { Pencil, Trash2 } from 'lucide-react';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import DetailWorkspaceTabs from '../../components/detail-workspace/DetailWorkspaceTabs';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import type { Budget, BudgetGroup, BudgetItem, BudgetRate, EquipmentAsset, EquipmentBudgetAllocation } from '../../types';
import { formatCurrency } from '../../utils';
import { resolveEquipmentCostRate } from '../../utils/equipmentPricing';

export type EquipmentDetailTab = 'overview' | 'pricing' | 'budgets';

interface EquipmentDetailPanelProps {
  equipment: EquipmentAsset;
  activeTab: EquipmentDetailTab;
  expanded: boolean;
  budgets: Budget[];
  budgetGroups: BudgetGroup[];
  budgetItems: BudgetItem[];
  allocations: EquipmentBudgetAllocation[];
  pricingRate?: BudgetRate;
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
  budgetGroups,
  budgetItems,
  allocations,
  pricingRate,
  onTabChange,
  onEdit,
  onDelete,
  onExpand,
  onCollapse,
  onClose,
}: EquipmentDetailPanelProps) {
  const directCostRate = pricingRate?.unitCost ?? resolveEquipmentCostRate(equipment);
  const overheadRecovery = pricingRate?.overheadRecoveryPerUnit;
  const fullyBurdenedCost = directCostRate !== null && directCostRate !== undefined && overheadRecovery !== undefined
    ? directCostRate + overheadRecovery
    : null;
  const recommendedRate = pricingRate?.recommendedSellPrice ?? equipment.recommendedSellRate;
  const approvedRate = equipment.chargeOutRate;
  const fuelCostPerHour = Math.max(0, Number(equipment.averageFuelPrice ?? 0))
    * Math.max(0, Number(equipment.averageFuelBurnPerHour ?? 0));
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
                </dl>
              </Card>

              <Card className="p-4">
                <h2 className="font-semibold text-gray-900 dark:text-brand-50">Operating Costs</h2>
                <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
                  <dt className="text-gray-500 dark:text-brand-200">Fuel cost / hour</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{fuelCostPerHour > 0 ? formatCurrency(fuelCostPerHour) : 'Not recorded'}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">Fuel price / {equipment.fuelPriceUnit ?? 'unit'}</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{equipment.averageFuelPrice !== undefined ? formatCurrency(equipment.averageFuelPrice) : 'Not recorded'}</dd>
                  <dt className="text-gray-500 dark:text-brand-200">Fuel burn / hour</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{equipment.averageFuelBurnPerHour !== undefined ? `${equipment.averageFuelBurnPerHour} ${equipment.fuelPriceUnit ?? 'unit'}` : 'Not recorded'}</dd>
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
                    const months = allocation.monthsAllocated;
                    const operatingDays = hoursPerDay && sellableHours ? sellableHours / hoursPerDay : null;
                    const daysPerMonth = operatingDays && months > 0 ? operatingDays / months : null;
                    return (
                      <div key={allocation.id} className="rounded-lg border border-brand-100 p-3 dark:border-brand-600">
                        <p className="text-sm font-medium text-gray-900 dark:text-brand-50">{budget?.name ?? 'Unavailable budget'}</p>
                        <p className="mt-2 text-xs text-gray-500 dark:text-brand-200">{hoursPerDay ? `${hoursPerDay} hours/day` : 'Hours/day not recorded'} · {daysPerMonth ? `${daysPerMonth.toFixed(1)} days/month` : 'Days/month not calculated'} · {months} months/year</p>
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
          recommendedRate && recommendedRate > 0 ? (
            <div className={`grid gap-3 ${expanded ? 'sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-2'}`}>
              {[
                ['Direct Cost / Hour', directCostRate !== null && directCostRate !== undefined ? formatCurrency(directCostRate) : 'Not calculated'],
                ['Overhead Recovery', overheadRecovery !== undefined ? formatCurrency(overheadRecovery) : 'Not calculated'],
                ['Fully Burdened Cost', fullyBurdenedCost !== null ? formatCurrency(fullyBurdenedCost) : 'Not calculated'],
                ['Target Margin', pricingRate?.targetMarginPercent !== undefined ? `${pricingRate.targetMarginPercent}%` : 'Not set'],
                ['Recommended Charge-Out', formatCurrency(recommendedRate)],
                ['Approved Charge-Out', approvedRate && approvedRate > 0 ? formatCurrency(approvedRate) : 'Not approved'],
              ].map(([label, value]) => <Card key={label} className="p-4"><p className="text-xs text-gray-500 dark:text-brand-200">{label}</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{value}</p></Card>)}
            </div>
          ) : (
            <EmptyState
              title="Recommended pricing has not been calculated yet"
              description="Complete the budget overhead and target margin setup to generate a recommendation."
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
                        <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="px-4 py-3 font-medium">Budget</th><th className="px-4 py-3 font-medium">Months Used</th><th className="px-4 py-3 text-right font-medium">Annual Allocation</th><th className="px-4 py-3 text-right font-medium">Cost / hr</th></tr></thead>
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
