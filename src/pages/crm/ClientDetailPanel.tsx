import { BriefcaseBusiness, FileText, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import type { Customer } from '../../types';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import DetailWorkspaceTabs from '../../components/detail-workspace/DetailWorkspaceTabs';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import { computeClientEstimateValue, type ClientDetailSummary } from './clientDetailSelectors';
import { customerLeadSourceLabel, customerStatusLabel } from '../../config/customer.js';

export type ClientDetailTab = 'overview' | 'estimates' | 'jobs' | 'notes';

interface ClientDetailPanelProps {
  customer: Customer;
  summary: ClientDetailSummary;
  activeTab: ClientDetailTab;
  expanded: boolean;
  canViewFinancials: boolean;
  onTabChange: (tab: ClientDetailTab) => void;
  onEdit: () => void;
  onNewEstimate: () => void;
  onSelectEstimate: (estimateId: string) => void;
  onSelectJob: (jobId: string) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'estimates', label: 'Estimates' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'notes', label: 'Notes' },
] satisfies Array<{ key: ClientDetailTab; label: string }>;

function formatAddress(property: Customer['properties'][number]): string {
  return [property.street, property.city, property.province, property.postalCode].filter(Boolean).join(', ');
}

export default function ClientDetailPanel({
  customer,
  summary,
  activeTab,
  expanded,
  canViewFinancials,
  onTabChange,
  onEdit,
  onNewEstimate,
  onSelectEstimate,
  onSelectJob,
  onExpand,
  onCollapse,
  onClose,
}: ClientDetailPanelProps) {
  const properties = customer.properties?.length ? customer.properties : (customer.address ? [customer.address] : []);

  return (
    <div className="min-w-0">
      <DetailWorkspaceHeader
        title={customer.name}
        subtitle={customer.company || 'Client account'}
        status={<Badge label={customerStatusLabel(customer.status)} className={statusColor[customer.status]} />}
        actions={<Button type="button" variant="secondary" size="sm" onClick={onEdit}><Pencil size={14} /><span className="hidden sm:inline">Edit Client</span></Button>}
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
              <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Estimates</p><p className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{summary.estimates.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Jobs</p><p className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{summary.jobs.length}</p><p className="text-xs text-gray-400 dark:text-brand-300">{summary.activeJobCount} active</p></Card>
              {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Contract Value</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(summary.contractValue)}</p></Card> : null}
              {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Invoiced</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(summary.invoiceValue)}</p></Card> : null}
            </div>

            <div className={`grid gap-4 ${expanded ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
              <Card className="p-4">
                <h2 className="font-semibold text-gray-900 dark:text-brand-50">Contact Information</h2>
                <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-brand-100">
                  {customer.email ? <a href={`mailto:${customer.email}`} className="flex items-center gap-2 hover:text-brand-600"><Mail size={15} />{customer.email}</a> : null}
                  {customer.phone ? <a href={`tel:${customer.phone}`} className="flex items-center gap-2 hover:text-brand-600"><Phone size={15} />{customer.phone}</a> : null}
                  {customer.company ? <p className="flex items-center gap-2"><BriefcaseBusiness size={15} />{customer.company}</p> : null}
                  {customer.leadSource ? <p><span className="text-gray-500 dark:text-brand-200">Original Lead Source:</span> {customerLeadSourceLabel(customer.leadSource, customer.leadSourceOther)}</p> : null}
                  {!customer.email && !customer.phone && !customer.company ? <p className="text-gray-400 dark:text-brand-300">No contact details recorded.</p> : null}
                </div>
              </Card>
              <Card className="p-4">
                <h2 className="font-semibold text-gray-900 dark:text-brand-50">Properties</h2>
                <div className="mt-3 space-y-3">
                  {properties.length ? properties.map((property, index) => (
                    <div key={`${property.street}-${index}`} className="flex gap-2 text-sm text-gray-600 dark:text-brand-100">
                      <MapPin size={15} className="mt-0.5 shrink-0 text-brand-500" />
                      <div><p className="font-medium text-gray-800 dark:text-brand-50">{property.nickname?.trim() || `Property ${index + 1}`}</p><p>{formatAddress(property) || 'Address not recorded'}</p></div>
                    </div>
                  )) : <p className="text-sm text-gray-400 dark:text-brand-300">No properties recorded.</p>}
                </div>
              </Card>
            </div>

            <Card className="p-4">
              <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Recent Work</h2><Button type="button" size="sm" onClick={onNewEstimate}><Plus size={14} />New Estimate</Button></div>
              <div className={`mt-3 grid gap-2 ${expanded ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                {summary.jobs.slice(0, 3).map((job) => <button type="button" key={job.id} onClick={() => onSelectJob(job.id)} className="rounded-lg border border-gray-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:hover:bg-brand-600"><span className="font-medium text-gray-900 dark:text-brand-50">{job.title}</span><span className="mt-1 block text-xs text-gray-500 dark:text-brand-200">{job.status.replace(/_/g, ' ')} · {formatDate(job.startDate)}</span></button>)}
                {summary.estimates.slice(0, Math.max(0, 4 - Math.min(3, summary.jobs.length))).map((estimate) => <button type="button" key={estimate.id} onClick={() => onSelectEstimate(estimate.id)} className="rounded-lg border border-gray-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:hover:bg-brand-600"><span className="font-medium text-gray-900 dark:text-brand-50">{estimate.title}</span><span className="mt-1 block text-xs text-gray-500 dark:text-brand-200">{estimate.status} · Updated {formatDate(estimate.updatedAt)}</span></button>)}
                {!summary.jobs.length && !summary.estimates.length ? <p className="text-sm text-gray-400 dark:text-brand-300">No related work yet.</p> : null}
              </div>
            </Card>
          </>
        ) : null}

        {activeTab === 'estimates' ? (
          summary.estimates.length ? <div className="space-y-2">{summary.estimates.map((estimate) => <button type="button" key={estimate.id} onClick={() => onSelectEstimate(estimate.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-brand-100 bg-white p-3 text-left hover:border-brand-300 dark:border-brand-600 dark:bg-brand-700 dark:hover:bg-brand-600"><div><p className="font-medium text-gray-900 dark:text-brand-50">{estimate.title}</p><p className="text-xs text-gray-500 dark:text-brand-200">{estimate.proposalNumber || 'No proposal number'} · {estimate.status}</p></div>{canViewFinancials ? <span className="shrink-0 text-sm font-semibold text-gray-800 dark:text-brand-50">{formatCurrency(computeClientEstimateValue(estimate))}</span> : null}</button>)}</div> : <EmptyState icon={<FileText />} title="No estimates" description="This client does not have any estimates yet." action={<Button onClick={onNewEstimate}><Plus size={14} />New Estimate</Button>} />
        ) : null}

        {activeTab === 'jobs' ? (
          summary.jobs.length ? <div className="space-y-2">{summary.jobs.map((job) => <button type="button" key={job.id} onClick={() => onSelectJob(job.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-brand-100 bg-white p-3 text-left hover:border-brand-300 dark:border-brand-600 dark:bg-brand-700 dark:hover:bg-brand-600"><div><p className="font-medium text-gray-900 dark:text-brand-50">{job.title}</p><p className="text-xs text-gray-500 dark:text-brand-200">{job.jobNumber ? `Job #${job.jobNumber} · ` : ''}{job.status.replace(/_/g, ' ')}</p></div>{canViewFinancials ? <span className="shrink-0 text-sm font-semibold text-gray-800 dark:text-brand-50">{formatCurrency(job.contractValue)}</span> : null}</button>)}</div> : <EmptyState icon={<BriefcaseBusiness />} title="No jobs" description="This client does not have any jobs yet." />
        ) : null}

        {activeTab === 'notes' ? <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Client Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{customer.notes || 'No notes recorded.'}</p>{customer.tags.length ? <div className="mt-4 flex flex-wrap gap-2">{customer.tags.map((tag) => <span key={tag} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-brand-600 dark:text-brand-100">{tag}</span>)}</div> : null}</Card> : null}
      </div>
    </div>
  );
}