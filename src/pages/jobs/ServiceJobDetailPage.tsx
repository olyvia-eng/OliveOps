import { Children, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Check, Clock3, FileCheck2, Image, Plus, RefreshCw, Save, Search, StickyNote, UserRound, Wrench, X } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import JobSopsCard from '../../components/jobs/JobSopsCard';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { Customer, Employee, EquipmentAsset, Job, JobStatus, ServiceJobService, ServiceVisit, ServiceVisitStatus } from '../../types';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import { addServiceVisitNote, completeServiceVisit, createManualServiceVisit, generateServiceVisits, getServiceVisitDetail, listServiceVisits, rescheduleServiceVisit, updateOperationalService, updateServiceVisitAssignments, type ServiceVisitDetail } from './serviceVisitApi';

type Tab = 'overview' | 'services' | 'visits' | 'schedule' | 'project-management' | 'analysis';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' }, { key: 'services', label: 'Services' }, { key: 'visits', label: 'Visits' },
  { key: 'schedule', label: 'Schedule' }, { key: 'project-management', label: 'Project Management' }, { key: 'analysis', label: 'Analysis' },
];
const JOB_STATUSES: JobStatus[] = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];
const VISIT_STATUSES: ServiceVisitStatus[] = ['scheduled', 'in_progress', 'completed', 'skipped', 'cancelled'];
const visitStatusClass: Record<ServiceVisitStatus, string> = { scheduled: 'bg-blue-50 text-blue-700', in_progress: 'bg-amber-50 text-amber-700', completed: 'bg-emerald-50 text-emerald-700', skipped: 'bg-gray-100 text-gray-600', cancelled: 'bg-red-50 text-red-700' };
const visitTime = (visit: ServiceVisit) => visit.scheduleAllDay ? 'All day' : visit.scheduledStartAt?.slice(11, 16) ?? 'Time not set';
const assignmentSummary = (visit: ServiceVisit) => `${visit.assignedEmployeeIds.length} ${visit.assignedEmployeeIds.length === 1 ? 'person' : 'people'} · ${visit.assignedEquipmentIds.length} equipment`;

function AssignmentPicker({ title, icon, search, onSearch, placeholder, empty, children }: { title: string; icon: ReactNode; search: string; onSearch: (value: string) => void; placeholder: string; empty: string; children: ReactNode }) {
  return <section><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-900 dark:text-brand-50">{icon}{title}</div><label className="relative block"><Search className="absolute left-3 top-2.5 text-brand-400" size={16} /><span className="sr-only">{placeholder}</span><input className="h-10 w-full rounded-md border border-brand-200 bg-white pl-9 pr-3 text-sm dark:border-brand-500 dark:bg-brand-800" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} /></label><div className="mt-2 max-h-56 overflow-y-auto border-y border-brand-100 dark:border-brand-600">{Children.count(children) ? children : <p className="py-3 text-sm text-brand-400">{empty}</p>}</div></section>;
}

