import { Pencil, Trash2 } from 'lucide-react';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import DetailWorkspaceTabs from '../../components/detail-workspace/DetailWorkspaceTabs';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import type { EquipmentAsset } from '../../types';
import { formatCurrency } from '../../utils';
import type { EquipmentBudgetRelationshipRow } from './equipmentBudgetRelationshipModel.js';

export type EquipmentDetailTab = 'overview' | 'budgets';

interface EquipmentDetailPanelProps {
  equipment: EquipmentAsset;
  activeTab: EquipmentDetailTab;
  expanded: boolean;
  budgetRows: EquipmentBudgetRelationshipRow[];
  onTabChange: (tab: EquipmentDetailTab) => void;
  onEdit: () => void;
  onDelete: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'budgets', label: 'Budgets' },
] satisfies Array<{ key: EquipmentDetailTab; label: string }>;

const ownershipLabel = (value: EquipmentAsset['costType']) => value.charAt(0).toUpperCase() + value.slice(1);
const valueOrDash = (value?: string | number | null) => value === undefined || value === null || value === '' ? '—' : String(value);

export default function EquipmentDetailPanel({
  equipment,
  activeTab,
  expanded,
  budgetRows,
  onTabChange,
  onEdit,
  onDelete,
  onExpand,
  onCollapse,
  onClose,
}: EquipmentDetailPanelProps) {
  const isOverheadEquipment = equipment.equipmentClassification === 'overhead';

  return (
    <div className="min-w-0">
      <DetailWorkspaceHeader
        title={equipment.name}
        subtitle={(
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>ID / SKU: {equipment.serialNumber || '—'}</span>
            <span aria-hidden="true">•</span>
            <span>Cost Code: {equipment.type || '—'}</span>
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
            <Card className="p-4">
              <h2 className="font-semibold text-gray-900 dark:text-brand-50">Equipment Details</h2>
              <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
                <dt className="text-gray-500 dark:text-brand-200">Name</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{equipment.name}</dd>
                <dt className="text-gray-500 dark:text-brand-200">ID / SKU</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{valueOrDash(equipment.serialNumber)}</dd>
                <dt className="text-gray-500 dark:text-brand-200">Cost Code</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{valueOrDash(equipment.type)}</dd>
                <dt className="text-gray-500 dark:text-brand-200">Ownership / Source</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{ownershipLabel(equipment.costType)}</dd>
                <dt className="text-gray-500 dark:text-brand-200">Classification</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{isOverheadEquipment ? 'Overhead Equipment' : 'Billable Equipment'}</dd>
                {equipment.costType === 'rental' ? <><dt className="text-gray-500 dark:text-brand-200">Rental Cost</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{formatCurrency(equipment.rentalCost ?? 0)} / {equipment.rentalUnit ?? 'hr'}</dd></> : null}
              </dl>
            </Card>

            {equipment.notes ? <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{equipment.notes}</p></Card> : null}
            <div className="flex justify-end"><Button type="button" variant="danger" size="sm" onClick={onDelete}><Trash2 size={14} />Delete Equipment</Button></div>
          </>
        ) : null}

        {activeTab === 'budgets' ? (
          budgetRows.length ? (
            <div className="space-y-4">
              {budgetRows.map((row) => (
                <Card key={row.id} className="overflow-hidden">
                  <div className="border-b border-brand-100 px-4 py-3 dark:border-brand-600">
                    <h2 className="font-semibold text-gray-900 dark:text-brand-50">{row.budget?.name ?? 'Unavailable Budget'}</h2>
                    {row.budget?.fiscalYear ? <p className="mt-0.5 text-xs text-gray-500 dark:text-brand-200">{row.budget.fiscalYear} Budget assumptions</p> : null}
                  </div>
                  <dl className={`grid gap-4 border-b border-gray-100 px-4 py-4 text-sm ${expanded ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2'}`}>
                    <div><dt className="text-gray-500 dark:text-brand-200">Annual Equipment Cost</dt><dd className="mt-1 font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(row.annualCost)}</dd></div>
                    <div><dt className="text-gray-500 dark:text-brand-200">Expected Operating Hours</dt><dd className="mt-1 font-semibold text-gray-900 dark:text-brand-50">{row.annualHours > 0 ? `${row.annualHours.toLocaleString()}/year` : 'Not planned'}</dd></div>
                    <div><dt className="text-gray-500 dark:text-brand-200">Operating Schedule</dt><dd className="mt-1 font-semibold text-gray-900 dark:text-brand-50">{row.hoursPerDay > 0 ? `${row.hoursPerDay} hours/day${row.operatingDays !== null ? ` · ${row.operatingDays.toFixed(1)} days/year` : ''}` : 'Not planned'}</dd></div>
                    <div><dt className="text-gray-500 dark:text-brand-200">Cost per Operating Hour</dt><dd className="mt-1 font-semibold text-gray-900 dark:text-brand-50">{row.costPerHour !== null ? formatCurrency(row.costPerHour) : 'Not calculated'}</dd></div>
                  </dl>
                  {expanded ? (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="px-4 py-3 font-medium">Division</th><th className="px-4 py-3 text-right font-medium">Months</th><th className="px-4 py-3 text-right font-medium">Allocated Annual Cost</th></tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {row.divisions.length ? row.divisions.map((allocation) => (
                          <tr key={`${row.id}:${allocation.divisionId ?? 'budget-wide'}`}><td className="px-4 py-3 font-medium text-gray-900 dark:text-brand-50">{allocation.division?.name ?? (allocation.divisionId ? '—' : 'Budget-wide')}</td><td className="px-4 py-3 text-right text-gray-600 dark:text-brand-100">{allocation.months}</td><td className="px-4 py-3 text-right text-gray-600 dark:text-brand-100">{formatCurrency(allocation.annualCost)}</td></tr>
                        )) : <tr><td className="px-4 py-3 text-gray-500 dark:text-brand-200" colSpan={3}>No Division month allocation recorded.</td></tr>}
                      </tbody>
                    </table>
                  ) : (
                    <div className="divide-y divide-gray-100 text-sm dark:divide-brand-600">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 bg-gray-50 px-4 py-2 text-xs font-medium uppercase text-gray-500"><span>Division</span><span>Months</span></div>
                      {row.divisions.length ? row.divisions.map((allocation) => (
                        <div key={`${row.id}:${allocation.divisionId ?? 'budget-wide'}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3">
                          <div className="min-w-0"><p className="font-medium text-gray-900 dark:text-brand-50">{allocation.division?.name ?? (allocation.divisionId ? '—' : 'Budget-wide')}</p><p className="mt-0.5 text-xs text-gray-500 dark:text-brand-200">{formatCurrency(allocation.annualCost)} allocated annual cost</p></div>
                          <span className="text-right text-gray-600 dark:text-brand-100">{allocation.months}</span>
                        </div>
                      )) : <p className="px-4 py-3 text-gray-500 dark:text-brand-200">No Division month allocation recorded.</p>}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          ) : <EmptyState title="Not used in a budget yet" description="Add this equipment to a budget when you are ready to plan its annual use." />
        ) : null}
      </div>
    </div>
  );
}
