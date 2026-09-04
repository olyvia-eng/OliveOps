import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { Card, Button, Badge, EmptyState, Input, Modal, Select, TextArea } from '../../components/ui';
import { statusColor, formatCurrency, formatDate, formatDateTime, durationHours } from '../../utils';
import ScheduleJobModal from '../../components/calendar/ScheduleJobModal';
import { resolveAttachmentUrl } from '../../utils/fileUpload';
import { ArrowLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { Address, FormRecord, FormResponse, FormSubmission, JobStatus, TimeEntry } from '../../types';
import { buildEffectiveTimeEntries } from '../../utils/timeCorrections';
import { formatScheduleTimeLabel, getAssignedEquipmentForJob } from '../../utils/jobSchedule';
import { formatTimeEntryDuration, getTimeEntryPresentation, sortTimeEntriesNewestFirst } from '../../utils/timeEntryPresentation.js';
import OutstandingTasks from '../home/OutstandingTasks';
import JobLabourSummaryCard from '../../components/jobs/JobLabourSummaryCard';
import { calculateJobPerformance } from '../../utils/jobPerformanceModel.js';
import TimeEntryDetailModal from '../../components/time/TimeEntryDetailModal';

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

const formatPropertyAddress = (property: Address) => [property.street, property.city, property.province, property.postalCode, property.country]
  .map((value) => typeof value === 'string' ? value.trim() : '')
  .filter(Boolean)
  .join(', ');

const formatEmployeeCompensation = (employee: { compensationType?: string; hourlyRate: number }) => employee.compensationType === 'salary'
  ? `${formatCurrency(employee.hourlyRate)} annual salary`
  : `${formatCurrency(employee.hourlyRate)}/hr`;

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
  const { jobs, customers, employees, labourClasses, crews, divisions, budgetDivisions, invoices, expenses, timeEntries, timeCorrections, equipmentAssets, forms, formSubmissions, tasks, jobTaskHeadings, updateJob, updateJobSchedule, initializeJobPlan, mutateJobPlan, deleteTimeEntry, addTask, updateTask, deleteTask, addJobTaskHeading, renameJobTaskHeading, deleteJobTaskHeading, reorderJobTaskHeadings } = useStore();

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
  const [analysisScope, setAnalysisScope] = useState('entire-job');
  const [selectedTimeEntryId, setSelectedTimeEntryId] = useState<string | null>(null);

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
  const headings = useMemo(() => jobTaskHeadings.filter((heading) => heading.jobId === id).sort((left, right) => left.sortOrder - right.sortOrder), [id, jobTaskHeadings]);
  const visibleJobTasks = useMemo(() => jobTasks.filter((task) => !task.parentTaskId && (jobTaskFilter === 'completed' ? task.status === 'completed' : task.status === 'open')), [jobTaskFilter, jobTasks]);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const canManageSchedule = currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'foreman';
  const canEditFinancials = currentUserRole === 'owner' || currentUserRole === 'admin';
  const [jobInfoSaving, setJobInfoSaving] = useState(false);
  const [planInitializing, setPlanInitializing] = useState(false);
  const [jobInfo, setJobInfo] = useState(() => ({
    title: job?.title ?? '', description: job?.description ?? '', customerId: job?.customerId ?? '',
    propertyLabel: job?.propertyLabel ?? '', propertyAddressSnapshot: job?.propertyAddressSnapshot ?? '',
    startDate: job?.startDate ?? '', endDate: job?.endDate ?? '', scheduleNotes: job?.scheduleNotes ?? '', notes: job?.notes ?? '',
  }));

  useEffect(() => {
    if (!job) return;
    setJobInfo({
      title: job.title, description: job.description, customerId: job.customerId,
      propertyLabel: job.propertyLabel ?? '', propertyAddressSnapshot: job.propertyAddressSnapshot ?? '',
      startDate: job.startDate, endDate: job.endDate ?? '', scheduleNotes: job.scheduleNotes ?? '', notes: job.notes,
    });
  }, [job]);

  useEffect(() => {
    if (!job || activeTab !== 'work-areas' || job.planningSnapshotVersion || planInitializing) return;
    setPlanInitializing(true);
    void initializeJobPlan(job.id).finally(() => setPlanInitializing(false));
  }, [activeTab, initializeJobPlan, job, planInitializing]);

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

    return sortTimeEntriesNewestFirst(effectiveTimeEntries.filter((entry) => normalizeEntryJobIds(entry).includes(id)));
  }, [effectiveTimeEntries, job, id]);
  const selectedTimeEntry = jobTimeEntries.find((entry) => entry.id === selectedTimeEntryId) ?? null;

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

  const performance = useMemo(() => job ? calculateJobPerformance({
    job,
    employees,
    labourClasses,
    timeEntries,
    timeCorrections,
    invoices,
    expenses,
    scopeWorkAreaId: analysisScope,
  }) : null, [analysisScope, employees, expenses, invoices, job, labourClasses, timeCorrections, timeEntries]);
  const unallocatedPerformance = useMemo(() => job ? calculateJobPerformance({
    job,
    employees,
    labourClasses,
    timeEntries,
    timeCorrections,
    invoices,
    expenses,
    scopeWorkAreaId: 'unallocated',
  }) : null, [employees, expenses, invoices, job, labourClasses, timeCorrections, timeEntries]);
  const hasUnallocatedData = Boolean(unallocatedPerformance && (
    unallocatedPerformance.labour.actual.hasData
    || unallocatedPerformance.expenses.length > 0
    || unallocatedPerformance.costs.categories.some((row) => row.actualCost !== null)
  ));
  const originalContractRevenue = job?.originalEstimateSnapshot?.subtotal ?? job?.originalContractRevenue ?? job?.contractValue ?? 0;

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

      {activeTab === 'info' && <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <div><h2 className="font-semibold text-gray-900">Operational Job Information</h2><p className="text-sm text-gray-500">Changes here update the Job only. The sold Estimate remains unchanged.</p></div>
          <div className="grid gap-3 sm:grid-cols-2"><Input label="Job Title" required value={jobInfo.title} onChange={(event) => setJobInfo((current) => ({ ...current, title: event.target.value }))} /><Select label="Customer" value={jobInfo.customerId} onChange={(event) => { const nextCustomer = customers.find((item) => item.id === event.target.value); const property = nextCustomer?.properties?.[0] ?? nextCustomer?.address; setJobInfo((current) => ({ ...current, customerId: event.target.value, propertyLabel: property?.nickname ?? '', propertyAddressSnapshot: property ? formatPropertyAddress(property) : '' })); }}><option value="">Select customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>
          <TextArea label="Description" value={jobInfo.description} onChange={(event) => setJobInfo((current) => ({ ...current, description: event.target.value }))} />
          <div className="grid gap-3 sm:grid-cols-2"><Input label="Property" value={jobInfo.propertyLabel} onChange={(event) => setJobInfo((current) => ({ ...current, propertyLabel: event.target.value }))} /><Input label="Property Address" value={jobInfo.propertyAddressSnapshot} onChange={(event) => setJobInfo((current) => ({ ...current, propertyAddressSnapshot: event.target.value }))} /></div>
          <div className="grid gap-3 sm:grid-cols-2"><Input label="Start Date" type="date" value={jobInfo.startDate} onChange={(event) => setJobInfo((current) => ({ ...current, startDate: event.target.value }))} /><Input label="End Date" type="date" value={jobInfo.endDate} onChange={(event) => setJobInfo((current) => ({ ...current, endDate: event.target.value }))} /></div>
          <TextArea label="Schedule Notes" value={jobInfo.scheduleNotes} onChange={(event) => setJobInfo((current) => ({ ...current, scheduleNotes: event.target.value }))} />
          <TextArea label="Job Notes" value={jobInfo.notes} onChange={(event) => setJobInfo((current) => ({ ...current, notes: event.target.value }))} />
          <div className="flex justify-end"><Button disabled={jobInfoSaving || !jobInfo.title.trim() || !jobInfo.customerId || !jobInfo.startDate} onClick={async () => { setJobInfoSaving(true); const saved = await updateJob(job.id, { ...jobInfo, title: jobInfo.title.trim(), endDate: jobInfo.endDate || undefined }); setJobInfoSaving(false); if (saved) emitAppToast({ tone: 'success', message: 'Job information saved.' }); }}>{jobInfoSaving ? 'Saving...' : 'Save Changes'}</Button></div>
        </Card>
        <Card className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Conversion History</h2><p className="text-sm text-gray-500">Read-only commercial context from the sold Estimate.</p></div>{job.jobNumber ? <Badge label={`Job ${job.jobNumber}`} className="bg-brand-100 text-brand-700" /> : null}</div><div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3"><p className="text-gray-500">Source Estimate<br />{job.sourceEstimateId ? <Link className="font-medium text-brand-700" to={`/estimates/${job.sourceEstimateId}`}>Open Estimate</Link> : <span className="font-medium text-gray-900">Manual Job</span>}</p><p className="text-gray-500">Proposal Number<br /><span className="font-medium text-gray-900">{job.originalEstimateSnapshot?.proposalNumber ?? 'N/A'}</span></p><p className="text-gray-500">Converted At<br /><span className="font-medium text-gray-900">{job.convertedFromEstimateAt ? formatDateTime(job.convertedFromEstimateAt) : 'N/A'}</span></p>{canEditFinancials ? <><p className="text-gray-500">Original Contract Revenue<br /><span className="font-medium text-gray-900">{formatCurrency(originalContractRevenue)}</span></p><p className="text-gray-500">Contract Total<br /><span className="font-medium text-gray-900">{formatCurrency(job.contractValue)}</span></p></> : null}<p className="text-gray-500">Original Property<br /><span className="font-medium text-gray-900">{job.originalEstimateSnapshot?.propertyLabel || job.originalEstimateSnapshot?.propertyAddressSnapshot || 'N/A'}</span></p></div></Card>
      </div>}

      {activeTab === 'work-areas' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Current Job Plan</h2><p className="text-sm text-gray-500">Operational changes do not modify the sold Estimate.</p></div>{canEditFinancials ? <Button size="sm" onClick={() => void mutateJobPlan(job.id, { action: 'add-work-area' })} disabled={planInitializing}><Plus size={14} /> Add Work Area</Button> : null}</div>
          {planInitializing ? <Card className="p-4"><p className="text-sm text-gray-500">Preparing the current Job plan...</p></Card> : null}
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
                  {canEditFinancials ? <><p className="text-gray-500">Planned Cost<br /><span className="font-semibold text-gray-900">{formatCurrency(workArea.plannedCost ?? workArea.estimatedCost)}</span></p><p className="text-gray-500">Sold Revenue<br /><span className="font-semibold text-gray-900">{formatCurrency(workArea.contractRevenue ?? workArea.estimatedRevenue)}</span></p><p className="text-gray-500">Expected Margin<br /><span className="font-semibold text-gray-900">{formatCurrency(workArea.expectedMargin ?? workArea.estimatedMargin)}</span></p></> : null}
                  <p className="text-gray-500">Line Items<br /><span className="font-semibold text-gray-900">{workArea.lineItems.length}</span></p>
                </div>
                <Link to={`/jobs/${job.id}/work-areas/${workArea.id}`} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700">Edit Current Plan <ChevronRight size={14} /></Link>
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
        !performance ? (
          <Card className="p-4">
            <EmptyState
              title="Job analysis is unavailable"
              description="The Job performance model could not be calculated."
            />
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-gray-900">Job Performance</h2><p className="text-sm text-gray-500">Estimated plan compared with eligible time and recorded costs.</p></div>
              <Select label="Scope" value={analysisScope} onChange={(event) => setAnalysisScope(event.target.value)} className="min-w-56">
                <option value="entire-job">Entire Job</option>
                {(job.operationalWorkAreas ?? []).slice().sort((left, right) => left.sortOrder - right.sortOrder).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                {hasUnallocatedData ? <option value="unallocated">Unallocated</option> : null}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Card className="p-4"><p className="text-xs text-gray-500">Contract revenue</p><p className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(performance.revenue.contract)}</p><p className="text-xs text-gray-400">Excludes tax</p></Card>
              <Card className="p-4"><p className="text-xs text-gray-500">Issued revenue</p><p className="mt-1 text-lg font-semibold text-gray-900">{performance.revenue.issued === null ? 'Unavailable' : formatCurrency(performance.revenue.issued)}</p><p className="text-xs text-gray-400">Sent, overdue, partially paid, and paid invoices; excludes tax</p></Card>
              <Card className="p-4"><p className="text-xs text-gray-500">Estimated gross profit</p><p className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(performance.profit.estimatedGross)}</p><p className="text-xs text-gray-400">{performance.profit.estimatedGrossMargin === null ? 'Margin unavailable' : `${performance.profit.estimatedGrossMargin.toFixed(1)}% margin`}</p></Card>
              <Card className="p-4"><p className="text-xs text-gray-500">Estimated net profit</p><p className="mt-1 text-lg font-semibold text-gray-900">{performance.profit.estimatedNet === null ? 'Unavailable' : formatCurrency(performance.profit.estimatedNet)}</p><p className="text-xs text-gray-400">Estimated overhead is not recorded on this Job</p></Card>
              <Card className="p-4"><p className="text-xs text-gray-500">Profit to date</p><p className="mt-1 text-lg font-semibold text-gray-900">{performance.profit.toDate === null ? 'Incomplete cost data' : formatCurrency(performance.profit.toDate)}</p><p className="text-xs text-gray-400">{performance.profit.unavailableReason ?? `${performance.profit.toDateMargin?.toFixed(1)}% margin`}</p></Card>
            </div>
            <Card className="p-4">
              <div><h2 className="font-semibold text-gray-900">Estimated versus actual costs</h2><p className="text-sm text-gray-500">{performance.costs.varianceConvention} Under budget is not a final saving while work remains.</p></div>
              <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500"><th className="py-2 font-medium">Category</th><th className="py-2 text-right font-medium">Estimated Cost</th><th className="py-2 text-right font-medium">Actual Cost to Date</th><th className="py-2 text-right font-medium">Variance</th></tr></thead><tbody className="divide-y divide-gray-50">
                {performance.costs.categories.map((row) => <tr key={row.category}><td className="py-3"><p className="font-medium capitalize text-gray-900">{row.category === 'material' ? 'Materials' : row.category}</p><p className="text-xs text-gray-400">{row.sourceDescription}</p></td><td className="py-3 text-right tabular-nums">{formatCurrency(row.estimatedCost)}</td><td className="py-3 text-right tabular-nums">{row.actualCost === null ? 'Not tracked' : formatCurrency(row.actualCost)}</td><td className={`py-3 text-right tabular-nums ${row.variance === null ? 'text-gray-400' : row.variance > 0 ? 'text-accent-700' : row.variance < 0 ? 'text-emerald-700' : 'text-gray-600'}`}>{row.variance === null ? 'Unavailable' : `${formatCurrency(Math.abs(row.variance))} ${row.variance > 0 ? 'over' : row.variance < 0 ? 'under' : 'on budget'}`}</td></tr>)}
                <tr className="font-semibold"><td className="py-3">Total direct costs</td><td className="py-3 text-right">{formatCurrency(performance.costs.estimatedDirect)}</td><td className="py-3 text-right">{formatCurrency(performance.costs.knownActualDirect)}{performance.costs.actualDirectComplete ? '' : ' known'}</td><td className="py-3 text-right text-gray-400">{performance.costs.actualDirectComplete ? formatCurrency(performance.costs.knownActualDirect - performance.costs.estimatedDirect) : 'Incomplete'}</td></tr>
                <tr><td className="py-3 font-medium">Overhead</td><td className="py-3 text-right text-gray-400">Unavailable</td><td className="py-3 text-right">{performance.costs.actualOverhead === null ? 'Not recorded' : formatCurrency(performance.costs.actualOverhead)}</td><td className="py-3 text-right text-gray-400">Unavailable</td></tr>
                <tr className="font-semibold"><td className="py-3">Total cost including overhead</td><td className="py-3 text-right text-gray-400">Unavailable</td><td className="py-3 text-right">{formatCurrency(performance.costs.knownActualIncludingOverhead)} known</td><td className="py-3 text-right text-gray-400">Incomplete</td></tr>
              </tbody></table></div>
            </Card>
            <JobLabourSummaryCard summary={performance.labour} loading={false} error="" />
            <Card className="p-4"><h2 className="font-semibold text-gray-900">Unbillable work</h2>{performance.labour.unbillable.hasData ? <div className="mt-3 flex flex-wrap gap-8 text-sm"><p><span className="text-gray-500">Job-linked hours</span><br /><strong>{performance.labour.unbillable.hours.toFixed(1)} hr</strong></p><p><span className="text-gray-500">Labour cost</span><br /><strong>{performance.labour.unbillable.cost === null ? 'Unavailable' : formatCurrency(performance.labour.unbillable.cost)}</strong></p></div> : <p className="mt-2 text-sm text-gray-500">No eligible job-linked unbillable time is recorded.</p>}<p className="mt-2 text-xs text-gray-400">Shown separately and not included in direct labour totals above.</p></Card>
            <Card className="overflow-hidden"><div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-900">Detailed item comparison</h2><p className="text-sm text-gray-500">Estimated quantities and direct costs from stable Job plan items. Actual resource quantities are shown only when recorded.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[840px] text-sm"><thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500"><th className="px-4 py-3 font-medium">Item / Description</th><th className="py-3 font-medium">Category</th><th className="py-3 text-right font-medium">Estimated Qty</th><th className="py-3 text-right font-medium">Actual Qty</th><th className="py-3 font-medium">Unit</th><th className="py-3 text-right font-medium">Estimated Cost</th><th className="px-4 py-3 text-right font-medium">Actual Cost / Variance</th></tr></thead><tbody className="divide-y divide-gray-50">{performance.details.map((item) => <tr key={item.id}><td className="px-4 py-3"><p className="font-medium text-gray-900">{item.description}</p><p className="text-xs text-gray-400">{item.workAreaName}</p></td><td className="py-3 capitalize">{item.category}</td><td className="py-3 text-right tabular-nums">{item.estimatedQuantity === null ? 'Not estimated' : item.estimatedQuantity}</td><td className="py-3 text-right text-gray-400">{item.actualQuantity === null ? 'Not tracked' : item.actualQuantity}</td><td className="py-3">{item.unit || '—'}</td><td className="py-3 text-right tabular-nums">{item.estimatedCost === null ? 'Not estimated' : formatCurrency(item.estimatedCost)}</td><td className="px-4 py-3 text-right tabular-nums">{item.actualCost === null ? <span className="text-gray-400">Unavailable</span> : formatCurrency(item.actualCost)}</td></tr>)}</tbody></table></div>{performance.details.length === 0 ? <p className="p-4 text-sm text-gray-500">No estimated or actual items are available for this scope.</p> : null}</Card>
            <Card className="overflow-hidden"><div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-900">Job-linked receipts and expenses</h2><p className="text-sm text-gray-500">Approved and paid records only. Pending and unrelated expenses are excluded.</p></div>{performance.expenses.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500"><th className="px-4 py-3 font-medium">Vendor / Description</th><th className="py-3 font-medium">Category</th><th className="py-3 font-medium">Date</th><th className="py-3 font-medium">Treatment</th><th className="px-4 py-3 text-right font-medium">Amount</th></tr></thead><tbody className="divide-y divide-gray-50">{performance.expenses.map((expense) => <tr key={expense.id}><td className="px-4 py-3"><p className="font-medium text-gray-900">{expense.vendor}</p><p className="text-xs text-gray-500">{expense.description}</p></td><td className="py-3 capitalize">{expense.category}</td><td className="py-3">{formatDate(expense.date)}</td><td className="py-3 text-xs text-gray-500">{expense.countedInActuals ? 'Included once above' : 'Supporting record; not added again'}</td><td className="px-4 py-3 text-right font-semibold">{formatCurrency(expense.amount)}</td></tr>)}</tbody></table></div> : <p className="p-4 text-sm text-gray-500">No approved or paid Job-linked expenses are available for this scope.</p>}</Card>
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
            jobTaskHeadings={headings}
            canManageJobTaskHeadings={canManageSchedule}
            onAddHeading={(name) => addJobTaskHeading(job.id, name)}
            onRenameHeading={(headingId, name) => renameJobTaskHeading(job.id, headingId, name)}
            onDeleteHeading={(headingId) => deleteJobTaskHeading(job.id, headingId)}
            onReorderHeadings={(orderedIds) => reorderJobTaskHeadings(job.id, orderedIds)}
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
                  const presentation = getTimeEntryPresentation(entry, jobs);
                  return <div key={entry.id} className="rounded-lg border border-gray-100 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-gray-900">{employee?.name ?? 'Employee'}</p>{presentation.workAreaLabel ? <p className="text-xs text-gray-500">{presentation.workAreaLabel}</p> : null}</div><p className="text-xs text-gray-400">{formatDateTime(entry.clockIn)}</p></div><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{entry.notes}</p></div>;
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
                const presentation = getTimeEntryPresentation(entry, jobs);
                return <li key={entry.id} className="flex items-center gap-2 px-2 py-1 text-sm"><button type="button" onClick={() => setSelectedTimeEntryId(entry.id)} className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500"><span><span className="flex items-center gap-2 font-medium"><span>{employee?.name ?? '—'}</span><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${typeMeta.className}`}>{presentation.activityLabel}</span></span><span className="mt-1 block text-sm text-gray-700">{presentation.workLabel}</span><span className="block text-xs text-gray-400">{formatDateTime(entry.clockIn)} → {entry.clockOut ? formatDateTime(entry.clockOut) : 'Active'}</span></span><span className="font-semibold text-brand-600">{formatTimeEntryDuration(hours)}</span></button><button type="button" onClick={() => deleteTimeEntry(entry.id)} aria-label={`Delete time entry for ${employee?.name ?? 'employee'}`} className="p-2 text-gray-300 hover:text-accent-700"><Trash2 size={14} /></button></li>;
              })}</ul>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Assigned Employees</h2>
              {assignedEmployees.length === 0 ? <p className="text-sm text-gray-400">No employees assigned.</p> : (
                <ul className="space-y-2">{assignedEmployees.map((employee) => <li key={employee.id} className="flex items-center justify-between text-sm"><span>{employee.name}</span><span className="text-gray-400 capitalize">{employee.role.replace('_', ' ')} · {formatEmployeeCompensation(employee)}</span></li>)}</ul>
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
        budgetDivisions={budgetDivisions}
        initialJobId={job.id}
        onClose={() => setScheduleModalOpen(false)}
        onSave={({ jobId, ...schedule }) => updateJobSchedule(jobId, schedule)}
      />
      <TimeEntryDetailModal
        entry={selectedTimeEntry}
        employeeName={selectedTimeEntry ? employees.find((item) => item.id === selectedTimeEntry.employeeId)?.name ?? 'Employee' : ''}
        currentUserRole={currentUserRole}
        onClose={() => setSelectedTimeEntryId(null)}
      />
    </div>
  );
}
