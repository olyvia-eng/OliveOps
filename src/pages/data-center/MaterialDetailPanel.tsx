import { Pencil, Trash2 } from 'lucide-react';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import DetailWorkspaceTabs from '../../components/detail-workspace/DetailWorkspaceTabs';
import { Button, Card, EmptyState } from '../../components/ui';
import type { MaterialCatalogItem } from '../../types';
import { formatCurrency } from '../../utils';

export type MaterialDetailTab = 'overview' | 'budgets';

export interface MaterialAllocationView {
  id: string;
  budgetId: string;
  divisionId: string;
  budgetName: string;
  divisionName: string;
  plannedQuantity: number;
  unit: string;
  unitCost: number;
}

interface Props {
  material: MaterialCatalogItem;
  allocations: MaterialAllocationView[];
  activeTab: MaterialDetailTab;
  expanded: boolean;
  onTabChange: (tab: MaterialDetailTab) => void;
  onEdit: () => void;
  onDelete: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'budgets', label: 'Budgets' },
] satisfies Array<{ key: MaterialDetailTab; label: string }>;

export default function MaterialDetailPanel({ material, allocations, activeTab, expanded, onTabChange, onEdit, onDelete, onExpand, onCollapse, onClose }: Props) {
  return <div className="min-w-0">
    <DetailWorkspaceHeader
      title={material.name}
      subtitle={`${formatCurrency(material.defaultUnitCost)}/${material.unit}`}
      actions={<Button type="button" variant="secondary" size="sm" onClick={onEdit}><Pencil size={14} /><span className="hidden sm:inline">Edit</span></Button>}
      expanded={expanded}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onClose={onClose}
    />
    <DetailWorkspaceTabs tabs={tabs} activeTab={activeTab} onChange={onTabChange} />

    <div className="space-y-4 p-4 sm:p-5">
      {activeTab === 'overview' ? <>
        <Card className="p-4">
          <h2 className="font-semibold text-gray-900 dark:text-brand-50">Material Details</h2>
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
            <dt className="text-gray-500 dark:text-brand-200">Material Name</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{material.name}</dd>
            <dt className="text-gray-500 dark:text-brand-200">Unit</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{material.unit}</dd>
            <dt className="text-gray-500 dark:text-brand-200">Default Unit Cost</dt><dd className="text-right font-medium text-gray-900 dark:text-brand-50">{formatCurrency(material.defaultUnitCost)}/{material.unit}</dd>
          </dl>
        </Card>
        {material.notes ? <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{material.notes}</p></Card> : null}
        <div className="flex justify-end"><Button type="button" variant="danger" size="sm" onClick={onDelete}><Trash2 size={14} />Delete Material</Button></div>
      </> : null}

      {activeTab === 'budgets' ? (
        allocations.length ? <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="px-4 py-3 font-medium">Budget</th><th className="px-4 py-3 font-medium">Division</th><th className="px-4 py-3 text-right font-medium">Planned Quantity</th><th className="px-4 py-3 text-right font-medium">Unit Cost</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{allocations.map((allocation) => <tr key={allocation.id}><td className="px-4 py-3 font-medium text-gray-900 dark:text-brand-50">{allocation.budgetName}</td><td className="px-4 py-3 text-gray-600 dark:text-brand-100">{allocation.divisionName}</td><td className="px-4 py-3 text-right text-gray-600 dark:text-brand-100">{allocation.plannedQuantity.toLocaleString()} {allocation.unit}</td><td className="px-4 py-3 text-right text-gray-600 dark:text-brand-100">{formatCurrency(allocation.unitCost)}/{allocation.unit}</td></tr>)}</tbody>
            </table>
          </div>
        </Card> : <EmptyState title="No budget allocations" description="This material is not linked to a Division planning item yet." />
      ) : null}
    </div>
  </div>;
}
