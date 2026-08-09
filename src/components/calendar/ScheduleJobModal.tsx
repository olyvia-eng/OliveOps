import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, Modal, TextArea } from '../ui';
import type { Customer, Employee, EquipmentAsset, Job, ID } from '../../types';
import { formatCustomerPropertyLabel, getAssignedEquipmentForJob } from '../../utils/jobSchedule';

type ScheduleFormState = {
  jobId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
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
  initialJobId?: string;
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
  assignedEmployeeIds: [...job.assignedEmployeeIds],
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
  initialJobId,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<ScheduleFormState>(defaultForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    const selected = jobs.find((job) => job.id === (initialJobId ?? jobs[0]?.id)) ?? null;
    if (!selected) {
      setForm(defaultForm());
      return;
    }

    setForm(formFromJob(selected, equipmentAssets));
  }, [equipmentAssets, initialJobId, jobs, open]);

  const selectedJob = useMemo(() => jobs.find((job) => job.id === form.jobId) ?? null, [form.jobId, jobs]);
  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedJob?.customerId) ?? null,
    [customers, selectedJob?.customerId]
  );
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

  const handleSave = async () => {
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
      assignedEmployeeIds: form.assignedEmployeeIds,
      assignedEquipmentIds: form.assignedEquipmentIds,
    });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!selectedJob || !form.startDate || saving}>
            {saving ? 'Saving…' : 'Save Schedule'}
          </Button>
        </>
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
                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => toggleEmployee(employee.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${selected ? 'border-brand-500 bg-brand-100 text-brand-800 dark:border-brand-300 dark:bg-brand-600 dark:text-brand-50' : 'border-brand-100 bg-white text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-200 dark:hover:bg-brand-600'}`}
                  >
                    {employee.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 dark:border-brand-600 dark:bg-brand-800/70">
            <div className="flex flex-wrap items-start gap-2">
              <Badge label={selectedJob?.status ?? 'job'} className="bg-brand-100 text-brand-700 dark:bg-brand-600 dark:text-brand-100" />
            </div>
            <h3 className="mt-3 text-lg font-semibold text-brand-900 dark:text-brand-50">{selectedJob?.title ?? 'Select a job'}</h3>
            <p className="mt-1 text-sm text-brand-500 dark:text-brand-200">{selectedJob ? formatCustomerPropertyLabel(selectedJob, selectedCustomer) : 'Choose a job to derive the property and customer details.'}</p>
          </div>

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