import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, Clock3, Plus, RefreshCw, Save } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import JobSopsCard from '../../components/jobs/JobSopsCard';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { Job, JobStatus, ServiceJobService, ServiceVisit, ServiceVisitStatus } from '../../types';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import { createManualServiceVisit, generateServiceVisits, listServiceVisits, rescheduleServiceVisit, updateOperationalService, updateServiceVisitStatus } from './serviceVisitApi';

type Tab = 'overview' | 'services' | 'visits' | 'schedule' | 'project-management' | 'analysis';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' }, { key: 'services', label: 'Services' }, { key: 'visits', label: 'Visits' },
  { key: 'schedule', label: 'Schedule' }, { key: 'project-management', label: 'Project Management' }, { key: 'analysis', label: 'Analysis' },
];
const JOB_STATUSES: JobStatus[] = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];
const VISIT_STATUSES: ServiceVisitStatus[] = ['scheduled', 'in_progress', 'completed', 'skipped', 'cancelled'];
const visitStatusClass: Record<ServiceVisitStatus, string> = { scheduled: 'bg-blue-50 text-blue-700', in_progress: 'bg-amber-50 text-amber-700', completed: 'bg-emerald-50 text-emerald-700', skipped: 'bg-gray-100 text-gray-600', cancelled: 'bg-red-50 text-red-700' };
const visitTime = (visit: ServiceVisit) => visit.scheduleAllDay ? 'All day' : visit.scheduledStartAt?.slice(11, 16) ?? 'Time not set';

