import { ArrowRight, FileDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Customer, Estimate } from '../../types';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import { Badge, Button, Card } from '../../components/ui';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import {
  computeEstimateSubtotal,
  computeEstimateTax,
  computeEstimateTotal,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';

interface EstimateDetailPanelProps {
  estimate: Estimate;
  customer: Customer | null;
  canViewFinancials: boolean;
  onCreateProposal: () => void;
  onClose: () => void;
}

export default function EstimateDetailPanel({
  estimate,
  customer,
  canViewFinancials,
  onCreateProposal,
  onClose,
}: EstimateDetailPanelProps) {
  const workAreas = normalizeEstimateWorkAreas(estimate);
  const subtotal = computeEstimateSubtotal(workAreas);
  const tax = computeEstimateTax(subtotal, estimate.taxRate);
  const total = computeEstimateTotal(subtotal, tax);
  const lineItemCount = workAreas.reduce((count, area) => count + area.lineItems.length, 0);
  const isConverted = estimate.status === 'converted';

  return (
    <div className="min-w-0">
      <DetailWorkspaceHeader
        title={estimate.title}
        subtitle={`${customer?.name ?? 'Unknown client'}${estimate.proposalNumber ? ` · ${estimate.proposalNumber}` : ''}`}
        status={<Badge label={estimate.status} className={statusColor[estimate.status]} />}
        actions={<div className="flex items-center gap-2"><Button type="button" variant="secondary" size="sm" onClick={onCreateProposal}><FileDown size={14} /><span className="hidden sm:inline">{isConverted ? 'View Proposal' : 'Proposal'}</span></Button>{isConverted && estimate.convertedToJobId ? <Link to={`/jobs/${estimate.convertedToJobId}`}><Button type="button" size="sm">Open Linked Job <ArrowRight size={14} /></Button></Link> : <Link to={`/estimates/${estimate.id}`}><Button type="button" size="sm">Open Estimate <ArrowRight size={14} /></Button></Link>}</div>}
        onClose={onClose}
      />

      <div className="space-y-4 p-4 sm:p-5">
        {isConverted ? <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800"><strong>Converted Estimate.</strong> This sold record is read-only; operational work continues on the linked Job.</div> : null}
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Work Areas</p><p className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{workAreas.length}</p></Card>
          <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Line Items</p><p className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{lineItemCount}</p></Card>
          {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Subtotal</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(subtotal)}</p></Card> : null}
          {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Total</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(total)}</p></Card> : null}
        </div>
        <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Estimate Information</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500 dark:text-brand-200">Customer</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{customer?.name ?? 'Not available'}</dd></div><div><dt className="text-gray-500 dark:text-brand-200">Proposal Number</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{estimate.proposalNumber || 'Not set'}</dd></div><div><dt className="text-gray-500 dark:text-brand-200">Property</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{estimate.propertyLabel || estimate.propertyAddressSnapshot || 'Not recorded'}</dd></div><div><dt className="text-gray-500 dark:text-brand-200">Valid Until</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{estimate.validUntil ? formatDate(estimate.validUntil) : 'Not set'}</dd></div></dl></Card>
        <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Scope</h2><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{estimate.description || 'No scope description recorded.'}</p>{workAreas.length ? <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">{workAreas.slice().sort((left, right) => left.sortOrder - right.sortOrder).map((area) => <li key={area.id} className="flex items-start justify-between gap-3 text-sm"><span className="font-medium text-gray-800 dark:text-brand-50">{area.name}</span><span className="shrink-0 text-xs text-gray-500 dark:text-brand-200">{area.lineItems.length} item{area.lineItems.length === 1 ? '' : 's'}</span></li>)}</ul> : null}</Card>
        {isConverted ? <Link to={`/estimates/${estimate.id}`} className="inline-flex text-sm font-medium text-brand-700 hover:text-brand-800">View historical Estimate</Link> : null}
      </div>
    </div>
  );
}