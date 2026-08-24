import { useEffect, useMemo, useState } from 'react';
import { CalendarOff, Search } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui';
import TimeOffReviewModal from '../../components/employees/TimeOffReviewModal';
import type { TimeOffRequest, TimeOffRequestType } from '../../types';
import { formatDateTime } from '../../utils';
import { formatTimeOffRange } from '../../utils/timeOff';

const tabs: Array<{ key: 'pending' | 'approved' | 'denied' | 'all'; label: string }> = [{ key: 'pending', label: 'Pending' }, { key: 'approved', label: 'Approved' }, { key: 'denied', label: 'Denied' }, { key: 'all', label: 'All' }];
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function TimeOffRequestsPage() {
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['key']>('pending');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TimeOffRequestType>('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [selected, setSelected] = useState<TimeOffRequest | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/time-off-requests?action=list', { credentials: 'include' });
      const payload = await response.json() as { ok?: boolean; items?: TimeOffRequest[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Could not load time-off requests.');
      setRequests(payload.items ?? []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Could not load time-off requests.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => requests.filter((request) => {
    const statusMatch = activeTab === 'all' || request.status === activeTab;
    const typeMatch = typeFilter === 'all' || request.requestType === typeFilter;
    const searchMatch = !query.trim() || (request.employeeName ?? '').toLowerCase().includes(query.trim().toLowerCase());
    const dateMatch = (!startDateFilter || request.endDate >= startDateFilter) && (!endDateFilter || request.startDate <= endDateFilter);
    return statusMatch && typeMatch && searchMatch && dateMatch;
  }), [activeTab, endDateFilter, query, requests, startDateFilter, typeFilter]);
  const updateRequest = (request: TimeOffRequest) => { setRequests((current) => current.map((item) => item.id === request.id ? { ...item, ...request } : item)); setSelected((current) => current?.id === request.id ? { ...current, ...request } : current); };

  return <div className="space-y-6">
    <PageHeader title="Time Off" subtitle="Which employee availability requests need a decision?" />
    <div className="overflow-x-auto"><div className="inline-flex min-w-max rounded-lg border border-brand-100 bg-white p-1" role="tablist" aria-label="Time-off request status">{tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)} className={`rounded-md px-4 py-2 text-sm font-medium ${activeTab === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-brand-50'}`}>{tab.label}</button>)}</div></div>
    <Card className="overflow-hidden"><div className="grid gap-2 border-b border-brand-100 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_12rem_10rem_10rem]"><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter by employee" placeholder="Search employees..." className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" /></div><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} aria-label="Filter by request type" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="all">All Request Types</option>{(['vacation', 'sick', 'personal', 'unpaid', 'other'] as TimeOffRequestType[]).map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}</select><input type="date" value={startDateFilter} onChange={(event) => setStartDateFilter(event.target.value)} aria-label="Filter from date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><input type="date" value={endDateFilter} onChange={(event) => setEndDateFilter(event.target.value)} aria-label="Filter through date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
      {loading ? <p className="p-5 text-sm text-gray-500">Loading time-off requests...</p> : error ? <div className="p-5"><p className="text-sm text-accent-700">{error}</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Retry</Button></div> : visible.length === 0 ? <div className="p-6"><EmptyState icon={<CalendarOff size={24} />} title={activeTab === 'pending' ? 'No pending time-off requests.' : `No ${activeTab === 'all' ? '' : `${activeTab} `}time-off requests.`} description="Requests will appear here when they match this view." /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500"><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Request Type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3">Reviewed</th></tr></thead><tbody className="divide-y divide-gray-100">{visible.map((request) => <tr key={request.id} tabIndex={0} onClick={() => setSelected(request)} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(request); }} className="cursor-pointer hover:bg-gray-50"><td className="px-4 py-3 font-medium text-gray-900">{request.employeeName}</td><td className="px-4 py-3 text-gray-700">{titleCase(request.requestType)}</td><td className="px-4 py-3 text-gray-700">{formatTimeOffRange(request)}</td><td className="px-4 py-3"><Badge label={titleCase(request.status)} className={request.status === 'approved' ? 'bg-green-50 text-green-700' : request.status === 'denied' ? 'bg-red-50 text-red-700' : request.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'} /></td><td className="px-4 py-3 text-gray-600">{formatDateTime(request.submittedAt)}</td><td className="px-4 py-3 text-gray-600">{request.reviewedAt ? `${request.reviewedByName ?? 'Reviewer'} · ${formatDateTime(request.reviewedAt)}` : '—'}</td></tr>)}</tbody></table></div>}
    </Card>
    <TimeOffReviewModal request={selected} onClose={() => setSelected(null)} onUpdated={updateRequest} />
  </div>;
}
