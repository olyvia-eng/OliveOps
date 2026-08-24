import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../../store';
import { Card, Button, Badge, EmptyState, Modal, Select } from '../../components/ui';
import { statusColor, formatCurrency, formatDate, formatDateTime, durationHours } from '../../utils';
import ScheduleJobModal from '../../components/calendar/ScheduleJobModal';
import { resolveAttachmentUrl } from '../../utils/fileUpload';
import { HIGH_LABOR_VARIANCE_THRESHOLD_PCT, LOW_MARGIN_THRESHOLD_PCT } from '../../config/profitability';
import { ArrowLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { FormRecord, FormResponse, FormSubmission, JobStatus, TimeEntry } from '../../types';
import { classifyTrackedHoursByWorkType } from './profitability';
import { buildEffectiveTimeEntries } from '../../utils/timeCorrections';
import { formatScheduleTimeLabel, getAssignedEquipmentForJob } from '../../utils/jobSchedule';
import OutstandingTasks from '../home/OutstandingTasks';

type JobTab = 'info' | 'work-areas' | 'proposal' | 'project-management' | 'analysis' | 'invoices';
type TimeEntryPhotoRef = { key: string; fileId?: string; legacyUrl?: string };
type ScopedSubmission = FormSubmission & { employeeName: string; divisionName?: string };
type ScopedResponse = FormResponse & { fieldLabel: string; fieldType?: string; fieldOrder: number };
type SubmissionDetail = { job: { id: string; title: string }; form: FormRecord; submission: ScopedSubmission; responses: ScopedResponse[] };

interface Props {
  currentUserRole: string;
  currentUserId: string;
}

const normalizeEntryJobIds = (entry: { jobIds?: string[]; jobId?: string }): string[] => {
  return Array.isArray(entry.jobIds) && entry.jobIds.length > 0
    ? entry.jobIds
    : (entry.jobId ? [entry.jobId] : []);
};

const formatFormLabel = (value: string) => value
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const timeEntryPhotoRefs = (entry: TimeEntry): TimeEntryPhotoRef[] => {
  const fileIds = [...new Set([
    entry.clockInPhotoFileId,
    ...(entry.clockOutPhotoFileIds ?? []),
    entry.clockOutPhotoFileId,
    ...(entry.photoAttachmentFileIds ?? []),
    entry.photoAttachmentFileId,
  ].filter((value): value is string => Boolean(value)))];

  if (fileIds.length > 0) {
    return fileIds.map((fileId) => ({ key: `${entry.id}:${fileId}`, fileId }));
  }
  return entry.photoAttachmentUrl
    ? [{ key: `${entry.id}:legacy`, legacyUrl: entry.photoAttachmentUrl }]
    : [];
};

export default function JobDetailPage({ currentUserRole, currentUserId }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, customers, employees, crews, divisions, invoices, timeEntries, timeCorrections, equipmentAssets, forms, formSubmissions, tasks, updateJob, deleteTimeEntry, addTask, updateTask, deleteTask } = useStore();

  const job = jobs.find((j) => j.id === id);
  const canViewAnalysis = currentUserRole === 'owner' || currentUserRole === 'admin';
  const activeTab = (searchParams.get('tab') ?? 'info') as JobTab;
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [submissionForm, setSubmissionForm] = useState<FormRecord | null>(null);
  const [scopedSubmissions, setScopedSubmissions] = useState<ScopedSubmission[]>([]);
  const [submissionDetail, setSubmissionDetail] = useState<SubmissionDetail | null>(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [responseFileUrls, setResponseFileUrls] = useState<Record<string, string>>({});
  const [jobTaskFilter, setJobTaskFilter] = useState<'all' | 'completed'>('all');

  const customer = customers.find((c) => c.id === job?.customerId);
  const assignedEmployees = employees.filter((e) => job?.assignedEmployeeIds.includes(e.id));
  const assignedEquipment = useMemo(() => (job ? getAssignedEquipmentForJob(job, equipmentAssets) : []), [equipmentAssets, job]);
  const jobInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.jobId === id),
    [id, invoices]
  );
  const assignedForms = useMemo(() => forms
    .filter((form) => form.assignedTo === 'job' && form.assignmentValue === id)
    .sort((left, right) => left.name.localeCompare(right.name)), [forms, id]);
  const jobFormSubmissionCounts = useMemo(() => formSubmissions.reduce<Record<string, number>>((counts, submission) => {
    if (submission.jobId !== id) return counts;
    counts[submission.formId] = (counts[submission.formId] ?? 0) + 1;
    return counts;
  }, {}), [formSubmissions, id]);
  const jobTasks = useMemo(() => tasks.filter((task) => task.relatedEntityType === 'job' && task.relatedEntityId === id), [id, tasks]);
  const visibleJobTasks = useMemo(() => jobTasks.filter((task) => !task.parentTaskId && (jobTaskFilter === 'completed' ? task.status === 'completed' : task.status === 'open')), [jobTaskFilter, jobTasks]);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const canManageSchedule = currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'foreman';

  useEffect(() => {
    const validTabs: JobTab[] = ['info', 'work-areas', 'proposal', 'project-management', 'analysis', 'invoices'];
    const isAllowed = canViewAnalysis || activeTab !== 'analysis';
    if (!validTabs.includes(activeTab) || !isAllowed) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('tab', 'info');
        return next;
      });
    }
  }, [activeTab, canViewAnalysis, setSearchParams]);

  const setTab = (tab: JobTab) => {
    if (tab === 'analysis' && !canViewAnalysis) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', tab);
      return next;
    });
  };

  const effectiveTimeEntries = useMemo(
    () => buildEffectiveTimeEntries(timeEntries, timeCorrections),
    [timeEntries, timeCorrections]
  );

  const jobTimeEntries = useMemo(() => {
    if (!job || !id) return [];

    return effectiveTimeEntries.filter((entry) => normalizeEntryJobIds(entry).includes(id));
  }, [effectiveTimeEntries, job, id]);

  useEffect(() => {
    let cancelled = false;

    const resolveUrls = async () => {
      const pairs = await Promise.all(
        jobTimeEntries.flatMap((entry) => timeEntryPhotoRefs(entry).map(async (photo) => {
          const url = await resolveAttachmentUrl({ fileId: photo.fileId, legacyUrl: photo.legacyUrl });
          return [photo.key, url] as const;
        }))
      );

      if (cancelled) return;
      setAttachmentUrls(Object.fromEntries(pairs));
    };

    void resolveUrls();

    return () => {
      cancelled = true;
    };
  }, [jobTimeEntries]);

  const actualCostTotal = job ? job.actualCosts.reduce((s, c) => s + c.total, 0) : 0;
  const profit = job ? job.contractValue - actualCostTotal : 0;
  const marginPct = job && job.contractValue > 0 ? (profit / job.contractValue) * 100 : 0;
  const hoursPct = job && job.estimatedHours > 0 ? Math.min(100, (job.actualHours / job.estimatedHours) * 100) : 0;

  const profitability = useMemo(() => {
    if (!job) {
      return {
        trackedHours: 0,
        trackedBillableHours: 0,
        trackedNonBillableHours: 0,
        trackedLaborCost: 0,
        recordedLaborCosts: 0,
        recordedNonLaborCosts: 0,
        projectedCostFromTracking: 0,
        projectedProfitFromTracking: 0,
        projectedMarginFromTracking: 0,
        laborVariance: 0,
        laborVariancePct: 0,
      };
    }

    let trackedHours = 0;
    let trackedBillableHours = 0;
    let trackedNonBillableHours = 0;
    let trackedLaborCost = 0;

    for (const entry of jobTimeEntries) {
      const ids = normalizeEntryJobIds(entry);
      const divisor = ids.length > 0 ? ids.length : 1;
      const sharedHours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes) / divisor;
      const classification = classifyTrackedHoursByWorkType(entry.workType, sharedHours);

      trackedHours += sharedHours;
      trackedBillableHours += classification.billableHours;
      trackedNonBillableHours += classification.nonBillableHours;

      const rate = employees.find((employee) => employee.id === entry.employeeId)?.hourlyRate ?? 0;
      trackedLaborCost += sharedHours * rate;
    }

    const recordedLaborCosts = job.actualCosts
      .filter((cost) => cost.category === 'labour')
      .reduce((sum, cost) => sum + cost.total, 0);
    const recordedNonLaborCosts = job.actualCosts
      .filter((cost) => cost.category !== 'labour')
      .reduce((sum, cost) => sum + cost.total, 0);

    const projectedCostFromTracking = trackedLaborCost + recordedNonLaborCosts;
    const projectedProfitFromTracking = job.contractValue - projectedCostFromTracking;
    const projectedMarginFromTracking =
      job.contractValue > 0 ? (projectedProfitFromTracking / job.contractValue) * 100 : 0;
    const laborVariance = recordedLaborCosts - trackedLaborCost;
    const laborVariancePct = trackedLaborCost > 0 ? (laborVariance / trackedLaborCost) * 100 : 0;

    return {
      trackedHours,
      trackedBillableHours,
      trackedNonBillableHours,
      trackedLaborCost,
      recordedLaborCosts,
      recordedNonLaborCosts,
      projectedCostFromTracking,
      projectedProfitFromTracking,
      projectedMarginFromTracking,
      laborVariance,
      laborVariancePct,
    };
  }, [employees, job, jobTimeEntries]);
  const hasMeaningfulAnalysisData = Boolean(job && (actualCostTotal > 0 || job.actualHours > 0 || profitability.trackedHours > 0));

  const profitabilityWarnings = useMemo(() => {
    const warnings: Array<{ label: string; className: string }> = [];

    if (job && job.estimatedHours > 0 && job.actualHours > job.estimatedHours) {
      warnings.push({ label: 'Over Hours', className: 'bg-accent-100 text-accent-700' });
    }

    if (job && profitability.projectedMarginFromTracking < LOW_MARGIN_THRESHOLD_PCT) {
      warnings.push({ label: `Low Margin (<${LOW_MARGIN_THRESHOLD_PCT}%)`, className: 'bg-accent-50 text-accent-600' });
    }

    if (job && Math.abs(profitability.laborVariancePct) > HIGH_LABOR_VARIANCE_THRESHOLD_PCT) {
      warnings.push({ label: `Labor Variance High (>${HIGH_LABOR_VARIANCE_THRESHOLD_PCT}%)`, className: 'bg-brand-100 text-brand-700' });
    }

    return warnings;
  }, [job, profitability.laborVariancePct, profitability.projectedMarginFromTracking]);

  const employeeTimeEntryNotes = useMemo(
    () => jobTimeEntries.filter((entry) => entry.notes?.trim()),
    [jobTimeEntries]
  );

  const jobPhotos = useMemo(() => jobTimeEntries.flatMap((entry) => {
    const employeeName = employees.find((employee) => employee.id === entry.employeeId)?.name ?? 'Employee';
    return timeEntryPhotoRefs(entry)
      .map((photo) => ({ ...photo, url: attachmentUrls[photo.key], employeeName, clockIn: entry.clockIn }))
      .filter((photo): photo is typeof photo & { url: string } => Boolean(photo.url));
  }), [attachmentUrls, employees, jobTimeEntries]);

  const timeEntryTypeMeta = (entry: { workType?: string }) => {
    if (entry.workType === 'drive_time') {
      return { label: 'Drive Time', className: 'bg-accent-50 text-accent-600' };
    }
    if (entry.workType === 'non_billable') {
      return { label: 'Non-Billable', className: 'bg-brand-100 text-brand-700' };
    }
    return { label: 'Job Work', className: 'bg-brand-200 text-brand-800' };
  };

  const closeSubmissionWorkspace = () => {
    setSubmissionForm(null);
    setScopedSubmissions([]);
    setSubmissionDetail(null);
    setSubmissionError('');
    setResponseFileUrls({});
  };

  const openSubmissionWorkspace = async (form: FormRecord) => {
    if (!id) return;
    setSubmissionForm(form);
    setScopedSubmissions([]);
    setSubmissionDetail(null);
    setSubmissionError('');
    setSubmissionLoading(true);
    try {
      const response = await fetch(`/api/forms-review?jobId=${encodeURIComponent(id)}&formId=${encodeURIComponent(form.id)}`, { credentials: 'include' });
      const payload = await response.json() as { ok?: boolean; submissions?: ScopedSubmission[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load Form submissions.');
      setScopedSubmissions(payload.submissions ?? []);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Could not load Form submissions.');
    } finally {
      setSubmissionLoading(false);
    }
  };

  const openSubmissionDetail = async (submissionId: string) => {
    if (!id || !submissionForm) return;
    setSubmissionError('');
    setSubmissionLoading(true);
    try {
      const response = await fetch(`/api/forms-review?jobId=${encodeURIComponent(id)}&formId=${encodeURIComponent(submissionForm.id)}&id=${encodeURIComponent(submissionId)}`, { credentials: 'include' });
      const payload = await response.json() as ({ ok?: boolean; error?: string } & Partial<SubmissionDetail>);
      if (!response.ok || !payload.ok || !payload.job || !payload.form || !payload.submission || !payload.responses) {
        throw new Error(payload.error || 'Could not load the Form submission.');
      }
      const detail: SubmissionDetail = { job: payload.job, form: payload.form, submission: payload.submission, responses: payload.responses };
      setSubmissionDetail(detail);
      const fileIds = [...new Set(detail.responses.flatMap((answer) => answer.fileIds ?? []))];
      const pairs = await Promise.all(fileIds.map(async (fileId) => [fileId, await resolveAttachmentUrl({ fileId })] as const));
      setResponseFileUrls(Object.fromEntries(pairs));
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Could not load the Form submission.');
    } finally {
      setSubmissionLoading(false);
    }
  };

  if (!job) return <div className="p-8 text-gray-400">Job not found.</div>;

  const tabs: Array<{ key: JobTab; label: string; visible: boolean }> = [
    { key: 'info', label: 'Info', visible: true },
    { key: 'work-areas', label: 'Work Areas', visible: true },
    { key: 'proposal', label: 'Proposal', visible: true },
    { key: 'project-management', label: 'Project Management', visible: true },
    { key: 'analysis', label: 'Analysis', visible: canViewAnalysis },
    { key: 'invoices', label: 'Invoices', visible: true },
  ];

  return (
    <div>
      <div className="mb-4">
        <button onClick={() => navigate('/jobs')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 mb-2">
          <ArrowLeft size={15} /> Back to Jobs
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge label={job.status} className={statusColor[job.status]} />
              <h1 className="text-2xl font-bold text-gray-900">{job.title}</h1>
            </div>
            <p className="text-gray-500">{customer?.name ?? '—'} · {formatScheduleTimeLabel(job)} · Started {formatDate(job.startDate)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageSchedule ? <Button variant="secondary" onClick={() => setScheduleModalOpen(true)}>{job.scheduleConfirmed ? 'Edit Schedule' : 'Schedule Job'}</Button> : null}
            <Select
              value={job.status}
              onChange={(e) => { void updateJob(job.id, { status: e.target.value as JobStatus }); }}
            >
              {(['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'] as JobStatus[]).map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="inline-flex min-w-max rounded-xl border border-gray-200 bg-white p-1" role="tablist" aria-label="Job workspace sections">
          {tabs.filter((tab) => tab.visible).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'info' && (
        <Card className="p-4 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">Job Information</h2>
              <p className="text-sm text-gray-500">The current operational record for this project.</p>
            </div>
            {job.jobNumber ? <Badge label={`Job ${job.jobNumber}`} className="bg-brand-100 text-brand-700" /> : null}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <p className="text-gray-600">Customer: <span className="font-medium text-gray-900">{customer?.name ?? 'N/A'}</span></p>
            <p className="text-gray-600">Start Date: <span className="font-medium text-gray-900">{formatDate(job.startDate)}</span></p>
            <p className="text-gray-600">End Date: <span className="font-medium text-gray-900">{job.endDate ? formatDate(job.endDate) : 'Not set'}</span></p>
            <p className="text-gray-600">Time: <span className="font-medium text-gray-900">{formatScheduleTimeLabel(job)}</span></p>
            <p className="text-gray-600">Contract Value: <span className="font-medium text-gray-900">{formatCurrency(job.contractValue)}</span></p>
            <p className="text-gray-600">Source Estimate: <span className="font-medium text-gray-900">{job.sourceEstimateId ?? 'Manual Job'}</span></p>
            <p className="text-gray-600">Converted At: <span className="font-medium text-gray-900">{job.convertedFromEstimateAt ? formatDateTime(job.convertedFromEstimateAt) : 'N/A'}</span></p>
            <p className="text-gray-600">Property: <span className="font-medium text-gray-900">{job.propertyLabel ?? 'N/A'}</span></p>
            <p className="text-gray-600">Address Snapshot: <span className="font-medium text-gray-900">{job.propertyAddressSnapshot ?? 'N/A'}</span></p>
            <p className="text-gray-600">Schedule Status: <span className="font-medium text-gray-900">{job.scheduleConfirmed ? 'Scheduled' : 'Needs scheduling'}</span></p>
          </div>
          <div className="mt-4 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900">Description</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{job.description || 'No description.'}</p>
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-900">Schedule Notes</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{job.scheduleNotes?.trim() || 'No schedule notes.'}</p>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'work-areas' && (
        <div className="space-y-3">
          {job.operationalWorkAreas?.length ? job.operationalWorkAreas
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((workArea) => (
              <Card key={workArea.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-gray-900">{workArea.name}</h2>
                    <p className="mt-1 text-sm text-gray-500">{workArea.description || 'No description.'}</p>
                  </div>
                  <Badge label={workArea.status.replace(/_/g, ' ')} className="bg-gray-100 text-gray-700" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <p className="text-gray-500">Estimated Cost<br /><span className="font-semibold text-gray-900">{formatCurrency(workArea.estimatedCost)}</span></p>
                  <p className="text-gray-500">Estimated Revenue<br /><span className="font-semibold text-gray-900">{formatCurrency(workArea.estimatedRevenue)}</span></p>
                  <p className="text-gray-500">Estimated Margin<br /><span className="font-semibold text-gray-900">{formatCurrency(workArea.estimatedMargin)}</span></p>
                  <p className="text-gray-500">Line Items<br /><span className="font-semibold text-gray-900">{workArea.lineItems.length}</span></p>
                </div>
              </Card>
            )) : (
            job.workAreas?.length ? (
              <Card className="p-4">
                <h2 className="font-semibold text-gray-900">Work Areas</h2>
                <p className="mt-2 text-sm text-gray-600">{job.workAreas.join(', ')}</p>
              </Card>
            ) : (
              <Card className="p-4">
                <EmptyState
                  title="No work areas have been added to this job"
                  description="Work areas will appear here as the job scope is organized."
                />
              </Card>
            )
          )}
        </div>
      )}

      {activeTab === 'proposal' && (
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">Original Proposal Baseline</h2>
              <p className="text-sm text-gray-500">The immutable estimate snapshot captured when this job was created.</p>
            </div>
            {job.sourceEstimateId ? (
              <Link to={`/estimates/${job.sourceEstimateId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
                Open Estimate <ChevronRight size={14} />
              </Link>
            ) : null}
          </div>
          {job.originalEstimateSnapshot ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <p className="text-gray-500">Proposal<br /><span className="font-semibold text-gray-900">{job.originalEstimateSnapshot.proposalNumber ?? 'N/A'}</span></p>
                <p className="text-gray-500">Subtotal<br /><span className="font-semibold text-gray-900">{formatCurrency(job.originalEstimateSnapshot.subtotal)}</span></p>
                <p className="text-gray-500">Tax<br /><span className="font-semibold text-gray-900">{formatCurrency(job.originalEstimateSnapshot.taxAmount)}</span></p>
                <p className="text-gray-500">Total<br /><span className="font-semibold text-gray-900">{formatCurrency(job.originalEstimateSnapshot.total)}</span></p>
              </div>
              <div className="mt-5 space-y-2">
                {job.originalEstimateSnapshot.workAreas
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((workArea) => (
                    <div key={workArea.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-gray-900">{workArea.name}</p>
                        <p className="text-xs text-gray-500">Estimated Revenue {formatCurrency(workArea.estimatedRevenue)}</p>
                      </div>
                      {workArea.description ? <p className="mt-1 text-xs text-gray-600">{workArea.description}</p> : null}
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-gray-500">This job was created without an estimate snapshot.</p>
          )}
        </Card>
      )}

      {activeTab === 'analysis' && canViewAnalysis && (
        !hasMeaningfulAnalysisData ? (
          <Card className="p-4">
            <EmptyState
              title="Job analysis will appear as costs and progress are recorded"
              description="Record time, actual costs, and job progress before relying on margin analysis here."
            />
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card className="p-4"><p className="text-xs text-gray-500">Contract Value</p><p className="text-xl font-bold text-gray-900">{formatCurrency(job.contractValue)}</p></Card>
              <Card className="p-4"><p className="text-xs text-gray-500">Actual Costs</p><p className="text-xl font-bold text-gray-900">{formatCurrency(actualCostTotal)}</p></Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Gross Profit</p>
                <p className={`text-xl font-bold ${profit >= 0 ? 'text-brand-700' : 'text-accent-700'}`}>{formatCurrency(profit)}</p>
                <p className="text-xs text-gray-400">{marginPct.toFixed(1)}% margin</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">Hours</p>
                <p className="text-xl font-bold text-gray-900">{job.actualHours.toFixed(1)}/{job.estimatedHours}h</p>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100"><div className={`h-1.5 rounded-full ${hoursPct >= 100 ? 'bg-accent-600' : 'bg-brand-500'}`} style={{ width: `${hoursPct}%` }} /></div>
              </Card>
            </div>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900">Job Profitability (Tracked)</h2>
                  {profitabilityWarnings.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{profitabilityWarnings.map((warning) => <Badge key={warning.label} label={warning.label} className={warning.className} />)}</div>}
                </div>
                <span className="text-xs text-gray-500">Uses shared hours for multi-job time entries</span>
              </div>
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div><p className="text-gray-500">Tracked Hours</p><p className="font-semibold text-gray-900">{profitability.trackedHours.toFixed(2)}h</p><p className="text-xs text-gray-400">Billable {profitability.trackedBillableHours.toFixed(2)}h · Non-billable {profitability.trackedNonBillableHours.toFixed(2)}h</p></div>
                <div><p className="text-gray-500">Tracked Labor Cost</p><p className="font-semibold text-gray-900">{formatCurrency(profitability.trackedLaborCost)}</p><p className="text-xs text-gray-400">Recorded labor costs: {formatCurrency(profitability.recordedLaborCosts)}</p><p className={`mt-1 text-xs ${profitability.laborVariance >= 0 ? 'text-accent-700' : 'text-brand-700'}`}>Variance: {formatCurrency(profitability.laborVariance)} ({profitability.laborVariancePct.toFixed(1)}%)</p></div>
                <div><p className="text-gray-500">Projected Cost (Tracked)</p><p className="font-semibold text-gray-900">{formatCurrency(profitability.projectedCostFromTracking)}</p><p className="text-xs text-gray-400">Includes non-labor costs: {formatCurrency(profitability.recordedNonLaborCosts)}</p></div>
                <div><p className="text-gray-500">Projected Profit (Tracked)</p><p className={`font-semibold ${profitability.projectedProfitFromTracking >= 0 ? 'text-brand-700' : 'text-accent-700'}`}>{formatCurrency(profitability.projectedProfitFromTracking)}</p><p className="text-xs text-gray-400">{profitability.projectedMarginFromTracking.toFixed(1)}% margin</p></div>
              </div>
            </Card>
          </div>
        )
      )}

      {activeTab === 'project-management' && (
        <div className="space-y-6">
          <OutstandingTasks
            heading="Job Tasks"
            subtitle="Actions tied directly to this job"
            tasks={visibleJobTasks}
            allTasks={jobTasks}
            filter={jobTaskFilter}
            filterOrder={['all', 'completed']}
            filterLabels={job.taskHeaderLabels}
            customTaskTabs={[]}
            expanded
            addRequest={0}
            allowCustomTabs={false}
            onFilterChange={(filter) => setJobTaskFilter(filter === 'completed' ? 'completed' : 'all')}
            onRenameFilter={async (filter, name) => {
              if (filter !== 'all' && filter !== 'completed') return;
              await updateJob(job.id, { taskHeaderLabels: { ...job.taskHeaderLabels, [filter]: name } });
            }}
            onFilterOrderChange={() => undefined}
            onCreateCustomTab={() => ({ ok: false, error: 'Job task categories are not enabled.' })}
            onRenameCustomTab={() => ({ ok: false, error: 'Job task categories are not enabled.' })}
            onDeleteCustomTab={() => false}
            onViewAll={() => undefined}
            onAdd={async (input) => {
              const result = await addTask({
                ...input,
                description: '',
                assignedUserId: currentUserId,
                status: 'open',
                relatedEntityType: 'job',
                relatedEntityId: job.id,
                createdByUserId: currentUserId,
              });
              return result.ok;
            }}
            onUpdate={async (taskId, input) => (await updateTask(taskId, input)).ok}
            onToggle={async (task) => {
              await updateTask(task.id, task.status === 'completed'
                ? { status: 'open', completedAt: undefined }
                : { status: 'completed', completedAt: new Date().toISOString() });
            }}
            onDelete={async (taskId) => { await deleteTask(taskId); }}
            onDismissCompletedToday={() => undefined}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="font-semibold">Notes</h2>
              <div className="mt-3 space-y-3">
                {job.notes?.trim() ? <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs font-semibold text-gray-500">Job Note</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{job.notes}</p></div> : null}
                {employeeTimeEntryNotes.map((entry) => {
                  const employee = employees.find((item) => item.id === entry.employeeId);
                  return <div key={entry.id} className="rounded-lg border border-gray-100 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-gray-900">{employee?.name ?? 'Employee'}</p><p className="text-xs text-gray-400">{formatDateTime(entry.clockIn)}</p></div><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{entry.notes}</p></div>;
                })}
                {!job.notes?.trim() && employeeTimeEntryNotes.length === 0 ? <p className="text-sm text-gray-400">No job or employee notes yet.</p> : null}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="font-semibold">Photos</h2>
              {jobPhotos.length === 0 ? <p className="mt-3 text-sm text-gray-400">No photos uploaded for this job.</p> : (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{jobPhotos.map((photo) => <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border border-gray-100 bg-gray-50"><img src={photo.url} alt={`Job upload from ${photo.employeeName}`} className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" /><div className="p-2"><p className="truncate text-xs font-medium text-gray-700">{photo.employeeName}</p><p className="text-[11px] text-gray-400">{formatDateTime(photo.clockIn)}</p></div></a>)}</div>
              )}
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
              <div>
                <h2 className="font-semibold">Assigned Forms</h2>
                <p className="text-sm text-gray-500">Forms configured specifically for this job.</p>
              </div>
              <Link to="/operations/forms"><Button variant="secondary" size="sm">Manage Forms <ChevronRight size={13} /></Button></Link>
            </div>
            {assignedForms.length === 0 ? <p className="p-4 text-sm text-gray-400">No forms are assigned to this job.</p> : (
              <ul className="divide-y divide-gray-50">{assignedForms.map((form) => {
                const submissionCount = jobFormSubmissionCounts[form.id] ?? 0;
                return <li key={form.id} className="flex flex-wrap items-start justify-between gap-3 p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-gray-900">{form.name}</p><Badge label={formatFormLabel(form.status)} className={form.status === 'active' ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'} /></div><p className="mt-1 text-sm text-gray-500">{form.description || `${formatFormLabel(form.category)} form`}</p><p className="mt-2 text-xs text-gray-400">{form.trigger.length > 0 ? form.trigger.map(formatFormLabel).join(' · ') : 'No trigger configured'}</p></div><div className="shrink-0 text-right">{submissionCount > 0 ? <Button type="button" variant="secondary" size="sm" onClick={() => void openSubmissionWorkspace(form)}>View Submissions ({submissionCount}) <ChevronRight size={13} /></Button> : <><p className="text-sm font-semibold text-gray-900">0 submissions</p><p className="text-xs text-gray-400">No submissions yet</p></>}</div></li>;
              })}</ul>
            )}
          </Card>

          <Card>
            <div className="border-b border-gray-100 p-4"><h2 className="font-semibold">Time Entries</h2></div>
            {jobTimeEntries.length === 0 ? <p className="p-4 text-sm text-gray-400">No time entries for this job.</p> : (
              <ul className="divide-y divide-gray-50">{jobTimeEntries.map((entry) => {
                const employee = employees.find((item) => item.id === entry.employeeId);
                const hours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
                const typeMeta = timeEntryTypeMeta(entry);
                return <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="flex items-center gap-2 font-medium"><span>{employee?.name ?? '—'}</span><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${typeMeta.className}`}>{typeMeta.label}</span></p><p className="text-xs text-gray-400">{formatDateTime(entry.clockIn)} → {entry.clockOut ? formatDateTime(entry.clockOut) : 'Active'}</p></div><div className="flex items-center gap-2"><span className="font-semibold text-brand-600">{hours.toFixed(2)}h</span><button onClick={() => deleteTimeEntry(entry.id)} aria-label={`Delete time entry for ${employee?.name ?? 'employee'}`} className="text-gray-300 hover:text-accent-700"><Trash2 size={14} /></button></div></li>;
              })}</ul>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Assigned Employees</h2>
              {assignedEmployees.length === 0 ? <p className="text-sm text-gray-400">No employees assigned.</p> : (
                <ul className="space-y-2">{assignedEmployees.map((employee) => <li key={employee.id} className="flex items-center justify-between text-sm"><span>{employee.name}</span><span className="text-gray-400 capitalize">{employee.role.replace('_', ' ')} · ${employee.hourlyRate}/hr</span></li>)}</ul>
              )}
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Assigned Equipment</h2>
              {assignedEquipment.length === 0 ? <p className="text-sm text-gray-400">No equipment assigned.</p> : (
                <ul className="space-y-2">{assignedEquipment.map((asset) => <li key={asset.id} className="flex items-center justify-between text-sm"><span>{asset.name}</span><span className="text-gray-400">{asset.type}</span></li>)}</ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'invoices' && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
            <div><h2 className="font-semibold text-gray-900">Related Invoices</h2><p className="text-sm text-gray-500">{jobInvoices.length} invoice{jobInvoices.length === 1 ? '' : 's'} · {formatCurrency(jobInvoices.reduce((sum, invoice) => sum + invoice.amount, 0))} billed</p></div>
            <Link to="/finance/invoices"><Button size="sm">Manage Invoices <ChevronRight size={13} /></Button></Link>
          </div>
          {jobInvoices.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No invoices yet"
                description="Create an invoice when you're ready to bill the customer."
                action={<Link to="/finance/invoices"><Button size="sm">Create Invoice</Button></Link>}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500"><th className="px-4 py-3 font-medium">Invoice</th><th className="py-3 font-medium">Issue Date</th><th className="py-3 font-medium">Due Date</th><th className="py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Amount</th></tr></thead>
                <tbody className="divide-y divide-gray-50">{jobInvoices.map((invoice) => <tr key={invoice.id}><td className="px-4 py-3 font-medium text-gray-900">{invoice.number}</td><td className="py-3 text-gray-600">{formatDate(invoice.issueDate)}</td><td className="py-3 text-gray-600">{formatDate(invoice.dueDate)}</td><td className="py-3"><Badge label={invoice.status} className="bg-gray-100 text-gray-700" /></td><td className="px-4 py-3 text-right font-semibold">{formatCurrency(invoice.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={Boolean(submissionForm)}
        onClose={closeSubmissionWorkspace}
        title={submissionDetail ? 'Submission Details' : 'Form Submissions'}
        wide
        footer={<div className="flex flex-wrap justify-end gap-2">{submissionDetail ? <Button variant="secondary" onClick={() => { setSubmissionDetail(null); setResponseFileUrls({}); }}>Back to Submissions</Button> : null}<Link to="/operations/forms"><Button variant="secondary">Open Review Workflow</Button></Link><Button onClick={closeSubmissionWorkspace}>Close</Button></div>}
      >
        {submissionForm ? <div className="space-y-4">
          <div><h2 className="text-lg font-semibold text-gray-900">{submissionForm.name}</h2><p className="text-sm text-gray-500">{job.title}</p></div>
          {submissionError ? <p className="rounded-lg bg-accent-50 p-3 text-sm text-accent-700">{submissionError}</p> : null}
          {submissionLoading ? <p className="py-8 text-center text-sm text-gray-500">Loading submission details...</p> : submissionDetail ? <>
            <div className="grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <p className="text-gray-500">Employee<br /><span className="font-medium text-gray-900">{submissionDetail.submission.employeeName}</span></p>
              <p className="text-gray-500">Submitted<br /><span className="font-medium text-gray-900">{formatDateTime(submissionDetail.submission.submittedAt)}</span></p>
              <p className="text-gray-500">Status<br /><span className="font-medium text-gray-900">{formatFormLabel(submissionDetail.submission.status)}</span></p>
              <p className="text-gray-500">Submitted By<br /><span className="font-medium text-gray-900">{submissionDetail.submission.submittedBy ?? submissionDetail.submission.employeeName}</span></p>
              <p className="text-gray-500">Division<br /><span className="font-medium text-gray-900">{submissionDetail.submission.divisionName ?? 'Not recorded'}</span></p>
              <p className="text-gray-500">Trigger<br /><span className="font-medium text-gray-900">{submissionDetail.submission.trigger ? formatFormLabel(submissionDetail.submission.trigger) : 'Legacy submission'}</span></p>
            </div>
            <Card className="overflow-hidden"><div className="border-b border-gray-100 p-4"><h3 className="font-semibold text-gray-900">Completed Form</h3></div><div className="divide-y divide-gray-100">{submissionDetail.responses.map((answer) => <div key={answer.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"><p className="text-sm font-medium text-gray-600">{answer.fieldLabel}</p><div><p className="whitespace-pre-wrap text-sm text-gray-900">{answer.value || (answer.fileIds?.length ? '' : '—')}</p>{answer.fileIds?.length ? <div className="mt-2 flex flex-wrap gap-2">{answer.fileIds.map((fileId, index) => { const url = responseFileUrls[fileId]; return url ? (answer.fieldType === 'photo_upload' || answer.fieldType === 'signature' ? <a key={fileId} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${answer.fieldLabel} ${index + 1}`} className="h-28 max-w-48 rounded-lg border border-gray-200 object-contain" /></a> : <a key={fileId} href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 hover:text-brand-800">Open attachment {index + 1}</a>) : <span key={fileId} className="text-xs text-gray-400">Attachment unavailable</span>; })}</div> : null}</div></div>)}{submissionDetail.responses.length === 0 ? <p className="p-4 text-sm text-gray-500">No responses were saved for this submission.</p> : null}</div></Card>
            <p className="text-xs text-gray-500">This view is read-only. Approval and rejection remain in Forms → Submissions.</p>
          </> : scopedSubmissions.length === 0 ? <EmptyState title="No submissions yet" description="Completed submissions for this Job and Form will appear here." /> : <div className="space-y-2">{scopedSubmissions.map((submission) => <Card key={submission.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-gray-900">{submission.employeeName}</p><p className="mt-1 text-sm text-gray-500">{formatDateTime(submission.submittedAt)}</p><Badge label={formatFormLabel(submission.status)} className="mt-2 bg-gray-100 text-gray-700" /></div><Button variant="secondary" size="sm" onClick={() => void openSubmissionDetail(submission.id)}>View <ChevronRight size={13} /></Button></Card>)}</div>}
        </div> : null}
      </Modal>

      <ScheduleJobModal
        open={scheduleModalOpen}
        title={job.scheduleConfirmed ? 'Edit Schedule' : 'Schedule Job'}
        jobs={jobs}
        customers={customers}
        employees={employees}
        equipmentAssets={equipmentAssets}
        crews={crews}
        divisions={divisions}
        initialJobId={job.id}
        onClose={() => setScheduleModalOpen(false)}
        onSave={(payload) => updateJob(payload.jobId, payload)}
      />
    </div>
  );
}
