import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../../store';
import { PageHeader, Button, Card, Badge, Modal, Input, Select, TextArea, EmptyState } from '../../components/ui';
import { Plus, Pencil, Trash2, Search, ChevronRight, BriefcaseBusiness, ClipboardList, FilterX } from 'lucide-react';
import { statusColor, formatCurrency, formatDate, durationHours } from '../../utils';
import type { Job, JobStatus } from '../../types';
import { HIGH_LABOR_VARIANCE_THRESHOLD_PCT, LOW_MARGIN_THRESHOLD_PCT } from '../../config/profitability';
import { buildEffectiveTimeEntries } from '../../utils/timeCorrections';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import {
  closeDetailWorkspace,
  openDetailWorkspace,
  readDetailWorkspaceQuery,
} from '../../components/detail-workspace/detailWorkspaceQuery';
import JobDetailPanel from './JobDetailPanel';

const STATUSES: JobStatus[] = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];
type RiskFilter = 'all' | 'at_risk' | 'over_hours' | 'low_margin' | 'labor_variance';
const JOB_WORKSPACE_QUERY = { recordParam: 'job', tabParam: 'jobTab', defaultTab: 'overview' } as const;

const empty = (customers: { id: string }[]): Omit<Job, 'id' | 'createdAt' | 'updatedAt'> => ({
  customerId: customers[0]?.id ?? '',
  title: '',
  description: '',
  workAreas: [],
  status: 'scheduled',
  startDate: new Date().toISOString().slice(0, 10),
  scheduleConfirmed: true,
  scheduleAllDay: true,
  estimatedHours: 0,
  actualHours: 0,
  estimatedCost: 0,
  actualCosts: [],
  contractValue: 0,
  assignedEmployeeIds: [],
  notes: '',
});

interface JobsPageProps {
  currentUserRole: string;
}

