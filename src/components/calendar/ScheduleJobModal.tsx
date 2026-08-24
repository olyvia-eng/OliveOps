import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, TextArea } from '../ui';
import type { Crew, Customer, Division, Employee, EquipmentAsset, Job, ID } from '../../types';
import { formatTimeOffType, getEmployeeTimeOffConflicts, type ScheduleTimeOff } from '../../utils/employeeAvailability.js';
import {
  formatCustomerPropertyLabel,
  getAssignedEquipmentForJob,
  getJobAssignmentConflicts,
  getScheduleWindowFromValues,
} from '../../utils/jobSchedule';

type ScheduleFormState = {
  jobId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  crewId: ID;
  divisionId: ID;
  assignedEmployeeIds: ID[];
  assignedEquipmentIds: ID[];
  notes: string;
};

type SchedulePayload = {
  jobId: string;
  startDate: string;
  endDate?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  scheduleAllDay: boolean;
  scheduleConfirmed: boolean;
  scheduleNotes: string;
  crewId?: ID;
  divisionId?: ID;
  assignedEmployeeIds: ID[];
  assignedEquipmentIds: ID[];
};

interface Props {
  open: boolean;
  title: string;
  jobs: Job[];
  customers: Customer[];
  employees: Employee[];
  equipmentAssets: EquipmentAsset[];
  crews: Crew[];
  divisions: Division[];
  initialJobId?: string;
  approvedTimeOff?: ScheduleTimeOff[];
  onClose: () => void;
  onSave: (payload: SchedulePayload) => Promise<boolean>;
}

const buildIsoDateTime = (date: string, time: string) => {
  if (!date || !time) return undefined;
  return `${date}T${time}:00`;
};

const timeValueFromIso = (value?: string) => {
  if (!value) return '';
  const split = value.split('T')[1] ?? '';
  return split.slice(0, 5);
};

const defaultForm = (): ScheduleFormState => ({
  jobId: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  allDay: true,
  crewId: '',
  divisionId: '',
  assignedEmployeeIds: [],
  assignedEquipmentIds: [],
  notes: '',
});

const formFromJob = (job: Job, equipmentAssets: EquipmentAsset[]): ScheduleFormState => ({
  jobId: job.id,
  startDate: job.startDate ?? '',
  endDate: job.endDate ?? job.startDate ?? '',
  startTime: timeValueFromIso(job.scheduledStartAt),
  endTime: timeValueFromIso(job.scheduledEndAt),
  allDay: job.scheduleAllDay !== false,
  crewId: job.crewId ?? '',
  divisionId: job.divisionId ?? '',
  assignedEmployeeIds: [...(job.assignedEmployeeIds ?? [])],
  assignedEquipmentIds: getAssignedEquipmentForJob(job, equipmentAssets).map((asset) => asset.id),
  notes: job.scheduleNotes ?? '',
});

