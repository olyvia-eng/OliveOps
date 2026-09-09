import { useMemo, useState } from 'react';
import type { TimeEntry } from '../../types';
import { durationHours, formatDateTime } from '../../utils';
import { formatTimeEntryDuration, getTimeEntryPresentation } from '../../utils/timeEntryPresentation.js';
import { useStore } from '../../store';
import { Badge, Button, Modal } from '../ui';
import EditTimeEntryModal from './EditTimeEntryModal';
import { Pencil, Trash2 } from 'lucide-react';

interface Props {
  entry: TimeEntry | null;
  employeeName: string;
  currentUserRole: string;
  onClose: () => void;
  onUpdated?: () => void;
  onDeleted?: (timeEntryId: string) => void;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function statusLabel(value: string) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export default function TimeEntryDetailModal({ entry, employeeName, currentUserRole, onClose, onUpdated, onDeleted }: Props) {
  const { jobs, unbillableTimeCategories, timeCorrections, editTimeEntry, deleteTimeEntry } = useStore();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin';
  const presentation = entry ? getTimeEntryPresentation(entry, jobs) : null;
  const corrections = useMemo(() => entry ? timeCorrections
    .filter((correction) => correction.timeEntryId === entry.id)
    .slice()
    .sort((left, right) => Date.parse(right.reviewedAt ?? right.updatedAt ?? right.createdAt) - Date.parse(left.reviewedAt ?? left.updatedAt ?? left.createdAt)) : [], [entry, timeCorrections]);

  if (!entry) return null;
  if (editing) {
    return <EditTimeEntryModal
      entry={entry}
      employeeName={employeeName}
      jobs={jobs}
      unbillableCategories={unbillableTimeCategories}
      onClose={() => setEditing(false)}
      onSave={async (entryId, payload) => {
        const result = await editTimeEntry(entryId, payload);
        if (result.ok) onUpdated?.();
        return result;
      }}
    />;
  }

  const duration = entry.status === 'clocked_in'
    ? 'Active'
    : formatTimeEntryDuration(durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes));
  const latestCorrection = corrections[0];

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    const result = await deleteTimeEntry(entry.id);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error ?? 'Time Entry could not be deleted.');
      return;
    }
    onDeleted?.(entry.id);
    onClose();
  };

  if (confirmingDelete) {
    return <Modal open onClose={() => { if (!deleting) setConfirmingDelete(false); }} title="Delete Time Entry?" size="large" footer={<><Button variant="secondary" disabled={deleting} onClick={() => setConfirmingDelete(false)}>Cancel</Button><Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting...' : 'Delete Time Entry'}</Button></>}>
      <div className="space-y-4">
        <p className="font-medium text-gray-900">Delete this time entry? This will remove it from time tracking and payroll totals.</p>
        <dl className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm sm:grid-cols-2">
          <div><dt className="text-gray-500">Employee</dt><dd className="mt-1 font-medium text-gray-900">{employeeName}</dd></div>
          <div><dt className="text-gray-500">Date</dt><dd className="mt-1 font-medium text-gray-900">{dateLabel(entry.clockIn)}</dd></div>
          <div><dt className="text-gray-500">Clock In</dt><dd className="mt-1 font-medium text-gray-900">{formatDateTime(entry.clockIn)}</dd></div>
          <div><dt className="text-gray-500">Clock Out</dt><dd className="mt-1 font-medium text-gray-900">{entry.clockOut ? formatDateTime(entry.clockOut) : 'Active'}</dd></div>
          <div><dt className="text-gray-500">Activity</dt><dd className="mt-1 font-medium text-gray-900">{presentation?.activityLabel}</dd></div>
          <div><dt className="text-gray-500">Duration</dt><dd className="mt-1 font-medium text-gray-900">{duration}</dd></div>
          <div><dt className="text-gray-500">Job</dt><dd className="mt-1 font-medium text-gray-900">{presentation?.jobLabel ?? 'Not applicable'}</dd></div>
          {presentation?.workAreaLabel ? <div><dt className="text-gray-500">Work Area</dt><dd className="mt-1 font-medium text-gray-900">{presentation.workAreaLabel}</dd></div> : null}
        </dl>
        {deleteError ? <p className="text-sm font-medium text-accent-700" role="alert">{deleteError}</p> : null}
      </div>
    </Modal>;
  }

  return <Modal open onClose={onClose} title="Time Entry Details" size="large" footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{canEdit ? <><Button variant="danger" onClick={() => setConfirmingDelete(true)}><Trash2 size={15} /> Delete</Button><Button onClick={() => setEditing(true)}><Pencil size={15} /> Edit Time Entry</Button></> : null}</>}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-lg font-semibold text-gray-900">Time Entry</p>
        <Badge label={entry.status === 'clocked_in' ? 'Active' : 'Completed'} className={entry.status === 'clocked_in' ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-700'} />
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-gray-500">Employee</dt><dd className="mt-1 font-medium text-gray-900">{employeeName}</dd></div>
        <div><dt className="text-gray-500">Date</dt><dd className="mt-1 font-medium text-gray-900">{dateLabel(entry.clockIn)}</dd></div>
        <div><dt className="text-gray-500">Clock In</dt><dd className="mt-1 font-medium text-gray-900">{formatDateTime(entry.clockIn)}</dd></div>
        <div><dt className="text-gray-500">Clock Out</dt><dd className="mt-1 font-medium text-gray-900">{entry.clockOut ? formatDateTime(entry.clockOut) : 'Active'}</dd></div>
        <div><dt className="text-gray-500">Duration</dt><dd className="mt-1 font-medium text-gray-900">{duration}</dd></div>
        <div><dt className="text-gray-500">Activity</dt><dd className="mt-1 font-medium text-gray-900">{presentation?.activityLabel}</dd></div>
        <div><dt className="text-gray-500">Job</dt><dd className="mt-1 font-medium text-gray-900">{presentation?.jobLabel ?? 'Not applicable'}</dd></div>
        {presentation?.workAreaLabel ? <div><dt className="text-gray-500">Work Area</dt><dd className="mt-1 font-medium text-gray-900">{presentation.workAreaLabel}</dd></div> : null}
      </dl>
      <div><p className="text-sm font-medium text-gray-500">Job Notes</p><p className="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-800">{entry.notes?.trim() || 'No notes'}</p></div>
      {latestCorrection ? <div className="border-t border-gray-100 pt-4"><p className="text-sm font-medium text-gray-700">Latest Correction</p><div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600"><Badge label={statusLabel(latestCorrection.status)} className="bg-gray-100 text-gray-700" /><span>{latestCorrection.reason}</span></div>{latestCorrection.reviewNote ? <p className="mt-2 text-xs text-gray-500">Review note: {latestCorrection.reviewNote}</p> : null}</div> : null}
    </div>
  </Modal>;
}