export default function JobsPage({ currentUserRole }: JobsPageProps) {
  const { jobs, customers, employees, estimates, timeEntries, timeCorrections, addJob, updateJob, deleteJob } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [form, setForm] = useState(empty(customers));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const workspace = readDetailWorkspaceQuery(searchParams, JOB_WORKSPACE_QUERY);
  const selectedJob = jobs.find((job) => job.id === workspace.recordId) ?? null;
  const selectedCustomer = customers.find((customer) => customer.id === selectedJob?.customerId) ?? null;
  const selectedEmployees = employees.filter((employee) => selectedJob?.assignedEmployeeIds.includes(employee.id));
  const canViewFinancials = currentUserRole === 'owner' || currentUserRole === 'admin';
  const selectJob = (jobId: string) => setSearchParams(openDetailWorkspace(searchParams, JOB_WORKSPACE_QUERY, jobId));
  const closeJob = () => setSearchParams(closeDetailWorkspace(searchParams, JOB_WORKSPACE_QUERY));
  const hasFilters = search.trim().length > 0 || statusFilter !== 'all' || riskFilter !== 'all';

  const availableEstimateConversions = useMemo(() => {
    return estimates.filter((estimate) => estimate.status === 'accepted' && !estimate.convertedToJobId);
  }, [estimates]);

  const entryJobIds = (entry: { jobIds?: string[]; jobId?: string }) =>
    Array.isArray(entry.jobIds) && entry.jobIds.length > 0
      ? entry.jobIds
      : (entry.jobId ? [entry.jobId] : []);

  const effectiveTimeEntries = useMemo(
    () => buildEffectiveTimeEntries(timeEntries, timeCorrections),
    [timeEntries, timeCorrections]
  );

  const jobRiskById = useMemo(() => {
    const map = new Map<string, {
      overHours: boolean;
      lowMargin: boolean;
      laborVarianceHigh: boolean;
      atRisk: boolean;
      warningBadges: Array<{ label: string; className: string }>;
    }>();

    jobs.forEach((job) => {
      const jobEntries = effectiveTimeEntries.filter((entry) => entryJobIds(entry).includes(job.id));

      let trackedLaborCost = 0;
      for (const entry of jobEntries) {
        const ids = entryJobIds(entry);
        const divisor = ids.length > 0 ? ids.length : 1;
        const sharedHours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes) / divisor;
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
      const laborVariancePct =
        trackedLaborCost > 0 ? ((recordedLaborCosts - trackedLaborCost) / trackedLaborCost) * 100 : 0;

      const overHours = job.estimatedHours > 0 && job.actualHours > job.estimatedHours;
      const lowMargin = projectedMarginFromTracking < LOW_MARGIN_THRESHOLD_PCT;
      const laborVarianceHigh = Math.abs(laborVariancePct) > HIGH_LABOR_VARIANCE_THRESHOLD_PCT;

      const warningBadges: Array<{ label: string; className: string }> = [];
      if (overHours) warningBadges.push({ label: 'Over Hours', className: 'bg-accent-100 text-accent-700' });
      if (lowMargin) warningBadges.push({ label: `Low Margin (<${LOW_MARGIN_THRESHOLD_PCT}%)`, className: 'bg-accent-50 text-accent-600' });
      if (laborVarianceHigh) warningBadges.push({ label: `Labor Variance (>${HIGH_LABOR_VARIANCE_THRESHOLD_PCT}%)`, className: 'bg-brand-100 text-brand-700' });

      map.set(job.id, {
        overHours,
        lowMargin,
        laborVarianceHigh,
        atRisk: overHours || lowMargin || laborVarianceHigh,
        warningBadges,
      });
    });

    return map;
  }, [effectiveTimeEntries, employees, jobs]);

  const filtered = jobs.filter((j) => {
    const c = customers.find((c) => c.id === j.customerId);
    const matchSearch =
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      (c?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || j.status === statusFilter;
    const risk = jobRiskById.get(j.id);
    const matchRisk =
      riskFilter === 'all' ||
      (riskFilter === 'at_risk' && Boolean(risk?.atRisk)) ||
      (riskFilter === 'over_hours' && Boolean(risk?.overHours)) ||
      (riskFilter === 'low_margin' && Boolean(risk?.lowMargin)) ||
      (riskFilter === 'labor_variance' && Boolean(risk?.laborVarianceHigh));
    return matchSearch && matchStatus && matchRisk;
  });

  const openNew = () => {
    setEditing(null);
    setForm(empty(customers));
    setModalOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('create') !== 'job') return;

    openNew();
    params.delete('create');
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true });
  }, [location.pathname, location.search, navigate, customers]);

  const openEdit = (j: Job) => {
    setEditing(j);
    setForm({
      customerId: j.customerId, title: j.title, description: j.description,
      workAreas: [...(j.workAreas ?? [])],
      status: j.status, startDate: j.startDate, endDate: j.endDate,
      scheduleConfirmed: j.scheduleConfirmed,
      scheduledStartAt: j.scheduledStartAt,
      scheduledEndAt: j.scheduledEndAt,
      scheduleAllDay: j.scheduleAllDay,
      scheduleNotes: j.scheduleNotes,
      assignedEquipmentIds: [...(j.assignedEquipmentIds ?? [])],
      estimatedHours: j.estimatedHours, actualHours: j.actualHours,
      estimatedCost: j.estimatedCost, actualCosts: j.actualCosts,
      contractValue: j.contractValue, assignedEmployeeIds: [...j.assignedEmployeeIds],
      notes: j.notes,
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.customerId) return;
    if (editing?.sourceEstimateId) {
      const operationalPatch = {
        customerId: form.customerId,
        title: form.title,
        description: form.description,
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate,
        scheduleConfirmed: form.scheduleConfirmed,
        scheduledStartAt: form.scheduledStartAt,
        scheduledEndAt: form.scheduledEndAt,
        scheduleAllDay: form.scheduleAllDay,
        scheduleNotes: form.scheduleNotes,
        assignedEmployeeIds: form.assignedEmployeeIds,
        assignedEquipmentIds: form.assignedEquipmentIds,
        actualHours: form.actualHours,
        actualCosts: form.actualCosts,
        notes: form.notes,
      };
      void updateJob(editing.id, operationalPatch);
    } else if (editing) updateJob(editing.id, form);
    else addJob(form);
    setModalOpen(false);
  };

  const set = (key: keyof typeof form, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleEmployee = (id: string) => {
    setForm((f) => ({
      ...f,
      assignedEmployeeIds: f.assignedEmployeeIds.includes(id)
        ? f.assignedEmployeeIds.filter((e) => e !== id)
        : [...f.assignedEmployeeIds, id],
    }));
  };

  return (
    <div>
      <DetailWorkspace
        open={Boolean(workspace.recordId)}
        expanded={false}
        detailKey={workspace.recordId}
        list={(
          <div>
      <PageHeader
        title="Jobs"
        subtitle="Track active and completed jobs."
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/estimates?status=accepted')}>
              <ChevronRight size={16} /> Accepted Estimates
            </Button>
            <Button onClick={openNew}><Plus size={16} /> New Job</Button>
          </div>
        )}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="all">All Risk Levels</option>
          <option value="at_risk">At Risk Jobs</option>
          <option value="over_hours">Over Hours</option>
          <option value="low_margin">Low Margin</option>
          <option value="labor_variance">Labor Variance High</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        jobs.length === 0 ? (
          availableEstimateConversions.length > 0 ? (
            <EmptyState
              icon={<BriefcaseBusiness aria-hidden="true" />}
              title="No jobs yet"
              description="Jobs can be created from accepted estimates or entered manually for work that did not require an estimate."
              action={<Button onClick={() => navigate('/estimates?status=accepted')}><ChevronRight size={16} /> Create from Estimate</Button>}
              secondaryAction={<Button variant="secondary" onClick={openNew}><Plus size={16} /> Create Blank Job</Button>}
            />
          ) : (
            <EmptyState
              icon={<ClipboardList aria-hidden="true" />}
              title="No jobs yet"
              description="Jobs can be created from accepted estimates or entered manually for work that did not require an estimate."
              action={<Button onClick={openNew}><Plus size={16} /> Create Blank Job</Button>}
              secondaryAction={<Button variant="secondary" onClick={() => navigate('/estimates')}><ChevronRight size={16} /> View Estimates</Button>}
            />
          )
        ) : (
          <EmptyState
            icon={<FilterX aria-hidden="true" />}
            title="No jobs match your filters"
            description="Try a different search or clear your current filters."
            action={hasFilters ? <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all'); setRiskFilter('all'); }}>Clear Filters</Button> : undefined}
          />
        )
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => {
            const customer = customers.find((c) => c.id === job.customerId);
            const actualCostTotal = job.actualCosts.reduce((s, c) => s + c.total, 0);
            const pct = job.estimatedHours > 0 ? Math.min(100, (job.actualHours / job.estimatedHours) * 100) : 0;
            const profit = job.contractValue - actualCostTotal;
            const risk = jobRiskById.get(job.id);
            return (
              <Card
                key={job.id}
                className={`cursor-pointer p-4 transition-colors ${workspace.recordId === job.id ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300 dark:border-brand-400 dark:bg-brand-600' : ''}`}
                onClick={() => selectJob(job.id)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectJob(job.id); }}
                role="button"
                tabIndex={0}
                aria-selected={workspace.recordId === job.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge label={job.status} className={statusColor[job.status]} />
                      {risk?.atRisk && <Badge label="At Risk" className="bg-accent-100 text-accent-700" />}
                      {job.sourceEstimateId ? <Badge label="From Estimate" className="bg-brand-100 text-brand-700" /> : null}
                      <button type="button" className="truncate font-semibold text-gray-900 hover:text-brand-600 dark:text-brand-50">
                        {job.title}
                      </button>
                    </div>
                    {job.jobNumber ? (
                      <p className="text-xs text-gray-500 mb-1">Job #{job.jobNumber}</p>
                    ) : null}
                    {risk && risk.warningBadges.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {risk.warningBadges.map((warning) => (
                          <Badge key={warning.label} label={warning.label} className={warning.className} />
                        ))}
                      </div>
                    )}
                    <p className="text-sm text-gray-500">{customer?.name ?? '—'} · Started {formatDate(job.startDate)}</p>
                    {job.workAreas?.length ? (
                      <p className="text-xs text-gray-500 mt-1">Work Areas: {job.workAreas.join(', ')}</p>
                    ) : null}
                    {/* Hours bar */}
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-xs">
                        <div className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-accent-600' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{job.actualHours.toFixed(1)}/{job.estimatedHours}h</span>
                    </div>
                  </div>
                  {canViewFinancials ? <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{formatCurrency(job.contractValue)}</p>
                    <p className={`text-xs ${profit >= 0 ? 'text-brand-700' : 'text-accent-600'}`}>
                      {profit >= 0 ? '+' : ''}{formatCurrency(profit)} margin
                    </p>
                  </div> : null}
                </div>
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                  <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); selectJob(job.id); }}><ChevronRight size={13} /> Details</Button>
                  <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); openEdit(job); }}><Pencil size={13} /></Button>
                  {!job.sourceEstimateId ? <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setConfirmDelete(job.id); }}><Trash2 size={13} className="text-accent-600" /></Button> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

          </div>
        )}
        detail={selectedJob ? (
          <JobDetailPanel
            job={selectedJob}
            customer={selectedCustomer}
            assignedEmployees={selectedEmployees}
            risk={jobRiskById.get(selectedJob.id)}
            canViewFinancials={canViewFinancials}
            onClose={closeJob}
          />
        ) : (
          <div className="p-6"><p className="text-sm text-gray-500 dark:text-brand-200">Job not found or no longer available.</p><Button className="mt-4" variant="secondary" onClick={closeJob}>Close</Button></div>
        )}
      />

      {/* Form Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Job' : 'New Job'} wide
        footer={<>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save Job</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Customer *" required value={form.customerId} onChange={(e) => set('customerId', e.target.value)}>
              <option value="">— Select —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value as JobStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
          </div>
          <Input label="Title *" required value={form.title} onChange={(e) => set('title', e.target.value)} />
          <TextArea label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} />
          {!editing?.sourceEstimateId ? <TextArea
            label="Work Areas"
            value={(form.workAreas ?? []).join('\n')}
            onChange={(e) => set('workAreas', e.target.value.split('\n').map((line) => line.trim()).filter(Boolean))}
            placeholder="Main floor\nGarage\nBackyard"
          /> : <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-700">Edit converted Job scope from the Work Areas tab. Sold contract values remain read-only.</p>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" type="date" value={form.startDate?.slice(0, 10) ?? ''} onChange={(e) => set('startDate', e.target.value)} />
            <Input label="End Date" type="date" value={form.endDate?.slice(0, 10) ?? ''} onChange={(e) => set('endDate', e.target.value || undefined)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {!editing?.sourceEstimateId ? <Input label="Estimated Hours" type="number" min={0} value={form.estimatedHours} onChange={(e) => set('estimatedHours', Number(e.target.value))} /> : <div />}
            <Input label="Actual Hours" type="number" min={0} step={0.25} value={form.actualHours} onChange={(e) => set('actualHours', Number(e.target.value))} />
            {!editing?.sourceEstimateId ? <Input label="Contract Value ($)" type="number" min={0} value={form.contractValue} onChange={(e) => set('contractValue', Number(e.target.value))} /> : <div><p className="text-sm font-medium text-gray-700">Contract Total</p><p className="mt-2 font-semibold">{formatCurrency(editing.contractValue)}</p><p className="text-xs text-gray-500">From sold Estimate</p></div>}
          </div>

          {/* Assign employees */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Assigned Employees</p>
            <div className="flex flex-wrap gap-2">
              {employees.filter((e) => e.active).map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => toggleEmployee(emp.id)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                    form.assignedEmployeeIds.includes(emp.id)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-brand-400'
                  }`}
                >
                  {emp.name}
                </button>
              ))}
            </div>
          </div>
          <TextArea label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Job"
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { deleteJob(confirmDelete!); setConfirmDelete(null); }}>Delete</Button>
        </>}
      >
        <p className="text-gray-600">Delete this job? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
