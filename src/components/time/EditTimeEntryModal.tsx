import { useEffect, useMemo, useState } from 'react';
import type { TimeEntry, TimeEntryWorkType } from '../../types';
import { durationHours } from '../../utils';
import { formatTimeEntryDuration } from '../../utils/timeEntryPresentation.js';
import { Button, Input, Modal, Select, TextArea } from '../ui';

interface EditableJob {
  id: string;
  title: string;
  operationalWorkAreas?: Array<{ id: string; name: string; sortOrder?: number; status?: string }>;
}

interface UnbillableCategory {
  id: string;
  name: string;
  active: boolean;
}

interface Props {
  entry: TimeEntry | null;
  employeeName: string;
  jobs: EditableJob[];
  unbillableCategories: UnbillableCategory[];
  onClose: () => void;
  onSave: (entryId: string, payload: {
    expectedUpdatedAt: string | null;
    clockIn: string;
    clockOut?: string;
    workType: TimeEntryWorkType;
    jobId?: string;
    workAreaId?: string | null;
    unbillableCategoryId?: string;
    notes: string;
    reason?: string;
  }) => Promise<{ ok: boolean; code?: string; error?: string }>;
}

function toLocalDateTime(isoValue?: string) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(localValue: string) {
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export default function EditTimeEntryModal({ entry, employeeName, jobs, unbillableCategories, onClose, onSave }: Props) {
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [workType, setWorkType] = useState<TimeEntryWorkType>('job');
  const [jobId, setJobId] = useState('');
  const [workAreaId, setWorkAreaId] = useState('');
  const [unbillableCategoryId, setUnbillableCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setClockIn(toLocalDateTime(entry?.clockIn));
    setClockOut(toLocalDateTime(entry?.clockOut));
    setWorkType(entry?.workType ?? 'job');
    setJobId(entry?.jobId ?? entry?.jobIds?.[0] ?? '');
    setWorkAreaId(entry?.workAreaId ?? '');
    setUnbillableCategoryId(entry?.unbillableCategoryId ?? '');
    setNotes(entry?.notes ?? '');
    setReason('');
    setSaving(false);
    setError('');
  }, [entry]);

  const selectedJob = jobs.find((job) => job.id === jobId);
  const workAreas = useMemo(() => (selectedJob?.operationalWorkAreas ?? [])
    .filter((area) => typeof area.id === 'string' && area.id.trim() && typeof area.name === 'string' && area.name.trim())
    .slice()
    .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) || left.name.localeCompare(right.name)), [selectedJob]);
  const clockInIso = toIso(clockIn);
  const clockOutIso = toIso(clockOut);
  const preview = clockInIso && (entry?.status === 'clocked_in' || clockOutIso)
    ? formatTimeEntryDuration(durationHours(clockInIso, clockOutIso || undefined, entry?.breakMinutes ?? 0))
    : '0m';
  const invalidDuration = Boolean(clockInIso && clockOutIso && Date.parse(clockOutIso) <= Date.parse(clockInIso));
  const missingActivityContext = (workType === 'job' && !jobId)
    || (workType === 'non_billable' && !unbillableCategoryId);

  if (!entry) return null;

  const save = async () => {
    if (!clockInIso || invalidDuration || missingActivityContext || saving) return;
    setSaving(true);
    setError('');
    const result = await onSave(entry.id, {
      expectedUpdatedAt: entry.updatedAt ?? null,
      clockIn: clockInIso,
      clockOut: entry.status === 'clocked_out' ? clockOutIso : undefined,
      workType,
      jobId: workType === 'job' ? jobId : undefined,
      workAreaId: workType === 'job' ? workAreaId || null : undefined,
      unbillableCategoryId: workType === 'non_billable' ? unbillableCategoryId : undefined,
      notes,
      reason: reason.trim() || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.code === 'time_entry_conflict'
        ? 'This Time Entry changed after you opened it. Close this form and reload before trying again.'
        : result.error ?? 'Time Entry could not be updated.');
      return;
    }
    onClose();
  };

  return <Modal open onClose={onClose} title="Edit Time Entry" size="large" footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !clockInIso || invalidDuration || missingActivityContext || (entry.status === 'clocked_out' && !clockOutIso)}>{saving ? 'Saving...' : 'Save Changes'}</Button></>}>
    <div className="space-y-4">
      <div className="rounded-md bg-gray-50 px-4 py-3"><p className="text-xs font-medium text-gray-500">Employee</p><p className="mt-1 font-semibold text-gray-900">{employeeName}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Clock In" type="datetime-local" value={clockIn} onChange={(event) => setClockIn(event.target.value)} />
        <Input label="Clock Out" type="datetime-local" value={clockOut} disabled={entry.status === 'clocked_in'} onChange={(event) => setClockOut(event.target.value)} />
      </div>
      {entry.status === 'clocked_in' ? <p className="text-xs text-gray-500">This entry is active. Use Clock Out to end the shift; editing will not create a Clock Out time.</p> : null}
      {invalidDuration ? <p className="text-sm font-medium text-accent-700" role="alert">Clock Out must be after Clock In.</p> : null}
      <div className="rounded-md border border-gray-200 px-4 py-3"><p className="text-xs font-medium text-gray-500">Calculated duration</p><p className="mt-1 text-lg font-semibold text-gray-900">{entry.status === 'clocked_in' ? 'Active' : preview}</p></div>
      <Select label="Activity" value={workType} onChange={(event) => { const next = event.target.value as TimeEntryWorkType; setWorkType(next); if (next !== 'job') { setJobId(''); setWorkAreaId(''); } if (next !== 'non_billable') setUnbillableCategoryId(''); }}>
        <option value="job">Job Work</option>
        <option value="drive_time">Drive Time</option>
        <option value="non_billable">Non-Billable</option>
      </Select>
      {workType === 'job' ? <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Job" value={jobId} onChange={(event) => { setJobId(event.target.value); setWorkAreaId(''); }}><option value="">Select Job</option>{jobs.slice().sort((left, right) => left.title.localeCompare(right.title)).map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</Select>
        <Select label="Work Area" value={workAreaId} onChange={(event) => setWorkAreaId(event.target.value)} disabled={!jobId}><option value="">No Work Area</option>{workAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</Select>
      </div> : null}
      {workType === 'non_billable' ? <Select label="Non-Billable Category" value={unbillableCategoryId} onChange={(event) => setUnbillableCategoryId(event.target.value)}><option value="">Select Category</option>{unbillableCategories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select> : null}
      <TextArea label="Notes" value={notes} maxLength={5000} onChange={(event) => setNotes(event.target.value)} />
      <TextArea label="Reason for change (optional)" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
      {error ? <p className="text-sm font-medium text-accent-700" role="alert">{error}</p> : null}
    </div>
  </Modal>;
}