function VisitEditor({ visit, services, onClose, onSaved }: { visit?: ServiceVisit; services: ServiceJobService[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const jobId = useParams<{ id: string }>().id ?? '';
  const [serviceId, setServiceId] = useState(visit?.serviceId ?? services[0]?.id ?? '');
  const [scheduledDate, setScheduledDate] = useState(visit?.scheduledDate ?? new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(visit?.scheduledStartAt?.slice(11, 16) ?? '');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [notes, setNotes] = useState(visit?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const values = { scheduledDate, startTime, durationMinutes, notes };
      if (visit) await rescheduleServiceVisit(visit, values);
      else await createManualServiceVisit(jobId, serviceId, values);
      await onSaved(); onClose();
      emitAppToast({ tone: 'success', message: visit ? 'Visit rescheduled.' : 'Visit created.' });
    } catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visit could not be saved.' }); }
    finally { setSaving(false); }
  };
  return <Modal open onClose={onClose} title={visit ? 'Reschedule Visit' : 'Add Visit'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving || !serviceId || !scheduledDate} onClick={() => void save()}><Save /> {saving ? 'Saving...' : 'Save Visit'}</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Select label="Service" value={serviceId} disabled={Boolean(visit)} onChange={(event) => setServiceId(event.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</Select>
      <Input label="Date" type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
      <Input label="Start time" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
      <Input label="Duration (minutes)" type="number" min={1} max={1440} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value) || 60)} />
    </div><TextArea className="mt-4" label="Visit notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
  </Modal>;
}

export default function ServiceJobDetailPage({ currentUserRole }: { currentUserRole: string }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, customers, budgetDivisions, updateJob } = useStore();
  const job = jobs.find((item) => item.id === id);
  const [form, setForm] = useState<Job | null>(job ?? null);
  const [visits, setVisits] = useState<ServiceVisit[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [visitEditor, setVisitEditor] = useState<ServiceVisit | 'new' | null>(null);
  const [visitFilter, setVisitFilter] = useState<ServiceVisitStatus | 'all'>('all');
  const [saving, setSaving] = useState(false);
  const requestedTab = searchParams.get('tab') as Tab | null;
  const tab = TABS.some((item) => item.key === requestedTab) ? requestedTab! : 'overview';
  const canManage = ['owner', 'admin', 'foreman'].includes(currentUserRole);

  useEffect(() => setForm(job ?? null), [job]);
  const loadVisits = useCallback(async () => {
    if (!id) return;
    setLoadingVisits(true);
    try { setVisits((await listServiceVisits(id)).visits); }
    catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visits could not be loaded.' }); }
    finally { setLoadingVisits(false); }
  }, [id]);
  useEffect(() => { void loadVisits(); }, [loadVisits]);

  if (!job || !form) return <EmptyState title="Service Job not found" description="It may have been removed or you may not have access." action={<Button onClick={() => navigate('/jobs/services')}><ArrowLeft /> Service Jobs</Button>} />;
  const services = form.services ?? [];
  const customer = customers.find((item) => item.id === form.customerId);
  const filteredVisits = visits.filter((visit) => visitFilter === 'all' || visit.status === visitFilter);
  const upcoming = visits.filter((visit) => visit.status === 'scheduled' && visit.scheduledDate >= new Date().toISOString().slice(0, 10)).sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate));
  const completed = visits.filter((visit) => visit.status === 'completed').length;
  const readyToBill = visits.filter((visit) => visit.billingStatus === 'ready').length;
  const setField = <K extends keyof Job>(key: K, value: Job[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const saveOverview = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    const saved = await updateJob(job.id, { ...form, workType: 'service', title: form.title.trim(), description: form.description ?? '', notes: form.notes ?? '' });
    setSaving(false); if (saved) emitAppToast({ tone: 'success', message: 'Service Job saved.' });
  };
  const setVisitStatus = async (visit: ServiceVisit, status: ServiceVisitStatus) => {
    try { await updateServiceVisitStatus(visit, status); await loadVisits(); emitAppToast({ tone: 'success', message: `Visit marked ${status.replace('_', ' ')}.` }); }
    catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visit status could not be changed.' }); }
  };
  const generate = async (service: ServiceJobService, sync: boolean) => {
    try { const result = await generateServiceVisits(job.id, service.id, sync); await loadVisits(); emitAppToast({ tone: 'success', message: sync ? `Series updated: ${result.createdCount} added, ${result.cancelledCount ?? 0} cancelled.` : `${result.createdCount} Visits added.` }); }
    catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visits could not be generated.' }); }
  };
  const saveService = async (service: ServiceJobService) => {
    try {
      const result = await updateOperationalService(job.id, service.id, { status: service.status, operationalSchedule: service.operationalSchedule, effectiveFrom: new Date().toISOString().slice(0, 10) });
      setForm(result.job); useStore.setState((state) => ({ jobs: state.jobs.map((item) => item.id === job.id ? result.job : item) }));
      await generate(result.service, true);
    } catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Service schedule could not be saved.' }); }
  };
  const updateServiceForm = (serviceId: string, patch: Partial<ServiceJobService>) => setForm((current) => current ? { ...current, services: (current.services ?? []).map((service) => service.id === serviceId ? { ...service, ...patch } : service) } : current);

  return <div>
    <button type="button" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600" onClick={() => navigate('/jobs/services')}><ArrowLeft size={16} /> Service Jobs</button>
    <PageHeader title={job.title} subtitle={`${job.jobNumber ?? 'Service Job'}${customer ? ` · ${customer.name}` : ''}`} action={<Badge label={form.status} className={statusColor[form.status]} />} />
    <div className="mb-6 overflow-x-auto"><div className="inline-flex min-w-max rounded-xl border border-brand-100 bg-white p-1 dark:border-brand-600 dark:bg-brand-700" role="tablist" aria-label="Service Job sections">{TABS.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === item.key ? 'bg-brand-900 text-white dark:bg-brand-50 dark:text-brand-900' : 'text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-600'}`} onClick={() => setSearchParams({ tab: item.key })}>{item.label}</button>)}</div></div>

    {tab === 'overview' ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-4"><Card className="p-4"><p className="text-xs text-brand-400">Active Services</p><p className="mt-1 text-2xl font-semibold">{services.filter((service) => service.status === 'active').length}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Next Visit</p><p className="mt-1 font-semibold">{upcoming[0] ? formatDate(upcoming[0].scheduledDate) : 'None scheduled'}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Completed Visits</p><p className="mt-1 text-2xl font-semibold">{completed}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Ready to Bill</p><p className="mt-1 text-2xl font-semibold">{readyToBill}</p></Card></div><Card className="p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Agreement</h2>{canManage ? <Button onClick={() => void saveOverview()} disabled={saving}><Save /> {saving ? 'Saving...' : 'Save'}</Button> : null}</div><div className="grid gap-4 sm:grid-cols-2"><Input label="Title" required disabled={!canManage} value={form.title} onChange={(event) => setField('title', event.target.value)} /><Select label="Status" disabled={!canManage} value={form.status} onChange={(event) => setField('status', event.target.value as JobStatus)}>{JOB_STATUSES.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</Select><Input label="Start date" type="date" disabled value={form.startDate} /><Input label="End date" type="date" disabled value={form.endDate ?? ''} /></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><TextArea label="Description" disabled={!canManage} value={form.description} onChange={(event) => setField('description', event.target.value)} /><TextArea label="Internal notes" disabled={!canManage} value={form.notes} onChange={(event) => setField('notes', event.target.value)} /></div></Card></div> : null}

    {tab === 'services' ? <div className="space-y-4">{services.map((service) => { const division = budgetDivisions.find((item) => item.id === service.divisionId); const schedule = service.operationalSchedule; return <Card key={service.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{service.name}</h2><p className="text-sm text-brand-400">{division?.name ?? 'No division'} · {service.billingType.replaceAll('_', ' ')}</p></div><Badge label={service.status} className={service.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'} /></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><Select label="Operational status" disabled={!canManage} value={service.status} onChange={(event) => updateServiceForm(service.id, { status: event.target.value as ServiceJobService['status'] })}><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select><Input label="Service start" type="date" disabled={!canManage} value={schedule.startDate ?? ''} onChange={(event) => updateServiceForm(service.id, { operationalSchedule: { ...schedule, startDate: event.target.value } })} /><Input label="Service end" type="date" disabled={!canManage} value={schedule.endDate ?? ''} onChange={(event) => updateServiceForm(service.id, { operationalSchedule: { ...schedule, endDate: event.target.value } })} /><Input label="Default start time" type="time" disabled={!canManage} value={schedule.startTime ?? ''} onChange={(event) => updateServiceForm(service.id, { operationalSchedule: { ...schedule, startTime: event.target.value } })} /><Input label="Duration (minutes)" type="number" min={1} disabled={!canManage} value={schedule.durationMinutes ?? 60} onChange={(event) => updateServiceForm(service.id, { operationalSchedule: { ...schedule, durationMinutes: Number(event.target.value) || 60 } })} /><Input label="Weekdays (0-6)" disabled={!canManage || service.frequency?.unit !== 'week'} value={(schedule.preferredWeekdays ?? []).join(', ')} onChange={(event) => updateServiceForm(service.id, { operationalSchedule: { ...schedule, preferredWeekdays: event.target.value.split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) } })} /></div>{canManage ? <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => void generate(service, false)}><RefreshCw /> Fill Missing Visits</Button><Button onClick={() => void saveService(service)}><Save /> Save & Update Future</Button></div> : null}</Card>; })}</div> : null}

    {tab === 'visits' ? <div><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><Select label="Status" value={visitFilter} onChange={(event) => setVisitFilter(event.target.value as ServiceVisitStatus | 'all')}><option value="all">All visits</option>{VISIT_STATUSES.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</Select>{canManage ? <Button onClick={() => setVisitEditor('new')}><Plus /> Add Visit</Button> : null}</div>{loadingVisits ? <p className="py-8 text-sm text-brand-400">Loading Visits...</p> : filteredVisits.length === 0 ? <EmptyState icon={<CalendarDays />} title="No Visits found" description="Generate the Service series or add an as-needed Visit." /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-brand-100 text-left text-brand-400"><th className="pb-2">Date</th><th className="pb-2">Service</th><th className="pb-2">Status</th><th className="pb-2">Billing</th><th className="pb-2">Assignments</th><th className="pb-2" /></tr></thead><tbody className="divide-y divide-brand-100">{filteredVisits.map((visit) => <tr key={visit.id}><td className="py-3 font-medium">{formatDate(visit.scheduledDate)}<p className="text-xs font-normal text-brand-400">{visitTime(visit)}</p></td><td className="py-3">{services.find((service) => service.id === visit.serviceId)?.name ?? 'Service'}</td><td className="py-3"><Badge label={visit.status} className={visitStatusClass[visit.status]} /></td><td className="py-3"><Badge label={visit.billingStatus} className="bg-brand-50 text-brand-600" /></td><td className="py-3 text-brand-500">{visit.assignedEmployeeIds.length} people · {visit.assignedEquipmentIds.length} equipment</td><td className="py-3"><div className="flex justify-end gap-1">{canManage && visit.status === 'scheduled' ? <><Button size="sm" variant="ghost" title="Reschedule Visit" onClick={() => setVisitEditor(visit)}><Clock3 /></Button><Button size="sm" variant="ghost" title="Complete Visit" onClick={() => void setVisitStatus(visit, 'completed')}><Check /></Button></> : null}</div></td></tr>)}</tbody></table></div>}</div> : null}

    {tab === 'schedule' ? <div><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Upcoming Visits</h2><p className="text-sm text-brand-400">The company Schedule shows these Visits alongside Project Jobs.</p></div><Button variant="secondary" onClick={() => navigate('/schedule')}><CalendarDays /> Company Schedule</Button></div><div className="space-y-2">{upcoming.slice(0, 20).map((visit) => <Card key={visit.id} className="flex items-center justify-between p-4"><div><p className="font-medium">{services.find((service) => service.id === visit.serviceId)?.name}</p><p className="text-sm text-brand-400">{formatDate(visit.scheduledDate)} · {visitTime(visit)}</p></div><Badge label={visit.status} className={visitStatusClass[visit.status]} /></Card>)}{!upcoming.length ? <EmptyState title="No upcoming Visits" description="Generate a recurrence or add an as-needed Visit." /> : null}</div></div> : null}
    {tab === 'project-management' ? <JobSopsCard jobId={job.id} canManage={canManage} /> : null}
    {tab === 'analysis' ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-4"><Card className="p-4"><p className="text-xs text-brand-400">Contracted Revenue</p><p className="mt-1 text-xl font-semibold">{formatCurrency(form.originalEstimateSnapshot?.contractedRevenue ?? 0)}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Projected Per Visit</p><p className="mt-1 text-xl font-semibold">{formatCurrency(form.originalEstimateSnapshot?.projectedPerVisitRevenue ?? 0)}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Visits Completed</p><p className="mt-1 text-xl font-semibold">{completed} / {visits.filter((visit) => visit.status !== 'cancelled').length}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Billing Ready</p><p className="mt-1 text-xl font-semibold">{readyToBill}</p></Card></div><Card className="p-5"><h2 className="font-semibold">Service performance</h2><p className="mt-2 text-sm text-brand-500">Visit completion and billing readiness use operational records. Actual cost and margin remain unavailable until labour, equipment, and material usage are captured against Visits.</p></Card></div> : null}
    {visitEditor ? <VisitEditor visit={visitEditor === 'new' ? undefined : visitEditor} services={services} onClose={() => setVisitEditor(null)} onSaved={loadVisits} /> : null}
  </div>;
}