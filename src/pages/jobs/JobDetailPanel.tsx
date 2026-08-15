import { BriefcaseBusiness, ChevronRight, Clock3, FileText, Pencil, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Customer, Employee, Invoice, Job } from '../../types';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import DetailWorkspaceTabs from '../../components/detail-workspace/DetailWorkspaceTabs';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { formatCurrency, formatDate, statusColor } from '../../utils';

export type JobDetailTab = 'overview' | 'scope' | 'team' | 'invoices' | 'notes';

interface JobRiskSummary {
  atRisk: boolean;
  warningBadges: Array<{ label: string; className: string }>;
}

interface JobDetailPanelProps {
  job: Job;
  customer: Customer | null;
  assignedEmployees: Employee[];
  invoices: Invoice[];
  risk?: JobRiskSummary;
  activeTab: JobDetailTab;
  expanded: boolean;
  canViewFinancials: boolean;
  canEdit?: boolean;
  canOpenFullRecord?: boolean;
  onTabChange: (tab: JobDetailTab) => void;
  onEdit: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'scope', label: 'Scope' },
  { key: 'team', label: 'Team' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'notes', label: 'Notes' },
] satisfies Array<{ key: JobDetailTab; label: string }>;

export default function JobDetailPanel({
  job,
  customer,
  assignedEmployees,
  invoices,
  risk,
  activeTab,
  expanded,
  canViewFinancials,
  canEdit = true,
  canOpenFullRecord = true,
  onTabChange,
  onEdit,
  onExpand,
  onCollapse,
  onClose,
}: JobDetailPanelProps) {
  const actualCostTotal = job.actualCosts.reduce((total, cost) => total + cost.total, 0);
  const invoiceTotal = invoices.reduce((total, invoice) => total + invoice.amount, 0);
  const progress = job.estimatedHours > 0 ? Math.min(100, (job.actualHours / job.estimatedHours) * 100) : 0;

  return (
    <div className="min-w-0">
      <DetailWorkspaceHeader
        title={job.title}
        subtitle={`${customer?.name ?? 'Unknown client'}${job.jobNumber ? ` · Job #${job.jobNumber}` : ''}`}
        status={<div className="flex flex-wrap gap-2"><Badge label={job.status} className={statusColor[job.status]} />{risk?.atRisk ? <Badge label="At Risk" className="bg-accent-100 text-accent-700" /> : null}</div>}
        actions={(canEdit || canOpenFullRecord) ? <div className="flex items-center gap-2">{canEdit ? <Button type="button" variant="secondary" size="sm" onClick={onEdit}><Pencil size={14} /><span className="hidden sm:inline">Edit</span></Button> : null}{canOpenFullRecord ? <Link to={`/jobs/${job.id}`}><Button type="button" size="sm">Full Record <ChevronRight size={14} /></Button></Link> : null}</div> : undefined}
        expanded={expanded}
        onExpand={onExpand}
        onCollapse={onCollapse}
        onClose={onClose}
      />
      <DetailWorkspaceTabs tabs={tabs} activeTab={activeTab} onChange={onTabChange} />

      <div className="space-y-4 p-4 sm:p-5">
        {activeTab === 'overview' ? (
          <>
            {risk?.warningBadges.length ? <div className="flex flex-wrap gap-2">{risk.warningBadges.map((warning) => <Badge key={warning.label} label={warning.label} className={warning.className} />)}</div> : null}
            <div className={`grid gap-3 ${expanded ? 'md:grid-cols-2 xl:grid-cols-4' : 'grid-cols-2'}`}>
              <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Hours</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{job.actualHours.toFixed(1)} / {job.estimatedHours}h</p><div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-brand-600"><div className={`h-1.5 rounded-full ${progress >= 100 ? 'bg-accent-600' : 'bg-brand-500'}`} style={{ width: `${progress}%` }} /></div></Card>
              <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Schedule</p><p className="mt-1 font-semibold text-gray-900 dark:text-brand-50">{formatDate(job.startDate)}</p><p className="text-xs text-gray-400 dark:text-brand-300">{job.endDate ? `to ${formatDate(job.endDate)}` : 'No end date'}</p></Card>
              {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Contract</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(job.contractValue)}</p></Card> : null}
              {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Recorded Margin</p><p className={`mt-1 text-lg font-semibold ${job.contractValue - actualCostTotal >= 0 ? 'text-brand-700 dark:text-brand-100' : 'text-accent-700'}`}>{formatCurrency(job.contractValue - actualCostTotal)}</p></Card> : null}
            </div>
            <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Job Information</h2><div className={`mt-3 grid gap-3 text-sm ${expanded ? 'sm:grid-cols-2' : 'grid-cols-1'}`}><p className="text-gray-500 dark:text-brand-200">Client<br /><span className="font-medium text-gray-900 dark:text-brand-50">{customer?.name ?? 'Not available'}</span></p><p className="text-gray-500 dark:text-brand-200">Property<br /><span className="font-medium text-gray-900 dark:text-brand-50">{job.propertyLabel || job.propertyAddressSnapshot || 'Not recorded'}</span></p><p className="text-gray-500 dark:text-brand-200">Schedule<br /><span className="font-medium text-gray-900 dark:text-brand-50">{job.scheduleConfirmed ? 'Confirmed' : 'Needs scheduling'}</span></p><p className="text-gray-500 dark:text-brand-200">Source<br /><span className="font-medium text-gray-900 dark:text-brand-50">{job.sourceEstimateId ? 'Converted estimate' : 'Manual job'}</span></p></div></Card>
            <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Description</h2><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{job.description || 'No description recorded.'}</p></Card>
          </>
        ) : null}

        {activeTab === 'scope' ? (
          job.operationalWorkAreas?.length ? <div className="space-y-2">{job.operationalWorkAreas.slice().sort((left, right) => left.sortOrder - right.sortOrder).map((area) => <Card key={area.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-900 dark:text-brand-50">{area.name}</h2><p className="mt-1 text-sm text-gray-500 dark:text-brand-200">{area.description || 'No description.'}</p></div><Badge label={area.status} className="bg-gray-100 text-gray-700" /></div>{canViewFinancials ? <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-500 dark:text-brand-200"><p>Cost<br /><span className="font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(area.estimatedCost)}</span></p><p>Revenue<br /><span className="font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(area.estimatedRevenue)}</span></p><p>Margin<br /><span className="font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(area.estimatedMargin)}</span></p></div> : null}</Card>)}</div> : job.workAreas?.length ? <Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Work Areas</h2><div className="mt-3 flex flex-wrap gap-2">{job.workAreas.map((area) => <span key={area} className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-700 dark:bg-brand-600 dark:text-brand-100">{area}</span>)}</div></Card> : <EmptyState icon={<BriefcaseBusiness />} title="No work areas" description="This job does not have an organized scope yet." />
        ) : null}

        {activeTab === 'team' ? (
          assignedEmployees.length ? <div className={`grid gap-3 ${expanded ? 'sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>{assignedEmployees.map((employee) => <Card key={employee.id} className="p-4"><p className="font-medium text-gray-900 dark:text-brand-50">{employee.name}</p><p className="mt-1 text-sm capitalize text-gray-500 dark:text-brand-200">{employee.role.replace(/_/g, ' ')}</p></Card>)}</div> : <EmptyState icon={<Users />} title="No assigned team" description="No employees are assigned to this job." />
        ) : null}

        {activeTab === 'invoices' ? (
          invoices.length ? <div className="space-y-2">{canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Total Invoiced</p><p className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(invoiceTotal)}</p></Card> : null}{invoices.map((invoice) => <Card key={invoice.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-medium text-gray-900 dark:text-brand-50">{invoice.number}</p><p className="text-xs text-gray-500 dark:text-brand-200">{invoice.status} · Due {formatDate(invoice.dueDate)}</p></div>{canViewFinancials ? <span className="font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(invoice.amount)}</span> : null}</Card>)}</div> : <EmptyState icon={<FileText />} title="No invoices" description="No invoices are linked to this job." />
        ) : null}

        {activeTab === 'notes' ? <div className="space-y-4"><Card className="p-4"><h2 className="font-semibold text-gray-900 dark:text-brand-50">Job Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{job.notes || 'No notes recorded.'}</p></Card><Card className="p-4"><h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-brand-50"><Clock3 size={16} />Schedule Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-brand-100">{job.scheduleNotes || 'No schedule notes recorded.'}</p></Card></div> : null}
      </div>
    </div>
  );
}