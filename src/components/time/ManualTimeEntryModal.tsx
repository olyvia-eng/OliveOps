import { useEffect, useMemo, useState } from 'react';
import type { Employee, Job, TimeEntry, TimeEntryWorkType, UnbillableTimeCategory } from '../../types';
import { durationHours } from '../../utils';
import { formatTimeEntryDuration } from '../../utils/timeEntryPresentation.js';
import { Button, Input, Modal, Select, TextArea } from '../ui';

interface ManualTimeEntryInput {
  employeeId: string;
  workType: TimeEntryWorkType;
  jobId?: string;
  workAreaId?: string;
  unbillableCategoryId?: string;
  clockIn: string;
  clockOut: string;
  notes?: string;
}

interface Props {
  open: boolean;
  employees: Employee[];
  jobs: Job[];
  unbillableCategories: UnbillableTimeCategory[];
  fixedJobId?: string;
  onClose: () => void;
  onSave: (payload: ManualTimeEntryInput) => Promise<{ ok: boolean; code?: string; error?: string; timeEntry?: TimeEntry }>;
  onCreated: (entry: TimeEntry) => void;
}

function localDateAndTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function toIso(date: string, time: string) {
  if (!date || !time) return '';
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export default function ManualTimeEntryModal({ open, employees, jobs, unbillableCategories, fixedJobId, onClose, onSave, onCreated }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [workType, setWorkType] = useState<TimeEntryWorkType>('job');
  const [jobId, setJobId] = useState('');
  const [workAreaId, setWorkAreaId] = useState('');
  const [unbillableCategoryId, setUnbillableCategoryId] = useState('');
  const [clockInDate, setClockInDate] = useState('');
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutDate, setClockOutDate] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const clockOut = new Date();
    clockOut.setSeconds(0, 0);
    const clockIn = new Date(clockOut.getTime() - 60 * 60 * 1000);
    const start = localDateAndTime(clockIn);
    const end = localDateAndTime(clockOut);
    setEmployeeId('');
    setWorkType('job');
    setJobId(fixedJobId ?? '');
    setWorkAreaId('');
    setUnbillableCategoryId('');
    setClockInDate(start.date);
    setClockInTime(start.time);
    setClockOutDate(end.date);
    setClockOutTime(end.time);
    setNotes('');
    setSaving(false);
    setError('');
  }, [fixedJobId, open]);

  const selectedJob = jobs.find((job) => job.id === (fixedJobId ?? jobId));
  const workAreas = useMemo(() => (selectedJob?.operationalWorkAreas ?? [])
    .filter((area) => typeof area.id === 'string' && area.id.trim() && typeof area.name === 'string' && area.name.trim())
    .slice()
    .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) || left.name.localeCompare(right.name)), [selectedJob]);
  const clockIn = toIso(clockInDate, clockInTime);
  const clockOut = toIso(clockOutDate, clockOutTime);
  const invalidDuration = Boolean(clockIn && clockOut && Date.parse(clockOut) <= Date.parse(clockIn));
  const duration = clockIn && clockOut && !invalidDuration ? formatTimeEntryDuration(durationHours(clockIn, clockOut, 0)) : '0m';
  const selectedJobId = fixedJobId ?? jobId;
  const workAreaRequired = workType === 'job' && workAreas.length > 0;
  const missingRequired = !employeeId || !clockIn || !clockOut
    || (workType === 'job' && (!selectedJobId || (workAreaRequired && !workAreaId)))
    || (workType === 'non_billable' && !unbillableCategoryId);

  if (!open) return null;

  const submit = async () => {
    if (saving || missingRequired || invalidDuration) return;
    setSaving(true);
    setError('');
    const result = await onSave({
      employeeId,
      workType,
      jobId: selectedJobId || undefined,
      workAreaId: workType === 'job' ? workAreaId || undefined : undefined,
      unbillableCategoryId: workType === 'non_billable' ? unbillableCategoryId : undefined,
      clockIn,
      clockOut,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (!result.ok || !result.timeEntry) {
      setError(result.error ?? 'Time Entry could not be added.');
      return;
    }
    onCreated(result.timeEntry);
    onClose();
  };

  return <Modal open onClose={onClose} title="Add Time Entry" size="wide" footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void submit()} disabled={saving || missingRequired || invalidDuration}>{saving ? 'Adding...' : 'Add Time Entry'}</Button></>}>
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Employee" required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
          <option value="">Select Employee</option>
          {employees.slice().sort((left, right) => left.name.localeCompare(right.name)).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{employee.active ? '' : ' (Inactive)'}</option>)}
        </Select>
        <Select label="Activity" required value={workType} onChange={(event) => { const next = event.target.value as TimeEntryWorkType; setWorkType(next); setWorkAreaId(''); if (next !== 'non_billable') setUnbillableCategoryId(''); }}>
          <option value="job">Job Work</option>
          <option value="drive_time">Drive Time</option>
          <option value="non_billable">Non-Billable</option>
        </Select>
      </div>

      {fixedJobId ? <div className="rounded-md bg-gray-50 px-4 py-3"><p className="text-xs font-medium text-gray-500">Job</p><p className="mt-1 font-semibold text-gray-900">{selectedJob?.title ?? 'Current Job'}</p></div> : workType !== 'non_billable' ? <Select label="Job" required={workType === 'job'} value={jobId} onChange={(event) => { setJobId(event.target.value); setWorkAreaId(''); }}><option value="">{workType === 'job' ? 'Select Job' : 'No Job'}</option>{jobs.slice().sort((left, right) => left.title.localeCompare(right.title)).map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</Select> : null}

      {workType === 'job' ? <Select label="Work Area" required={workAreaRequired} value={workAreaId} onChange={(event) => setWorkAreaId(event.target.value)} disabled={!selectedJobId}>
        <option value="">{workAreaRequired ? 'Select Work Area' : 'No Work Area'}</option>
        {workAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
      </Select> : null}

      {workType === 'non_billable' ? <Select label="Category" required value={unbillableCategoryId} onChange={(event) => setUnbillableCategoryId(event.target.value)}><option value="">Select Category</option>{unbillableCategories.filter((category) => category.active).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid grid-cols-2 gap-2"><legend className="mb-1.5 text-sm font-medium text-gray-700">Clock In <span className="text-accent-700">*</span></legend><Input aria-label="Clock In date" type="date" value={clockInDate} onChange={(event) => setClockInDate(event.target.value)} /><Input aria-label="Clock In time" type="time" value={clockInTime} onChange={(event) => setClockInTime(event.target.value)} /></fieldset>
        <fieldset className="grid grid-cols-2 gap-2"><legend className="mb-1.5 text-sm font-medium text-gray-700">Clock Out <span className="text-accent-700">*</span></legend><Input aria-label="Clock Out date" type="date" value={clockOutDate} onChange={(event) => setClockOutDate(event.target.value)} /><Input aria-label="Clock Out time" type="time" value={clockOutTime} onChange={(event) => setClockOutTime(event.target.value)} /></fieldset>
      </div>
      {invalidDuration ? <p className="text-sm font-medium text-accent-700" role="alert">Clock Out must be after Clock In.</p> : null}
      <div className="rounded-md border border-gray-200 px-4 py-3"><p className="text-xs font-medium text-gray-500">Calculated duration</p><p className="mt-1 text-lg font-semibold text-gray-900">{duration}</p></div>
      <TextArea label="Notes" maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      {error ? <p className="text-sm font-medium text-accent-700" role="alert">{error}</p> : null}
    </div>
  </Modal>;
}