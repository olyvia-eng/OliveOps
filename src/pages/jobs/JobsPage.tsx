import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../../store';
import { PageHeader, Button, Badge, Modal, Input, Select, TextArea, EmptyState } from '../../components/ui';
import { Plus, Pencil, Trash2, Search, ChevronRight, BriefcaseBusiness, ClipboardList, FilterX } from 'lucide-react';
import { statusColor, formatCurrency, formatDate } from '../../utils';
import type { Job, JobStatus } from '../../types';
import { calculateJobPerformance } from '../../utils/jobPerformanceModel.js';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import {
  closeDetailWorkspace,
  openDetailWorkspace,
  readDetailWorkspaceQuery,
} from '../../components/detail-workspace/detailWorkspaceQuery';
import JobDetailPanel from './JobDetailPanel';

const STATUSES: JobStatus[] = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];
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
  const { jobs, customers, employees, labourClasses, estimates, invoices, expenses, timeEntries, timeCorrections, addJob, updateJob, deleteJob } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
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
  const hasFilters = search.trim().length > 0 || statusFilter !== 'all';

  const availableEstimateConversions = useMemo(() => {
    return estimates.filter((estimate) => estimate.status === 'accepted' && !estimate.convertedToJobId);
  }, [estimates]);

  const jobPerformanceById = useMemo(() => new Map(jobs.map((job) => [job.id, calculateJobPerformance({
    job,
    employees,
    labourClasses,
    timeEntries,
    timeCorrections,
    invoices,
    expenses,
  })])), [employees, expenses, invoices, jobs, labourClasses, timeCorrections, timeEntries]);

  const jobRiskById = useMemo(() => {
    const map = new Map<string, {
      overHours: boolean;
      lowMargin: boolean;
      laborVarianceHigh: boolean;
      atRisk: boolean;
      warningBadges: Array<{ label: string; className: string }>;
    }>();

    jobs.forEach((job) => {
      const performance = jobPerformanceById.get(job.id)!;
      const overHours = performance.labour.estimated.hasData
        && performance.labour.actual.hours > performance.labour.estimated.hours;
      const lowMargin = false;
      const labourCostRow = performance.costs.categories.find((row) => row.category === 'labour');
      const laborVarianceHigh = Boolean(labourCostRow?.variance !== null && labourCostRow && labourCostRow.variance > 0);

      const warningBadges: Array<{ label: string; className: string }> = [];
      if (overHours) warningBadges.push({ label: 'Over Hours', className: 'bg-accent-100 text-accent-700' });
      if (laborVarianceHigh) warningBadges.push({ label: 'Labour Cost Over', className: 'bg-brand-100 text-brand-700' });

      map.set(job.id, {
        overHours,
        lowMargin,
        laborVarianceHigh,
        atRisk: overHours || lowMargin || laborVarianceHigh,
        warningBadges,
      });
    });

    return map;
  }, [jobPerformanceById, jobs]);

  const filtered = jobs.filter((j) => {
    const c = customers.find((c) => c.id === j.customerId);
    const matchSearch =
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      (c?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || j.status === statusFilter;
    return matchSearch && matchStatus;
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
            className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-xl shadow-sm bg-white dark:border-brand-600 dark:bg-brand-800 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')}
          className="h-10 border border-gray-300 rounded-xl px-3 text-sm bg-white shadow-sm dark:border-brand-600 dark:bg-brand-800 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
        >
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
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
            title="No jobs found"
            description="Adjust your search or filters, or create a new Job."
            action={hasFilters ? <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all'); }}>Clear Filters</Button> : undefined}
            secondaryAction={<Button onClick={openNew}><Plus size={16} /> New Job</Button>}
          />
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] table-fixed text-sm">
            <colgroup>
              <col className="w-[18rem]" />
              <col className="w-[14rem]" />
              <col className="w-[14rem]" />
              <col className="w-[10rem]" />
              <col className="w-[13rem]" />
              {canViewFinancials ? <col className="w-[9rem]" /> : null}
              <col className="w-[7rem]" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-brand-600 dark:text-brand-300">
                <th className="pb-2 font-medium">Job</th>
                <th className="pb-2 font-medium">Customer</th>
                <th className="pb-2 font-medium">Work Areas</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium" title="Actual labour hours used compared with estimated labour hours">Labour Hours</th>
                {canViewFinancials ? <th className="whitespace-nowrap pb-2 text-right font-medium">Contract Value</th> : null}
                <th className="pb-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-brand-700">
              {filtered.map((job) => {
                const customer = customers.find((item) => item.id === job.customerId);
                const performance = jobPerformanceById.get(job.id)!;
                const actualHours = performance.labour.actual.hours;
                const estimatedHours = performance.labour.estimated.hours;
                const hasEstimate = performance.labour.estimated.hasData && estimatedHours > 0;
                const progress = hasEstimate ? Math.min(100, (actualHours / estimatedHours) * 100) : 0;
                const overHours = hasEstimate && actualHours > estimatedHours;
                const workAreaNames = job.operationalWorkAreas?.map((area) => area.name) ?? job.workAreas ?? [];
                const workAreaLabel = workAreaNames.length ? workAreaNames.join(', ') : '—';

                return (
                  <tr
                    key={job.id}
                    className={`cursor-pointer transition-colors ${workspace.recordId === job.id ? 'bg-brand-50 dark:bg-brand-600' : 'hover:bg-gray-50 dark:hover:bg-brand-600/60'}`}
                    onClick={() => selectJob(job.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectJob(job.id); }}
                    tabIndex={0}
                    aria-selected={workspace.recordId === job.id}
                  >
                    <td className="min-w-0 py-3 pr-6 align-top">
                      <button type="button" title={job.title} className="block max-w-full break-words text-left font-semibold leading-5 text-gray-900 hover:text-brand-700 dark:text-brand-50 dark:hover:text-brand-100">{job.title}</button>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-brand-300">
                        <span className="whitespace-nowrap">{job.jobNumber ? `Job #${job.jobNumber}` : 'No job number'}</span>
                        {job.sourceEstimateId ? <Badge label="From Estimate" className="shrink-0 whitespace-nowrap bg-gray-100 text-gray-600 dark:bg-brand-700 dark:text-brand-200" /> : null}
                      </div>
                    </td>
                    <td className="min-w-0 py-3 pr-6 align-top text-gray-600 dark:text-brand-100">
                      <p className="truncate" title={customer?.name}>{customer?.name ?? '—'}</p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-brand-300">Started {formatDate(job.startDate)}</p>
                    </td>
                    <td className="max-w-56 py-3 pr-4 text-gray-600 dark:text-brand-100"><p className="truncate" title={workAreaLabel}>{workAreaLabel}</p></td>
                    <td className="py-3 pr-4"><Badge label={job.status} className={statusColor[job.status]} /></td>
                    <td className="w-44 py-3 pr-4" title="Actual labour hours used compared with estimated labour hours; this is not percent complete.">
                      {hasEstimate ? <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-brand-700"><div className={`h-1.5 rounded-full ${overHours ? 'bg-accent-600' : 'bg-brand-500'}`} style={{ width: `${progress}%` }} /></div> : null}
                      <p className={`mt-1 text-xs tabular-nums ${overHours ? 'font-semibold text-accent-700' : 'text-gray-500 dark:text-brand-300'}`}>{actualHours.toFixed(1)} hr{hasEstimate ? ` / ${estimatedHours.toFixed(1)} hr` : ''}</p>
                      {!hasEstimate ? <p className="text-xs text-gray-400">No hours estimate</p> : overHours ? <p className="text-xs font-medium text-accent-700">{(actualHours - estimatedHours).toFixed(1)} hr over</p> : null}
                    </td>
                    {canViewFinancials ? <td className="whitespace-nowrap py-3 pr-4 text-right font-semibold tabular-nums text-gray-900 dark:text-brand-50">{formatCurrency(performance.revenue.contract)}</td> : null}
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); selectJob(job.id); }} title="Open Details"><ChevronRight size={13} /></Button>
                        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); openEdit(job); }} title="Edit Job"><Pencil size={13} /></Button>
                        {!job.sourceEstimateId ? <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setConfirmDelete(job.id); }} title="Delete Job"><Trash2 size={13} className="text-accent-600" /></Button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
            performance={jobPerformanceById.get(selectedJob.id)}
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