export default function ScheduleJobModal({
  open,
  title,
  jobs,
  customers,
  employees,
  equipmentAssets,
  crews,
  divisions,
  initialJobId,
  approvedTimeOff = [],
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<ScheduleFormState>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [confirmingTimeOff, setConfirmingTimeOff] = useState(false);
  const [rangeTimeOff, setRangeTimeOff] = useState<ScheduleTimeOff[]>(approvedTimeOff);
  const [timeOffLoading, setTimeOffLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    const selected = jobs.find((job) => job.id === (initialJobId ?? jobs[0]?.id)) ?? null;
    if (!selected) {
      setForm(defaultForm());
      return;
    }

    setForm(formFromJob(selected, equipmentAssets));
  }, [equipmentAssets, initialJobId, jobs, open]);

  useEffect(() => {
    if (!open || !form.startDate) return;
    const controller = new AbortController();
    const endDate = form.endDate || form.startDate;
    setTimeOffLoading(true);
    void fetch(`/api/time-off-requests?action=schedule&startDate=${form.startDate}&endDate=${endDate}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; items?: ScheduleTimeOff[] } }))
      .then(({ response, payload }) => { if (response.ok && payload.ok) setRangeTimeOff(payload.items ?? []); })
      .catch((error: Error) => { if (error.name !== 'AbortError') setRangeTimeOff([]); })
      .finally(() => { if (!controller.signal.aborted) setTimeOffLoading(false); });
    return () => controller.abort();
  }, [form.endDate, form.startDate, open]);

  const selectedJob = useMemo(() => jobs.find((job) => job.id === form.jobId) ?? null, [form.jobId, jobs]);
  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedJob?.customerId) ?? null,
    [customers, selectedJob?.customerId]
  );
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const equipmentById = useMemo(() => new Map(equipmentAssets.map((asset) => [asset.id, asset])), [equipmentAssets]);
  const crewById = useMemo(() => new Map(crews.map((crew) => [crew.id, crew])), [crews]);
  const availableEquipment = useMemo(
    () => equipmentAssets.filter((asset) => !asset.currentJobId || asset.currentJobId === selectedJob?.id),
    [equipmentAssets, selectedJob?.id]
  );

  useEffect(() => {
    if (!open || !selectedJob) return;
    setForm((current) => {
      if (current.jobId !== selectedJob.id) return current;
      if (current.startDate === selectedJob.startDate && current.notes === (selectedJob.scheduleNotes ?? '')) {
        return current;
      }
      return formFromJob(selectedJob, equipmentAssets);
    });
  }, [equipmentAssets, open, selectedJob]);

  const toggleEmployee = (employeeId: string) => {
    setForm((current) => ({
      ...current,
      assignedEmployeeIds: current.assignedEmployeeIds.includes(employeeId)
        ? current.assignedEmployeeIds.filter((value) => value !== employeeId)
        : [...current.assignedEmployeeIds, employeeId],
    }));
  };

  const toggleEquipment = (equipmentId: string) => {
    setForm((current) => ({
      ...current,
      assignedEquipmentIds: current.assignedEquipmentIds.includes(equipmentId)
        ? current.assignedEquipmentIds.filter((value) => value !== equipmentId)
        : [...current.assignedEquipmentIds, equipmentId],
    }));
  };

  const draftScheduleWindow = useMemo(() => {
    return getScheduleWindowFromValues({
      startDate: form.startDate,
      endDate: form.endDate || form.startDate,
      scheduledStartAt: form.allDay ? undefined : buildIsoDateTime(form.startDate, form.startTime),
      scheduledEndAt: form.allDay ? undefined : buildIsoDateTime(form.endDate || form.startDate, form.endTime || form.startTime),
      scheduleAllDay: form.allDay,
    });
  }, [form.allDay, form.endDate, form.endTime, form.startDate, form.startTime]);

  const assignmentConflicts = useMemo(() => {
    if (!selectedJob) return [];

    return getJobAssignmentConflicts({
      jobId: selectedJob.id,
      jobs,
      scheduleWindow: draftScheduleWindow,
      crewId: form.crewId || undefined,
      assignedEmployeeIds: form.assignedEmployeeIds,
      assignedEquipmentIds: form.assignedEquipmentIds,
    });
  }, [draftScheduleWindow, form.assignedEmployeeIds, form.assignedEquipmentIds, form.crewId, jobs, selectedJob]);
  const timeOffConflicts = useMemo(() => getEmployeeTimeOffConflicts({
    employeeIds: form.assignedEmployeeIds,
    crewId: form.crewId || undefined,
    crews,
    startDate: form.startDate,
    endDate: form.endDate || form.startDate,
    approvedTimeOff: rangeTimeOff,
  }), [crews, form.assignedEmployeeIds, form.crewId, form.endDate, form.startDate, rangeTimeOff]);
  const employeeAvailability = useMemo(() => new Map(employees.map((employee) => [employee.id, getEmployeeTimeOffConflicts({
    employeeIds: [employee.id],
    crews,
    startDate: form.startDate,
    endDate: form.endDate || form.startDate,
    approvedTimeOff: rangeTimeOff,
  })])), [crews, employees, form.endDate, form.startDate, rangeTimeOff]);

  useEffect(() => {
    setConfirmingTimeOff(false);
  }, [form.assignedEmployeeIds, form.crewId, form.endDate, form.startDate]);

  const crewConflicts = assignmentConflicts.filter((conflict) => conflict.conflictingCrewId);
  const employeeConflicts = assignmentConflicts.filter((conflict) => conflict.conflictingEmployeeIds.length > 0);
  const equipmentConflicts = assignmentConflicts.filter((conflict) => conflict.conflictingEquipmentIds.length > 0);

  const formatConflictWindow = (start: Date, end: Date, allDay: boolean) => {
    if (allDay) {
      const startLabel = format(start, 'MMM d');
      const endLabel = format(end, 'MMM d');
      return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
    }

    const startLabel = format(start, 'MMM d, h:mm a');
    const endLabel = format(end, 'MMM d, h:mm a');
    return `${startLabel} - ${endLabel}`;
  };

  const performSave = async () => {
    if (!selectedJob || !form.startDate) return;
    setSaving(true);
    const saved = await onSave({
      jobId: selectedJob.id,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      scheduledStartAt: form.allDay ? undefined : buildIsoDateTime(form.startDate, form.startTime),
      scheduledEndAt: form.allDay ? undefined : buildIsoDateTime(form.endDate || form.startDate, form.endTime || form.startTime),
      scheduleAllDay: form.allDay,
      scheduleConfirmed: true,
      scheduleNotes: form.notes.trim(),
      crewId: form.crewId || undefined,
      divisionId: form.divisionId || undefined,
      assignedEmployeeIds: form.assignedEmployeeIds,
      assignedEquipmentIds: form.assignedEquipmentIds,
    });
    setSaving(false);
    if (saved) onClose();
  };

  const handleSave = async () => {
    if (timeOffLoading) return;
    if (timeOffConflicts.length > 0) {
      setConfirmingTimeOff(true);
      return;
    }
    await performSave();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={(
        confirmingTimeOff ? <><Button variant="secondary" onClick={() => setConfirmingTimeOff(false)}>Go Back</Button><Button onClick={() => void performSave()} disabled={saving}>{saving ? 'Saving…' : 'Schedule Anyway'}</Button></> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void handleSave()} disabled={!selectedJob || !form.startDate || saving || timeOffLoading}>{saving ? 'Saving…' : timeOffLoading ? 'Checking availability…' : 'Save Schedule'}</Button></>
      )}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-gray-700 dark:text-brand-200">Job</label>
              <select
                value={form.jobId}
                onChange={(event) => {
                  const nextJob = jobs.find((job) => job.id === event.target.value);
                  setForm(nextJob ? formFromJob(nextJob, equipmentAssets) : defaultForm());
                }}
                className="mt-1 h-10 w-full rounded-xl border border-brand-100 bg-white px-3 text-sm text-brand-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50"
              >
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.title}</option>
                ))}
              </select>
            </div>
            <Select label="Primary Crew" value={form.crewId} onChange={(event) => setForm((current) => ({ ...current, crewId: event.target.value }))}>
              <option value="">No primary crew</option>
              {crews.filter((crew) => crew.active).map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
            </Select>
            <Select label="Division" value={form.divisionId} onChange={(event) => setForm((current) => ({ ...current, divisionId: event.target.value }))}>
              <option value="">No division</option>
              {divisions.filter((division) => division.active).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)).map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
            </Select>
            <Input label="Start Date *" type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
            <Input label="End Date *" type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
            <label className="flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/70 px-3 py-2 text-sm text-brand-800 dark:border-brand-600 dark:bg-brand-800 dark:text-brand-100 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(event) => setForm((current) => ({ ...current, allDay: event.target.checked }))}
              />
              All Day
            </label>
            <Input label="Start Time" type="time" value={form.startTime} disabled={form.allDay} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} />
            <Input label="End Time" type="time" value={form.endTime} disabled={form.allDay} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} />
            <div className="sm:col-span-2">
              <TextArea label="Notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
          <div className="rounded-2xl border border-brand-100 p-4 dark:border-brand-600">
            <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Assigned Employees</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {employees.map((employee) => {
                const selected = form.assignedEmployeeIds.includes(employee.id);
                const unavailable = employeeAvailability.get(employee.id) ?? [];
                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => toggleEmployee(employee.id)}
                    className={`rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${selected ? 'border-brand-500 bg-brand-100 text-brand-800 dark:border-brand-300 dark:bg-brand-600 dark:text-brand-50' : 'border-brand-100 bg-white text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-200 dark:hover:bg-brand-600'}`}
                  >
                    <span className="block font-medium">{employee.name}</span>
                    <span className={`block text-[11px] ${unavailable.length ? 'text-rose-700 dark:text-rose-200' : 'text-brand-400 dark:text-brand-300'}`}>{unavailable.length ? `${formatTimeOffType(unavailable[0].requestType)} · Unavailable` : 'Available'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {confirmingTimeOff ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
              <div className="flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-700" /><div><h3 className="text-sm font-semibold">{timeOffConflicts.length} {timeOffConflicts.length === 1 ? 'employee is' : 'employees are'} unavailable</h3><p className="mt-1 text-xs text-rose-700">Approved Time Off overlaps this scheduled work. You can go back or acknowledge the conflict and schedule anyway.</p></div></div>
              <div className="mt-3 space-y-2">{timeOffConflicts.map((conflict) => <div key={conflict.requestId} className="rounded-xl border border-rose-200 bg-white/70 p-3"><p className="text-sm font-semibold">{conflict.employeeName}</p><p className="mt-1 text-xs text-rose-700">{formatTimeOffType(conflict.requestType)} · {conflict.startDate === conflict.endDate ? conflict.startDate : `${conflict.startDate} - ${conflict.endDate}`}{conflict.fromCrew ? ' · Crew member' : ''}</p></div>)}</div>
            </div>
          ) : null}
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 dark:border-brand-600 dark:bg-brand-800/70">
            <div className="flex flex-wrap items-start gap-2">
              <Badge label={selectedJob?.status ?? 'job'} className="bg-brand-100 text-brand-700 dark:bg-brand-600 dark:text-brand-100" />
            </div>
            <h3 className="mt-3 text-lg font-semibold text-brand-900 dark:text-brand-50">{selectedJob?.title ?? 'Select a job'}</h3>
            <p className="mt-1 text-sm text-brand-500 dark:text-brand-200">{selectedJob ? formatCustomerPropertyLabel(selectedJob, selectedCustomer) : 'Choose a job to derive the property and customer details.'}</p>
          </div>

          {crewConflicts.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 text-amber-600" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Crew overlap warning</h3>
                  <div className="mt-2 space-y-3 text-sm">
                    {crewConflicts.map((conflict) => (
                      <div key={`crew-conflict-${conflict.job.id}`} className="rounded-xl border border-amber-200 bg-white/70 p-3">
                        <p className="font-medium">{conflict.job.title}</p>
                        <p className="mt-1 text-xs text-amber-700">{formatConflictWindow(conflict.schedule.start, conflict.schedule.end, conflict.schedule.allDay)}</p>
                        <p className="mt-1 text-xs text-amber-800">Crew: {crewById.get(conflict.conflictingCrewId ?? '')?.name ?? conflict.conflictingCrewId}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {employeeConflicts.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 text-amber-600" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Employee overlap warning</h3>
                  <div className="mt-2 space-y-3 text-sm">
                    {employeeConflicts.map((conflict) => (
                      <div key={`employee-conflict-${conflict.job.id}`} className="rounded-xl border border-amber-200 bg-white/70 p-3">
                        <p className="font-medium">{conflict.job.title}</p>
                        <p className="mt-1 text-xs text-amber-700">{formatConflictWindow(conflict.schedule.start, conflict.schedule.end, conflict.schedule.allDay)}</p>
                        <p className="mt-1 text-xs text-amber-800">
                          Conflicting employees: {conflict.conflictingEmployeeIds.map((employeeId) => employeeById.get(employeeId)?.name ?? employeeId).join(', ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {equipmentConflicts.length > 0 ? (
            <div className="rounded-2xl border border-accent-200 bg-accent-50 p-4 text-accent-900">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 text-accent-700" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Equipment conflict warning</h3>
                  <div className="mt-2 space-y-3 text-sm">
                    {equipmentConflicts.map((conflict) => (
                      <div key={`equipment-conflict-${conflict.job.id}`} className="rounded-xl border border-accent-200 bg-white/70 p-3">
                        <p className="font-medium">{conflict.job.title}</p>
                        <p className="mt-1 text-xs text-accent-700">{formatConflictWindow(conflict.schedule.start, conflict.schedule.end, conflict.schedule.allDay)}</p>
                        <p className="mt-1 text-xs text-accent-800">
                          Conflicting equipment: {conflict.conflictingEquipmentIds.map((assetId) => equipmentById.get(assetId)?.name ?? assetId).join(', ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-brand-100 p-4 dark:border-brand-600">
            <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Assigned Equipment</h3>
            <p className="mt-1 text-xs text-brand-400 dark:text-brand-200">Equipment is optional in Phase 1 and only shows assets not already linked to another job.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {availableEquipment.length === 0 ? (
                <p className="text-sm text-brand-400 dark:text-brand-200">No unassigned equipment is available.</p>
              ) : availableEquipment.map((asset) => {
                const selected = form.assignedEquipmentIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleEquipment(asset.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${selected ? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/20 dark:text-accent-100' : 'border-brand-100 bg-white text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-200 dark:hover:bg-brand-600'}`}
                  >
                    {asset.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}