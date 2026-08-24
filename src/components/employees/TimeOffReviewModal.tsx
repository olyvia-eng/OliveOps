import { useEffect, useState } from 'react';
import type { TimeOffRequest } from '../../types';
import { Badge, Button, Modal, TextArea } from '../ui';
import { formatDateTime } from '../../utils';
import { formatTimeOffRange } from '../../utils/timeOff';

const typeLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

interface Props {
  request: TimeOffRequest | null;
  onClose: () => void;
  onUpdated: (request: TimeOffRequest) => void;
}

export default function TimeOffReviewModal({ request, onClose, onUpdated }: Props) {
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setReviewNote(request?.reviewNote ?? ''); setError(''); }, [request]);
  if (!request) return null;

  const review = async (action: 'approve' | 'deny') => {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/time-off-requests?action=${action}&id=${encodeURIComponent(request.id)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewNote }) });
      const payload = await response.json() as { ok?: boolean; error?: string; request?: TimeOffRequest };
      if (payload.request) onUpdated(payload.request);
      if (!response.ok || !payload.ok) { setError(response.status === 409 ? 'This request was already resolved. The latest status is shown.' : payload.error ?? 'Time-off request could not be reviewed.'); return; }
      onClose();
    } catch { setError('Time-off request could not be reviewed. Try again.'); }
    finally { setSaving(false); }
  };

  return <Modal open onClose={onClose} title="Time Off Request" size="large" footer={request.status === 'pending' ? <><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="danger" disabled={saving} onClick={() => void review('deny')}>Deny</Button><Button disabled={saving} onClick={() => void review('approve')}>Approve</Button></> : <Button variant="secondary" onClick={onClose}>Close</Button>}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold text-gray-900">{request.employeeName ?? 'Employee'}</p><p className="mt-1 text-sm text-gray-600">{typeLabel(request.requestType)} · {formatTimeOffRange(request)}</p></div><Badge label={typeLabel(request.status)} className={request.status === 'approved' ? 'bg-green-50 text-green-700' : request.status === 'denied' ? 'bg-red-50 text-red-700' : request.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'} /></div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Submitted</dt><dd className="mt-1 font-medium text-gray-900">{formatDateTime(request.submittedAt)}</dd></div>{request.reviewedAt ? <div><dt className="text-gray-500">Reviewed</dt><dd className="mt-1 font-medium text-gray-900">{formatDateTime(request.reviewedAt)}{request.reviewedByName ? ` by ${request.reviewedByName}` : ''}</dd></div> : null}</dl>
      <div><p className="text-sm font-medium text-gray-700">Employee Note</p><p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{request.employeeNote || 'No note provided.'}</p></div>
      {request.status === 'pending' ? <TextArea label="Manager Note (optional)" value={reviewNote} maxLength={2000} onChange={(event) => setReviewNote(event.target.value)} /> : request.reviewNote ? <div><p className="text-sm font-medium text-gray-700">Manager Note</p><p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{request.reviewNote}</p></div> : null}
      {error ? <p className="text-sm font-medium text-accent-700" role="alert">{error}</p> : null}
    </div>
  </Modal>;
}
