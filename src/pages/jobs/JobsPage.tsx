import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { PageHeader, Button, Badge, Modal, Input, Select, TextArea, EmptyState } from '../../components/ui';
import { Plus, Pencil, Trash2, Search, ChevronRight, BriefcaseBusiness, ClipboardList, FilterX } from 'lucide-react';
import { statusColor, formatDate } from '../../utils';
import type { Job, JobStatus } from '../../types';
import { resolveWorkType } from '../../utils/workTypeModel.js';

const STATUSES: JobStatus[] = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];

const empty = (customers: { id: string }[]): Omit<Job, 'id' | 'createdAt' | 'updatedAt'> => ({
  workType: 'project',
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

export default function JobsPage({ currentUserRole: _currentUserRole }: JobsPageProps) {
  const { jobs, customers, employees, estimates, addJob, deleteJob } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(empty(customers));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const projectJobs = jobs.filter((job) => resolveWorkType(job) === 'project');
  const hasFilters = search.trim().length > 0 || statusFilter !== 'all';

  const availableEstimateConversions = useMemo(() => {
    return estimates.filter((estimate) => resolveWorkType(estimate) === 'project' && estimate.status === 'accepted' && !estimate.convertedToJobId);
  }, [estimates]);

  const filtered = projectJobs.filter((j) => {
    const c = customers.find((c) => c.id === j.customerId);
    const matchSearch =
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      (c?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || j.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openNew = () => {
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

  const handleSave = async () => {
    if (!form.title.trim() || !form.customerId) return;
    const jobId = await addJob(form);
    if (!jobId) return;
    setModalOpen(false);
    navigate(`/jobs/${jobId}`);
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
      <PageHeader
        title="Project Jobs"
        subtitle="Track active and completed project work."
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
        projectJobs.length === 0 ? (
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
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[24%]" />
              <col className="w-[28%]" />
              <col className="w-[13%]" />
              <col className="w-[7%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-brand-600 dark:text-brand-300">
                <th className="pb-2 font-medium">Job</th>
                <th className="pb-2 font-medium">Customer</th>
                <th className="pb-2 font-medium">Work Areas</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-brand-700">
              {filtered.map((job) => {
                const customer = customers.find((item) => item.id === job.customerId);
                const workAreaNames = job.operationalWorkAreas?.map((area) => area.name) ?? job.workAreas ?? [];
                const workAreaLabel = workAreaNames.length ? workAreaNames.join(', ') : '—';

                return (
                  <tr
                    key={job.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-brand-600/60"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate(`/jobs/${job.id}`); }}
                    tabIndex={0}
                  >
                    <td className="min-w-0 py-3 pr-6 align-top">
                      <Link to={`/jobs/${job.id}`} onClick={(event) => event.stopPropagation()} title={job.title} className="block max-w-full break-words text-left font-semibold leading-5 text-gray-900 hover:text-brand-700 dark:text-brand-50 dark:hover:text-brand-100">{job.title}</Link>
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
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); navigate(`/jobs/${job.id}`); }} title="Open Job"><ChevronRight size={13} /></Button>
                        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); navigate(`/jobs/${job.id}?tab=info`); }} title="Edit Job"><Pencil size={13} /></Button>
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

      {/* Form Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Job" wide
        footer={<>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleSave()}>Save Job</Button>
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
          <TextArea
            label="Work Areas"
            value={(form.workAreas ?? []).join('\n')}
            onChange={(e) => set('workAreas', e.target.value.split('\n').map((line) => line.trim()).filter(Boolean))}
            placeholder="Main floor\nGarage\nBackyard"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" type="date" value={form.startDate?.slice(0, 10) ?? ''} onChange={(e) => set('startDate', e.target.value)} />
            <Input label="End Date" type="date" value={form.endDate?.slice(0, 10) ?? ''} onChange={(e) => set('endDate', e.target.value || undefined)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Estimated Hours" type="number" min={0} value={form.estimatedHours} onChange={(e) => set('estimatedHours', Number(e.target.value))} />
            <Input label="Actual Hours" type="number" min={0} step={0.25} value={form.actualHours} onChange={(e) => set('actualHours', Number(e.target.value))} />
            <Input label="Contract Value ($)" type="number" min={0} value={form.contractValue} onChange={(e) => set('contractValue', Number(e.target.value))} />
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
