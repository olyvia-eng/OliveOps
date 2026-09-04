import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Customer, Employee, Job } from '../../types';
import DetailWorkspaceHeader from '../../components/detail-workspace/DetailWorkspaceHeader';
import { Badge, Button, Card } from '../../components/ui';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import type { JobPerformance } from '../../utils/jobPerformanceModel.js';

interface JobRiskSummary {
  atRisk: boolean;
  warningBadges: Array<{ label: string; className: string }>;
}

interface JobDetailPanelProps {
  job: Job;
  customer: Customer | null;
  assignedEmployees: Employee[];
  risk?: JobRiskSummary;
  performance?: JobPerformance;
  canViewFinancials: boolean;
  canOpenJob?: boolean;
  onClose: () => void;
}

export default function JobDetailPanel({
  job,
  customer,
  assignedEmployees,
  risk,
  performance,
  canViewFinancials,
  canOpenJob = true,
  onClose,
}: JobDetailPanelProps) {
  const actualHours = performance?.labour.actual.hours;
  const estimatedHours = performance?.labour.estimated.hours;
  const hasEstimatedHours = Boolean(performance?.labour.estimated.hasData && estimatedHours && estimatedHours > 0);
  const progress = hasEstimatedHours && actualHours !== undefined ? Math.min(100, (actualHours / estimatedHours!) * 100) : 0;
  const workAreas = job.operationalWorkAreas?.slice().sort((left, right) => left.sortOrder - right.sortOrder) ?? [];

  return (
    <div className="min-w-0">
      <DetailWorkspaceHeader
        title={job.title}
        subtitle={`${customer?.name ?? 'Unknown client'}${job.jobNumber ? ` · Job #${job.jobNumber}` : ''}`}
        status={<div className="flex flex-wrap gap-2"><Badge label={job.status} className={statusColor[job.status]} />{risk?.atRisk ? <Badge label="At Risk" className="bg-accent-100 text-accent-700" /> : null}</div>}
        actions={canOpenJob ? <Link to={`/jobs/${job.id}`}><Button type="button" size="sm">Open Job <ArrowRight size={14} /></Button></Link> : undefined}
        onClose={onClose}
      />

      <div className="space-y-4 p-4 sm:p-5">
        {risk?.warningBadges.length ? <div className="flex flex-wrap gap-2">{risk.warningBadges.map((warning) => <Badge key={warning.label} label={warning.label} className={warning.className} />)}</div> : null}
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Labour Hours Used</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{actualHours === undefined ? 'Unavailable' : `${actualHours.toFixed(1)}${hasEstimatedHours ? ` / ${estimatedHours!.toFixed(1)} hr` : ' hr'}`}</p>{hasEstimatedHours ? <div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-brand-600"><div className={`h-1.5 rounded-full ${progress >= 100 ? 'bg-accent-600' : 'bg-brand-500'}`} style={{ width: `${progress}%` }} /></div> : <p className="mt-1 text-xs text-gray-400">No hours estimate</p>}</Card>
          <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Schedule</p><p className="mt-1 font-semibold text-gray-900 dark:text-brand-50">{formatDate(job.startDate)}</p><p className="text-xs text-gray-400 dark:text-brand-300">{job.endDate ? `to ${formatDate(job.endDate)}` : 'No end date'}</p></Card>
          {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Contract Value</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(job.contractValue)}</p></Card> : null}
          {canViewFinancials ? <Card className="p-3"><p className="text-xs text-gray-500 dark:text-brand-200">Actual Cost to Date</p><p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{performance ? formatCurrency(performance.costs.knownActualIncludingOverhead) : 'Unavailable'}</p><p className="text-xs text-gray-400">{performance?.costs.actualDirectComplete ? 'Recorded cost' : 'Known costs; data incomplete'}</p></Card> : null}
        </div>

        <Card className="p-4">
          <h2 className="font-semibold text-gray-900 dark:text-brand-50">Job Information</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-gray-500 dark:text-brand-200">Customer</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{customer?.name ?? 'Not available'}</dd></div>
            <div><dt className="text-gray-500 dark:text-brand-200">Property</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{job.propertyLabel || job.propertyAddressSnapshot || 'Not recorded'}</dd></div>
            <div><dt className="text-gray-500 dark:text-brand-200">Schedule Status</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{job.scheduleConfirmed ? 'Confirmed' : 'Needs scheduling'}</dd></div>
            <div><dt className="text-gray-500 dark:text-brand-200">Assigned Team</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{assignedEmployees.length ? assignedEmployees.map((employee) => employee.name).join(', ') : 'No employees assigned'}</dd></div>
          </dl>
          {job.sourceEstimateId ? <Link to={`/estimates/${job.sourceEstimateId}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">View Source Estimate <ArrowRight size={14} /></Link> : null}
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-gray-900 dark:text-brand-50">Work Areas</h2>
          {workAreas.length ? <ul className="mt-3 space-y-2">{workAreas.map((area) => <li key={area.id} className="flex items-start justify-between gap-3 text-sm"><span className="font-medium text-gray-800 dark:text-brand-50">{area.name}</span><Badge label={area.status.replace(/_/g, ' ')} className="bg-gray-100 text-gray-700" /></li>)}</ul> : job.workAreas?.length ? <p className="mt-2 text-sm text-gray-600 dark:text-brand-100">{job.workAreas.join(', ')}</p> : <p className="mt-2 text-sm text-gray-500 dark:text-brand-200">No work areas recorded.</p>}
        </Card>
      </div>
    </div>
  );
}