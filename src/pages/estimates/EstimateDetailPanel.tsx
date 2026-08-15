import { ChevronRight, FileDown, FileText, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Customer, Estimate } from '../../types';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import DetailWorkspaceTabs from '../../components/detail-workspace/DetailWorkspaceTabs';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import {
  computeEstimateSubtotal,
  computeEstimateTax,
  computeEstimateTotal,
  computeWorkAreaSubtotal,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';

export type EstimateDetailTab = 'overview' | 'scope' | 'proposal' | 'notes';

interface EstimateDetailPanelProps {
  estimate: Estimate;
  customer: Customer | null;
  activeTab: EstimateDetailTab;
  expanded: boolean;
  canViewFinancials: boolean;
  onTabChange: (tab: EstimateDetailTab) => void;
  onCreateProposal: () => void;
  onConvert: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'scope', label: 'Scope' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'notes', label: 'Notes' },
] satisfies Array<{ key: EstimateDetailTab; label: string }>;

export default function EstimateDetailPanel({
  estimate,
  customer,
  activeTab,
  expanded,
  canViewFinancials,
  onTabChange,
  onCreateProposal,
  onConvert,
  onExpand,
  onCollapse,
  onClose,
}: EstimateDetailPanelProps) {
  const workAreas = normalizeEstimateWorkAreas(estimate);
  const subtotal = computeEstimateSubtotal(workAreas);
  const tax = computeEstimateTax(subtotal, estimate.taxRate);
  const total = computeEstimateTotal(subtotal, tax);
  const lineItemCount = workAreas.reduce((count, area) => count + area.lineItems.length, 0);

  return (
    <div className="min-w-0">
      <DetailWorkspaceHeader
        title={estimate.title}
        subtitle={`${customer?.name ?? 'Unknown client'}${estimate.proposalNumber ? ` · ${estimate.proposalNumber}` : ''}`}
        status={<Badge label={estimate.status} className={statusColor[estimate.status]} />}
        actions={<div className="flex items-center gap-2"><Button type="button" variant="secondary" size="sm" onClick={onCreateProposal}><FileDown size={14} /><span className="hidden sm:inline">Proposal</span></Button><Link to={`/estimates/${estimate.id}`}><Button type="button" size="sm">Full Workspace <ChevronRight size={14} /></Button></Link></div>}
        expanded={expanded}
        onExpand={onExpand}
        onCollapse={onCollapse}
        onClose={onClose}
      />
      <DetailWorkspaceTabs tabs={tabs} activeTab={activeTab} onChange={onTabChange} />

      <div className="space-y-4 p-4 sm:p-5">
        {activeTab === 'overview' ? (
          <>
            <div className={`grid gap-3 ${expanded ? 'md:grid-cols-2 xl:grid-cols-4' : 'grid-cols-2'}`}>
              <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Work Areas</p><p className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{workAreas.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Line Items</p><p className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{lineItemCount}</p></Card>
              {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Subtotal</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(subtotal)}</p></Card> : null}
              {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Total</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(total)}</p></Card> : null}
            </div>
            <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Estimate Information</h2><div className={`mt-3 grid gap-3 text-sm ${expanded ? 'sm:grid-cols-2' : 'grid-cols-1'}`}><p className="text-gray-500 dark:text-brand-200">Client<br /><span className="font-medium text-gray-900 dark:text-brand-50">{customer?.name ?? 'Not available'}</span></p><p className="text-gray-500 dark:text-brand-200">Valid Until<br /><span className="font-medium text-gray-900 dark:text-brand-50">{estimate.validUntil ? formatDate(estimate.validUntil) : 'Not set'}</span></p><p className="text-gray-500 dark:text-brand-200">Property<br /><span className="font-medium text-gray-900 dark:text-brand-50">{estimate.propertyLabel || estimate.propertyAddressSnapshot || 'Not recorded'}</span></p><p className="text-gray-500 dark:text-brand-200">Progress<br /><span className="font-medium capitalize text-gray-900 dark:text-brand-50">{estimate.status}</span></p></div></Card>
            <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Description</h2><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{estimate.description || 'No description recorded.'}</p></Card>
            {estimate.status === 'accepted' ? <Button type="button" onClick={onConvert}><RefreshCw size={14} />Convert to Job</Button> : null}
            {estimate.convertedToJobId ? <Link to={`/jobs?job=${encodeURIComponent(estimate.convertedToJobId)}&workspace=panel`}><Button type="button" variant="secondary">Open Linked Job <ChevronRight size={14} /></Button></Link> : null}
          </>
        ) : null}

        {activeTab === 'scope' ? (
          workAreas.length ? <div className="space-y-3">{workAreas.slice().sort((left, right) => left.sortOrder - right.sortOrder).map((area) => <Card key={area.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-900 dark:text-brand-50">{area.name}</h2><p className="mt-1 text-sm text-gray-500 dark:text-brand-200">{area.description || 'No description.'}</p></div><span className="shrink-0 text-xs text-gray-500 dark:text-brand-200">{area.lineItems.length} items</span></div>{canViewFinancials ? <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(computeWorkAreaSubtotal(area))}</p> : null}<Link to={`/estimates/${estimate.id}/work-areas/${area.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-200">Edit Work Area <ChevronRight size={14} /></Link></Card>)}</div> : <EmptyState icon={<FileText />} title="No work areas" description="Open the full workspace to organize this estimate's scope." action={<Link to={`/estimates/${estimate.id}?tab=work-areas`}><Button variant="secondary">Open Scope Builder</Button></Link>} />
        ) : null}

        {activeTab === 'proposal' ? <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Proposal</h2><div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-brand-100"><p>Reference: <span className="font-medium text-gray-900 dark:text-brand-50">{estimate.proposalNumber || 'Not set'}</span></p><p>Client: <span className="font-medium text-gray-900 dark:text-brand-50">{customer?.name ?? 'Unknown client'}</span></p><p>Valid until: <span className="font-medium text-gray-900 dark:text-brand-50">{estimate.validUntil ? formatDate(estimate.validUntil) : 'Not set'}</span></p>{canViewFinancials ? <p>Total: <span className="font-medium text-gray-900 dark:text-brand-50">{formatCurrency(total)}</span></p> : null}</div><Button className="mt-4" type="button" onClick={onCreateProposal}><FileDown size={14} />Create Proposal</Button></Card> : null}

        {activeTab === 'notes' ? <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Estimate Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{estimate.notes || 'No notes recorded.'}</p></Card> : null}
      </div>
    </div>
  );
}