function AssignmentOption({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle?: string; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className="flex w-full items-center gap-3 border-b border-brand-100 px-1 py-3 text-left last:border-0 hover:bg-brand-50 dark:border-brand-600 dark:hover:bg-brand-600"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${selected ? 'border-brand-700 bg-brand-700 text-white' : 'border-brand-200 bg-white'}`}>{selected ? <Check size={13} /> : null}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-brand-900 dark:text-brand-50">{title}</span>{subtitle ? <span className="block text-xs capitalize text-brand-400">{subtitle}</span> : null}</span></button>;
}

function VisitAssignmentDrawer({ visit, service, customer, site, employees, equipmentAssets, futureVisitCount, onClose, onSaved }: { visit: ServiceVisit; service?: ServiceJobService; customer?: Customer; site: string; employees: Employee[]; equipmentAssets: EquipmentAsset[]; futureVisitCount: number; onClose: () => void; onSaved: (updatedVisits: ServiceVisit[]) => void }) {
  const [employeeIds, setEmployeeIds] = useState(visit.assignedEmployeeIds ?? []);
  const [equipmentIds, setEquipmentIds] = useState(visit.assignedEquipmentIds ?? []);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingFuture, setConfirmingFuture] = useState(false);
  const activeEmployees = employees.filter((employee) => (employee.active || employeeIds.includes(employee.id)) && `${employee.name} ${employee.role}`.toLowerCase().includes(employeeSearch.trim().toLowerCase()));
  const availableEquipment = equipmentAssets.filter((asset) => (asset.status !== 'inactive' || equipmentIds.includes(asset.id)) && `${asset.name} ${asset.type}`.toLowerCase().includes(equipmentSearch.trim().toLowerCase()));
  const toggle = (ids: string[], id: string, setIds: (value: string[]) => void) => setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const save = async (applyToFuture: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateServiceVisitAssignments(visit, employeeIds, equipmentIds, applyToFuture);
      onSaved(result.updatedVisits);
      emitAppToast({ tone: 'success', message: applyToFuture ? `Assignments saved and applied to ${result.appliedToFutureCount} future Visit${result.appliedToFutureCount === 1 ? '' : 's'}.` : 'Visit assignments saved.' });
      onClose();
    } catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visit assignments could not be saved.' }); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50"><button type="button" className="absolute inset-0 bg-black/35" aria-label="Close Visit assignments" onClick={onClose} /><aside className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-brand-100 bg-white shadow-2xl dark:border-brand-600 dark:bg-brand-700" aria-label="Visit assignments">
    <div className="flex items-start justify-between border-b border-brand-100 p-5 dark:border-brand-600"><div><p className="text-xs font-semibold uppercase text-brand-400">Visit assignments</p><h2 className="mt-1 text-xl font-semibold text-brand-900 dark:text-brand-50">{service?.name ?? 'Service Visit'}</h2><p className="mt-1 text-sm text-brand-500 dark:text-brand-200">{formatDate(visit.scheduledDate)} · {visitTime(visit)}</p></div><button type="button" className="grid h-9 w-9 place-items-center rounded-md text-brand-400 hover:bg-brand-50" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
    <div className="flex-1 space-y-6 overflow-y-auto p-5"><div className="border-b border-brand-100 pb-4 text-sm dark:border-brand-600"><p className="font-medium text-brand-900 dark:text-brand-50">{customer?.name ?? 'Client'}</p><p className="mt-1 text-brand-500 dark:text-brand-200">{site || 'No property or site specified'}</p></div>
      <AssignmentPicker title="Assigned Employees" icon={<UserRound size={16} />} search={employeeSearch} onSearch={setEmployeeSearch} placeholder="Search employees" empty="No active employees found.">{activeEmployees.map((employee) => <AssignmentOption key={employee.id} selected={employeeIds.includes(employee.id)} title={employee.name} subtitle={employee.role.replaceAll('_', ' ')} onClick={() => toggle(employeeIds, employee.id, setEmployeeIds)} />)}</AssignmentPicker>
      <AssignmentPicker title="Assigned Equipment" icon={<Wrench size={16} />} search={equipmentSearch} onSearch={setEquipmentSearch} placeholder="Search equipment" empty="No active equipment found.">{availableEquipment.map((asset) => <AssignmentOption key={asset.id} selected={equipmentIds.includes(asset.id)} title={asset.name} subtitle={asset.type} onClick={() => toggle(equipmentIds, asset.id, setEquipmentIds)} />)}</AssignmentPicker>
    </div>
    <div className="space-y-2 border-t border-brand-100 p-5 dark:border-brand-600">{confirmingFuture ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Apply to {futureVisitCount} future scheduled Visit{futureVisitCount === 1 ? '' : 's'}?</p><p className="mt-1 text-xs">Completed and in-progress Visits will not be changed.</p><div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" disabled={saving} onClick={() => setConfirmingFuture(false)}>Cancel</Button><Button size="sm" disabled={saving} onClick={() => void save(true)}>Confirm and apply</Button></div></div> : <><Button className="w-full" disabled={saving} onClick={() => void save(false)}><Save /> {saving ? 'Saving...' : 'Save assignments'}</Button><Button className="w-full" variant="secondary" disabled={saving || visit.status !== 'scheduled' || futureVisitCount === 0} onClick={() => setConfirmingFuture(true)}>Apply assignments to future visits</Button></>}</div>
  </aside></div>;
}

function VisitEditor({ visit, services, employees, onClose, onSaved }: { visit?: ServiceVisit; services: ServiceJobService[]; employees: ReturnType<typeof useStore.getState>['employees']; onClose: () => void; onSaved: () => Promise<void> }) {
  const jobId = useParams<{ id: string }>().id ?? '';
  const [serviceId, setServiceId] = useState(visit?.serviceId ?? services[0]?.id ?? '');
  const [scheduledDate, setScheduledDate] = useState(visit?.scheduledDate ?? new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(visit?.scheduledStartAt?.slice(11, 16) ?? '');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [notes, setNotes] = useState(visit?.notes ?? '');
  const [assignedForemanId, setAssignedForemanId] = useState(visit?.assignedForemanId ?? '');
  const [assignedCrewEmployeeIds, setAssignedCrewEmployeeIds] = useState<string[]>(visit?.assignedCrewEmployeeIds ?? visit?.assignedEmployeeIds?.filter((id) => id !== visit.assignedForemanId) ?? []);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const values = { scheduledDate, startTime, durationMinutes, notes, assignedForemanId: assignedForemanId || null, assignedCrewEmployeeIds };
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
    </div><div className="mt-4 grid gap-4 sm:grid-cols-2"><Select label="Assigned Foreman" value={assignedForemanId} onChange={(event) => setAssignedForemanId(event.target.value)}><option value="">No assigned Foreman</option>{employees.filter((employee) => employee.active && employee.role === 'foreman').map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select><div><p className="mb-1 text-sm font-medium text-gray-700">Assigned Crew</p><div className="flex flex-wrap gap-2">{employees.filter((employee) => employee.active).map((employee) => { const selected = assignedCrewEmployeeIds.includes(employee.id); return <button key={employee.id} type="button" aria-pressed={selected} onClick={() => setAssignedCrewEmployeeIds((current) => selected ? current.filter((id) => id !== employee.id) : [...current, employee.id])} className={`rounded-md border px-2.5 py-1.5 text-sm ${selected ? 'border-brand-700 bg-brand-700 text-white' : 'border-brand-100 bg-white text-brand-700'}`}>{selected ? <Check size={13} className="mr-1 inline" /> : null}{employee.name}</button>; })}</div></div></div><TextArea className="mt-4" label="Visit notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
  </Modal>;
}

export default function ServiceJobDetailPage({ currentUserRole }: { currentUserRole: string }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, customers, employees, equipmentAssets, budgetDivisions, updateJob } = useStore();
  const job = jobs.find((item) => item.id === id);
  const [form, setForm] = useState<Job | null>(job ?? null);
  const [visits, setVisits] = useState<ServiceVisit[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [visitEditor, setVisitEditor] = useState<ServiceVisit | 'new' | null>(null);
  const [selectedVisit, setSelectedVisit] = useState<ServiceVisit | null>(null);
  const [assignmentVisit, setAssignmentVisit] = useState<ServiceVisit | null>(null);
  const [visitFilter, setVisitFilter] = useState<ServiceVisitStatus | 'all'>('all');
  const [saving, setSaving] = useState(false);
  const requestedTab = searchParams.get('tab') as Tab | null;
  const requestedVisitId = searchParams.get('visit');
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
  useEffect(() => { if (requestedVisitId) setSelectedVisit(visits.find((visit) => visit.id === requestedVisitId) ?? null); }, [requestedVisitId, visits]);

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
  const setVisitStatus = (visit: ServiceVisit, _status: ServiceVisitStatus) => setSelectedVisit(visit);
  const mergeUpdatedVisits = (updatedVisits: ServiceVisit[]) => setVisits((current) => { const updates = new Map(updatedVisits.map((visit) => [visit.id, visit])); return current.map((visit) => updates.get(visit.id) ?? visit); });
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

    {tab === 'visits' ? <div><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><Select label="Status" value={visitFilter} onChange={(event) => setVisitFilter(event.target.value as ServiceVisitStatus | 'all')}><option value="all">All visits</option>{VISIT_STATUSES.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</Select>{canManage ? <Button onClick={() => setVisitEditor('new')}><Plus /> Add Visit</Button> : null}</div>{loadingVisits ? <p className="py-8 text-sm text-brand-400">Loading Visits...</p> : filteredVisits.length === 0 ? <EmptyState icon={<CalendarDays />} title="No Visits found" description="Generate the Service series or add an as-needed Visit." /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-brand-100 text-left text-brand-400"><th className="pb-2">Date</th><th className="pb-2">Service</th><th className="pb-2">Status</th><th className="pb-2">Billing</th><th className="pb-2">Assignments</th><th className="pb-2" /></tr></thead><tbody className="divide-y divide-brand-100">{filteredVisits.map((visit) => { const assignedNames = [...visit.assignedEmployeeIds.map((employeeId) => employees.find((employee) => employee.id === employeeId)?.name).filter(Boolean), ...visit.assignedEquipmentIds.map((assetId) => equipmentAssets.find((asset) => asset.id === assetId)?.name).filter(Boolean)].join(', '); return <tr key={visit.id} tabIndex={0} className="cursor-pointer hover:bg-brand-50/70 focus:bg-brand-50 focus:outline-none dark:hover:bg-brand-600" onClick={() => setSelectedVisit(visit)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedVisit(visit); } }}><td className="py-3 font-medium">{formatDate(visit.scheduledDate)}<p className="text-xs font-normal text-brand-400">{visitTime(visit)}</p></td><td className="py-3">{services.find((service) => service.id === visit.serviceId)?.name ?? 'Service'}</td><td className="py-3"><Badge label={visit.status} className={visitStatusClass[visit.status]} /></td><td className="py-3"><Badge label={visit.billingStatus} className="bg-brand-50 text-brand-600" /></td><td className="py-3"><button type="button" title={assignedNames || 'No assignments'} className="font-medium text-brand-600 hover:underline" onClick={(event) => { event.stopPropagation(); if (canManage) setAssignmentVisit(visit); }}>{assignmentSummary(visit)}</button></td><td className="py-3"><div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>{canManage && visit.status === 'scheduled' ? <><Button size="sm" variant="ghost" title="Reschedule Visit" onClick={() => setVisitEditor(visit)}><Clock3 /></Button><Button size="sm" variant="ghost" title="Complete Visit" onClick={() => void setVisitStatus(visit, 'completed')}><Check /></Button></> : null}</div></td></tr>; })}</tbody></table></div>}</div> : null}

    {tab === 'schedule' ? <div><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Upcoming Visits</h2><p className="text-sm text-brand-400">The company Schedule shows these Visits alongside Project Jobs.</p></div><Button variant="secondary" onClick={() => navigate('/schedule')}><CalendarDays /> Company Schedule</Button></div><div className="space-y-2">{upcoming.slice(0, 20).map((visit) => <Card key={visit.id} className="flex items-center justify-between p-4"><div><p className="font-medium">{services.find((service) => service.id === visit.serviceId)?.name}</p><p className="text-sm text-brand-400">{formatDate(visit.scheduledDate)} · {visitTime(visit)}</p></div><Badge label={visit.status} className={visitStatusClass[visit.status]} /></Card>)}{!upcoming.length ? <EmptyState title="No upcoming Visits" description="Generate a recurrence or add an as-needed Visit." /> : null}</div></div> : null}
    {tab === 'project-management' ? <JobSopsCard jobId={job.id} canManage={canManage} /> : null}
    {tab === 'analysis' ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-4"><Card className="p-4"><p className="text-xs text-brand-400">Contracted Revenue</p><p className="mt-1 text-xl font-semibold">{formatCurrency(form.originalEstimateSnapshot?.contractedRevenue ?? 0)}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Projected Per Visit</p><p className="mt-1 text-xl font-semibold">{formatCurrency(form.originalEstimateSnapshot?.projectedPerVisitRevenue ?? 0)}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Visits Completed</p><p className="mt-1 text-xl font-semibold">{completed} / {visits.filter((visit) => visit.status !== 'cancelled').length}</p></Card><Card className="p-4"><p className="text-xs text-brand-400">Billing Ready</p><p className="mt-1 text-xl font-semibold">{readyToBill}</p></Card></div><Card className="p-5"><h2 className="font-semibold">Service performance</h2><p className="mt-2 text-sm text-brand-500">Visit completion and billing readiness use operational records. Actual cost and margin remain unavailable until labour, equipment, and material usage are captured against Visits.</p></Card></div> : null}
    {visitEditor ? <VisitEditor visit={visitEditor === 'new' ? undefined : visitEditor} services={services} employees={employees} onClose={() => setVisitEditor(null)} onSaved={loadVisits} /> : null}
    {assignmentVisit ? <VisitAssignmentDrawer visit={assignmentVisit} service={services.find((service) => service.id === assignmentVisit.serviceId)} customer={customer} site={form.propertyLabel || form.propertyAddressSnapshot || customer?.properties?.[0]?.nickname || customer?.address?.nickname || ''} employees={employees} equipmentAssets={equipmentAssets} futureVisitCount={visits.filter((visit) => visit.id !== assignmentVisit.id && visit.serviceId === assignmentVisit.serviceId && visit.status === 'scheduled' && (visit.scheduledStartAt ?? `${visit.scheduledDate}T00:00:00`) > (assignmentVisit.scheduledStartAt ?? `${assignmentVisit.scheduledDate}T00:00:00`)).length} onClose={() => setAssignmentVisit(null)} onSaved={mergeUpdatedVisits} /> : null}
    {selectedVisit ? <VisitDetail visit={selectedVisit} onClose={() => { setSelectedVisit(null); if (requestedVisitId) { const next = new URLSearchParams(searchParams); next.delete('visit'); setSearchParams(next, { replace: true }); } }} onChanged={loadVisits} /> : null}
  </div>;
}

function VisitDetail({ visit, onClose, onChanged }: { visit: ServiceVisit; onClose: () => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<ServiceVisitDetail | null>(null);
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    try { setDetail(await getServiceVisitDetail(visit)); }
    catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visit details could not be loaded.' }); }
  }, [visit]);
  useEffect(() => { void load(); }, [load]);
  const addNote = async () => {
    if (!note.trim() || working) return;
    setWorking(true);
    try { await addServiceVisitNote(visit, note.trim(), crypto.randomUUID()); setNote(''); await load(); await onChanged(); }
    catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visit note could not be added.' }); }
    finally { setWorking(false); }
  };
  const complete = async () => {
    if (working) return;
    setWorking(true);
    try { await completeServiceVisit(visit, crypto.randomUUID()); await onChanged(); onClose(); emitAppToast({ tone: 'success', message: 'Visit completed.' }); }
    catch (error) { emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Visit could not be completed.' }); }
    finally { setWorking(false); }
  };
  return <Modal open onClose={onClose} title="Visit details" size="large" footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{detail && ['scheduled', 'in_progress'].includes(detail.visit.status) ? <Button disabled={working} onClick={() => void complete()}><Check /> Complete Visit</Button> : null}</>}>
    {!detail ? <p className="py-8 text-sm text-brand-400">Loading Visit...</p> : <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold">{detail.service.name}</p><p className="text-sm text-brand-400">{formatDate(detail.visit.scheduledDate)} · {visitTime(detail.visit)}</p></div><Badge label={detail.visit.status} className={visitStatusClass[detail.visit.status]} /></div>
      <div className="grid gap-3 sm:grid-cols-4"><Card className="p-3"><p className="text-xs text-brand-400">Time Entries</p><p className="mt-1 text-xl font-semibold">{detail.timeEntries.length}</p></Card><Card className="p-3"><p className="text-xs text-brand-400">Forms</p><p className="mt-1 text-xl font-semibold">{detail.formSubmissions.length}</p></Card><Card className="p-3"><p className="text-xs text-brand-400">Photos</p><p className="mt-1 text-xl font-semibold">{detail.photos.length}</p></Card><Card className="p-3"><p className="text-xs text-brand-400">SOPs</p><p className="mt-1 text-xl font-semibold">{detail.sops.length}</p></Card></div>
      {detail.analysis ? <div><h3 className="mb-2 text-sm font-semibold">Estimated vs actual</h3><dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-brand-400">Labour hours</dt><dd className="font-medium">{detail.analysis.actualLabourHours} / {detail.analysis.estimatedLabourHours}</dd></div><div><dt className="text-brand-400">Visit cost</dt><dd className="font-medium">{formatCurrency(detail.analysis.actualVisitCost)} / {formatCurrency(detail.analysis.estimatedCostPerVisit)}</dd></div><div><dt className="text-brand-400">Cost variance</dt><dd className="font-medium">{formatCurrency(detail.analysis.costVariance)}</dd></div></dl></div> : null}
      <div><h3 className="mb-2 text-sm font-semibold">Field activity</h3>{detail.timeEntries.length ? <div className="divide-y divide-brand-100 border-y border-brand-100">{detail.timeEntries.map((entry) => <div key={entry.id} className="flex justify-between gap-3 py-2 text-sm"><span>{entry.employeeName ?? 'Employee'} · {new Date(entry.clockIn).toLocaleString()}</span><Badge label={entry.status === 'clocked_in' ? 'Active' : 'Closed'} className={entry.status === 'clocked_in' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'} /></div>)}</div> : <p className="text-sm text-brand-400">No time recorded.</p>}</div>
      <div><div className="mb-2 flex items-center gap-2"><FileCheck2 size={16} /><h3 className="text-sm font-semibold">Completion evidence</h3></div><p className="text-sm text-brand-500">{detail.completion.activeTimeEntryCount ? `${detail.completion.activeTimeEntryCount} active timer(s)` : 'All timers closed'} · {detail.completion.missingFormIds.length ? `${detail.completion.missingFormIds.length} required Form(s) outstanding` : 'Required Forms complete'} · {detail.completion.photoCount} photo(s)</p></div>
      <div><div className="mb-2 flex items-center gap-2"><StickyNote size={16} /><h3 className="text-sm font-semibold">Visit notes</h3></div><div className="space-y-2">{detail.visit.visitNotes?.map((item) => <div key={item.id} className="border-l-2 border-brand-200 pl-3 text-sm"><p>{item.text}</p><p className="mt-1 text-xs text-brand-400">{item.authorName ?? 'Employee'} · {new Date(item.createdAt).toLocaleString()}</p></div>)}{!detail.visit.visitNotes?.length ? <p className="text-sm text-brand-400">No Visit notes.</p> : null}</div><div className="mt-3 flex items-end gap-2"><TextArea className="flex-1" label="Add note" value={note} onChange={(event) => setNote(event.target.value)} /><Button title="Add Visit note" disabled={!note.trim() || working} onClick={() => void addNote()}><StickyNote /> Add</Button></div></div>
      {detail.photos.length ? <div><div className="mb-2 flex items-center gap-2"><Image size={16} /><h3 className="text-sm font-semibold">Photos</h3></div><div className="flex flex-wrap gap-2">{detail.photos.map((photo) => <Badge key={photo.id} label={photo.fileName} className="bg-brand-50 text-brand-600" />)}</div></div> : null}
    </div>}
  </Modal>;
}