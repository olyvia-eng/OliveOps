import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Download, Ellipsis, Mail, Pencil, Phone, Trash2 } from 'lucide-react';
import type { BusinessUserRole } from '../../auth/types';
import EmployeeEditModal from '../../components/employees/EmployeeEditModal';
import TimeOffReviewModal from '../../components/employees/TimeOffReviewModal';
import DetailWorkspaceTabs, { type DetailWorkspaceTab } from '../../components/detail-workspace/DetailWorkspaceTabs';
import { Badge, Button, Card, EmptyState, Modal, Select } from '../../components/ui';
import { useStore } from '../../store';
import type { TimeEntry, TimeOffRequest } from '../../types';
import { durationHours, formatDateTime } from '../../utils';
import { parseStorageApiResponse } from '../../utils/fileUpload';
import { buildEffectiveTimeEntries } from '../../utils/timeCorrections';
import { getTimeEntryWorkLabel } from '../../utils/timeEntryPresentation.js';
import { formatTimeOffRange } from '../../utils/timeOff';
import { getEmployeeRangeStart, scopeEmployeeProfileRecords } from './employeeProfileModel.js';

interface EmployeeProfilePageProps {
  currentUserRole: BusinessUserRole;
}

type ProfileTab = 'overview' | 'scorecard' | 'time-attendance' | 'time-off' | 'training' | 'documents';
type DateRange = '30-days' | '90-days' | 'year-to-date';

interface EmployeeFileRecord {
  id: string;
  fileName: string;
  originalFileName?: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  category?: string;
  entityType?: string;
  entityId?: string;
}

const tabs: Array<DetailWorkspaceTab<ProfileTab>> = [
  { key: 'overview', label: 'Overview' },
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'time-attendance', label: 'Time & Attendance' },
  { key: 'time-off', label: 'Time Off' },
  { key: 'training', label: 'Training' },
  { key: 'documents', label: 'Documents' },
];

const tabKeys = new Set<ProfileTab>(tabs.map((tab) => tab.key));

const roleLabel = (role: string) => role.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

function entryWorkLabel(entry: TimeEntry, jobs: Array<{ id: string; title: string }>) {
  return getTimeEntryWorkLabel(entry, jobs);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmployeeProfilePage({ currentUserRole }: EmployeeProfilePageProps) {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { employees, crews, divisions, jobs, timeEntries, timeCorrections, formSubmissions, deleteEmployee } = useStore();
  const [editOpen, setEditOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('30-days');
  const [employeeFiles, setEmployeeFiles] = useState<EmployeeFileRecord[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState('');
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [timeOffLoading, setTimeOffLoading] = useState(false);
  const [timeOffError, setTimeOffError] = useState('');
  const [selectedTimeOff, setSelectedTimeOff] = useState<TimeOffRequest | null>(null);

  const employee = employees.find((item) => item.id === employeeId) ?? null;
  const requestedTab = searchParams.get('tab') as ProfileTab | null;
  const activeTab = requestedTab && tabKeys.has(requestedTab) ? requestedTab : 'overview';
  const canManageEmployee = currentUserRole === 'owner' || currentUserRole === 'admin';

  const employeeCrews = useMemo(() => crews.filter((crew) => crew.leadEmployeeId === employeeId || crew.memberIds.includes(employeeId ?? '')), [crews, employeeId]);
  const employeeDivisions = useMemo(() => {
    const divisionIds = new Set(employeeCrews.map((crew) => crew.defaultDivisionId).filter((id): id is string => Boolean(id)));
    return divisions.filter((division) => divisionIds.has(division.id));
  }, [divisions, employeeCrews]);
  const effectiveTimeEntries = useMemo(() => buildEffectiveTimeEntries(timeEntries, timeCorrections), [timeCorrections, timeEntries]);
  const scopedRecords = useMemo(() => scopeEmployeeProfileRecords({ employeeId, timeEntries: effectiveTimeEntries, timeCorrections, formSubmissions }), [effectiveTimeEntries, employeeId, formSubmissions, timeCorrections]);
  const employeeEntries = useMemo(() => scopedRecords.timeEntries.sort((left, right) => Date.parse(right.clockIn) - Date.parse(left.clockIn)), [scopedRecords.timeEntries]);
  const employeeCorrections = useMemo(() => scopedRecords.timeCorrections.sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt)), [scopedRecords.timeCorrections]);
  const employeeSubmissions = scopedRecords.formSubmissions;
  const activeEntry = employeeEntries.find((entry) => entry.status === 'clocked_in') ?? null;
  const pendingCorrections = employeeCorrections.filter((correction) => correction.status === 'pending');
  const selectedRangeStart = getEmployeeRangeStart(dateRange);
  const rangeEntries = employeeEntries.filter((entry) => Date.parse(entry.clockIn) >= selectedRangeStart.getTime());
  const rangeCorrections = employeeCorrections.filter((correction) => Date.parse(correction.submittedAt) >= selectedRangeStart.getTime());
  const rangeSubmissions = employeeSubmissions.filter((submission) => Date.parse(submission.submittedAt) >= selectedRangeStart.getTime());
  const totalHours = rangeEntries.reduce((sum, entry) => sum + durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes), 0);
  const rangeDays = Math.max(1, Math.ceil((Date.now() - selectedRangeStart.getTime()) / 86_400_000));
  const averageWeeklyHours = totalHours / Math.max(1, rangeDays / 7);
  const localToday = new Date();
  const todayKey = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
  const employeeTimeOff = timeOffRequests.filter((request) => request.employeeId === employeeId);
  const pendingTimeOff = employeeTimeOff.filter((request) => request.status === 'pending');
  const upcomingApprovedTimeOff = employeeTimeOff.filter((request) => request.status === 'approved' && request.endDate >= todayKey).sort((left, right) => left.startDate.localeCompare(right.startDate));
  const pastTimeOff = employeeTimeOff.filter((request) => request.status === 'denied' || request.status === 'cancelled' || (request.status === 'approved' && request.endDate < todayKey));

  useEffect(() => {
    if ((activeTab !== 'overview' && activeTab !== 'time-off') || !canManageEmployee) return;
    let cancelled = false;
    setTimeOffLoading(true); setTimeOffError('');
    void fetch('/api/time-off-requests?action=list', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; items?: TimeOffRequest[]; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Could not load time-off requests.');
        if (!cancelled) setTimeOffRequests(payload.items ?? []);
      })
      .catch((error) => { if (!cancelled) setTimeOffError(error instanceof Error ? error.message : 'Could not load time-off requests.'); })
      .finally(() => { if (!cancelled) setTimeOffLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, canManageEmployee]);

  useEffect(() => {
    if (activeTab !== 'documents' || !employeeId) return;
    let cancelled = false;
    setDocumentsLoading(true);
    setDocumentsError('');
    void fetch('/api/storage?view=files&entityType=employee', { credentials: 'include' })
      .then(async (response) => parseStorageApiResponse(response, 'Could not load employee documents.') as Promise<{ ok?: boolean; files?: EmployeeFileRecord[] }>)
      .then((payload) => {
        if (!cancelled && payload.ok) setEmployeeFiles(scopeEmployeeProfileRecords({ employeeId, timeEntries: [], timeCorrections: [], formSubmissions: [], files: payload.files ?? [] }).files);
      })
      .catch((error) => {
        if (!cancelled) setDocumentsError(error instanceof Error ? error.message : 'Could not load employee documents.');
      })
      .finally(() => {
        if (!cancelled) setDocumentsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab, employeeId]);

  const selectTab = (tab: ProfileTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const downloadDocument = async (file: EmployeeFileRecord) => {
    const response = await fetch('/api/storage', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prepare-download', fileId: file.id }),
    });
    const payload = await parseStorageApiResponse(response, 'Download could not be prepared.') as { downloadUrl?: string };
    if (payload.downloadUrl) window.open(payload.downloadUrl, '_blank', 'noopener,noreferrer');
  };

  if (!employee) {
    return (
      <div className="space-y-6">
        <Link to="/employees" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"><ChevronLeft size={16} /> Employees</Link>
        <Card className="p-6"><EmptyState title="Employee not found" description="This employee may have been deleted or is no longer available." action={<Button onClick={() => navigate('/employees')}>Back to Employees</Button>} /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-2 text-sm text-gray-500" aria-label="Breadcrumb"><Link to="/employees" className="hover:text-brand-700">Employees</Link><span>/</span><span className="font-medium text-gray-800">{employee.name}</span></nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold text-gray-900">{employee.name}</h1><Badge label={employee.active ? 'Active' : 'Inactive'} className={employee.active ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'} /></div>
          <p className="mt-1 text-sm text-gray-600">{roleLabel(employee.role)}{employeeCrews.length > 0 ? ` · ${employeeCrews.map((crew) => crew.name).join(', ')}` : ''}</p>
          {employeeDivisions.length > 0 ? <p className="mt-1 text-xs text-gray-500">{employeeDivisions.map((division) => division.name).join(', ')}</p> : null}
        </div>
        {canManageEmployee ? <div className="relative flex gap-2"><Button onClick={() => setEditOpen(true)}><Pencil size={15} /> Edit Employee</Button><Button variant="secondary" aria-label="More employee actions" onClick={() => setMoreOpen((current) => !current)}><Ellipsis size={17} /></Button>{moreOpen ? <div className="absolute right-0 top-11 z-20 min-w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"><button type="button" onClick={() => { setMoreOpen(false); setDeleteOpen(true); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-accent-700 hover:bg-accent-50"><Trash2 size={14} /> Delete Employee</button></div> : null}</div> : null}
      </div>

      <DetailWorkspaceTabs tabs={tabs} activeTab={activeTab} onChange={selectTab} />

      {activeTab === 'overview' ? <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5"><h2 className="font-semibold text-gray-900">Employment</h2><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-gray-500">Employee ID</dt><dd className="mt-1 font-medium text-gray-900">{employee.id}</dd></div><div><dt className="text-gray-500">Role</dt><dd className="mt-1 font-medium text-gray-900">{roleLabel(employee.role)}</dd></div><div><dt className="text-gray-500">Status</dt><dd className="mt-1 font-medium text-gray-900">{employee.active ? 'Active' : 'Inactive'}</dd></div><div><dt className="text-gray-500">Labour Type</dt><dd className="mt-1 font-medium text-gray-900">{roleLabel(employee.labourType ?? 'field_producing')}</dd></div><div><dt className="text-gray-500">Crew</dt><dd className="mt-1 font-medium text-gray-900">{employeeCrews.length ? employeeCrews.map((crew) => crew.name).join(', ') : 'Not assigned'}</dd></div><div><dt className="text-gray-500">Division</dt><dd className="mt-1 font-medium text-gray-900">{employeeDivisions.length ? employeeDivisions.map((division) => division.name).join(', ') : 'Not assigned'}</dd></div></dl></Card>
        <Card className="p-5"><h2 className="font-semibold text-gray-900">Contact</h2><div className="mt-4 space-y-3 text-sm"><p className="flex items-center gap-2 text-gray-700"><Mail size={15} className="text-gray-400" /> {employee.email || 'No email recorded'}</p><p className="flex items-center gap-2 text-gray-700"><Phone size={15} className="text-gray-400" /> {employee.phone || 'No phone recorded'}</p><p className="text-gray-500">Account access: <span className="font-medium text-gray-900">{employee.userId ? 'Linked' : 'Not linked'}</span></p></div></Card>
        <Card className="p-5"><h2 className="font-semibold text-gray-900">Current Activity</h2>{activeEntry ? <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4"><p className="font-semibold text-brand-800">Clocked In</p><p className="mt-1 text-sm text-brand-700">{entryWorkLabel(activeEntry, jobs)}</p><p className="mt-1 text-xs text-brand-600">Since {formatDateTime(activeEntry.clockIn)}</p></div> : <p className="mt-4 text-sm text-gray-500">Not currently clocked in.</p>}<div className="mt-4 border-t border-gray-100 pt-4"><p className="text-xs font-semibold uppercase text-gray-500">Recent time activity</p>{employeeEntries.slice(0, 3).map((entry) => <div key={entry.id} className="mt-3 flex justify-between gap-3 text-sm"><div><p className="font-medium text-gray-800">{entryWorkLabel(entry, jobs)}</p><p className="text-xs text-gray-500">{formatDateTime(entry.clockIn)}</p></div><span className="font-medium text-gray-700">{durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes).toFixed(2)}h</span></div>)}{employeeEntries.length === 0 ? <p className="mt-3 text-sm text-gray-500">No time activity yet.</p> : null}</div></Card>
        <Card className="p-5"><h2 className="font-semibold text-gray-900">Attention</h2><div className="mt-4 space-y-3"><div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3"><div><p className="text-sm font-medium text-gray-800">Pending time corrections</p><p className="text-xs text-gray-500">Requests awaiting review</p></div><span className="text-lg font-semibold text-gray-900">{pendingCorrections.length}</span></div><div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3"><div><p className="text-sm font-medium text-gray-800">Submitted forms</p><p className="text-xs text-gray-500">Recorded form submissions</p></div><span className="text-lg font-semibold text-gray-900">{employeeSubmissions.length}</span></div></div></Card>
        <Card className="p-5"><h2 className="font-semibold text-gray-900">Upcoming Time Off</h2>{timeOffLoading ? <p className="mt-4 text-sm text-gray-500">Loading time off...</p> : upcomingApprovedTimeOff[0] ? <button type="button" onClick={() => { selectTab('time-off'); setSelectedTimeOff(upcomingApprovedTimeOff[0]); }} className="mt-4 w-full rounded-lg bg-brand-50 p-4 text-left"><p className="font-medium text-brand-800">{roleLabel(upcomingApprovedTimeOff[0].requestType)}</p><p className="mt-1 text-sm text-brand-700">{formatTimeOffRange(upcomingApprovedTimeOff[0])}</p></button> : <p className="mt-4 text-sm text-gray-500">No upcoming approved time off.</p>}</Card>
      </div> : null}

      {activeTab === 'scorecard' ? <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Employee Scorecard</h2><p className="text-sm text-gray-500">Objective activity metrics from recorded OliveOps data. No composite score is calculated.</p></div><Select label="Date Range" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}><option value="30-days">Last 30 Days</option><option value="90-days">Last 90 Days</option><option value="year-to-date">Year to Date</option></Select></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card className="p-4"><p className="text-sm text-gray-500">Recorded Hours</p><p className="mt-1 text-2xl font-semibold text-gray-900">{totalHours.toFixed(2)}h</p></Card><Card className="p-4"><p className="text-sm text-gray-500">Average Weekly Hours</p><p className="mt-1 text-2xl font-semibold text-gray-900">{averageWeeklyHours.toFixed(2)}h</p></Card><Card className="p-4"><p className="text-sm text-gray-500">Time Corrections</p><p className="mt-1 text-2xl font-semibold text-gray-900">{rangeCorrections.length}</p></Card><Card className="p-4"><p className="text-sm text-gray-500">Forms Submitted</p><p className="mt-1 text-2xl font-semibold text-gray-900">{rangeSubmissions.length}</p></Card></div><Card className="p-5"><h3 className="font-semibold text-gray-900">Deferred Metrics</h3><p className="mt-2 text-sm text-gray-600">Overtime, missed shifts, certification status, required-form completion, and training progress are not calculated because OliveOps does not yet store the schedules or domain records needed to support them reliably.</p></Card></div> : null}

      {activeTab === 'time-attendance' ? <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Time & Attendance</h2><p className="text-sm text-gray-500">Authoritative employee time entries with approved corrections applied.</p></div><Select label="Date Range" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}><option value="30-days">Last 30 Days</option><option value="90-days">Last 90 Days</option><option value="year-to-date">Year to Date</option></Select></div><div className="grid gap-4 sm:grid-cols-3"><Card className="p-4"><p className="text-sm text-gray-500">Total Hours</p><p className="mt-1 text-2xl font-semibold text-gray-900">{totalHours.toFixed(2)}h</p></Card><Card className="p-4"><p className="text-sm text-gray-500">Time Entries</p><p className="mt-1 text-2xl font-semibold text-gray-900">{rangeEntries.length}</p></Card><Card className="p-4"><p className="text-sm text-gray-500">Overtime Hours</p><p className="mt-1 text-sm font-semibold text-gray-700">Not tracked separately</p></Card></div><Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4"><h3 className="font-semibold text-gray-900">Time Entry History</h3><Link to="/time-reports" className="text-sm font-medium text-brand-700 hover:text-brand-800">Open Time Reports</Link></div>{rangeEntries.length === 0 ? <p className="p-5 text-sm text-gray-500">No time entries in this period.</p> : <div className="divide-y divide-gray-100">{rangeEntries.map((entry) => <div key={entry.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_180px_90px]"><div><p className="font-medium text-gray-900">{entryWorkLabel(entry, jobs)}</p><p className="mt-1 text-xs text-gray-500">{entry.notes || 'No notes'}</p></div><p className="text-gray-600">{formatDateTime(entry.clockIn)}<br />{entry.clockOut ? formatDateTime(entry.clockOut) : 'Active'}</p><p className="font-semibold text-gray-900 sm:text-right">{durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes).toFixed(2)}h</p></div>)}</div>}</Card><Card className="overflow-hidden"><div className="border-b border-gray-100 p-4"><h3 className="font-semibold text-gray-900">Time Corrections</h3></div>{employeeCorrections.length === 0 ? <p className="p-5 text-sm text-gray-500">No time correction requests.</p> : <div className="divide-y divide-gray-100">{employeeCorrections.slice(0, 10).map((correction) => <div key={correction.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><p className="font-medium text-gray-900">{roleLabel(correction.requestType)}</p><p className="text-xs text-gray-500">{formatDateTime(correction.submittedAt)} · {correction.reason}</p></div><div className="flex items-center gap-3"><Badge label={roleLabel(correction.status)} className="bg-gray-100 text-gray-700" />{correction.status === 'pending' ? <Link to={`/time-reports?correctionStatus=pending&correctionId=${encodeURIComponent(correction.id)}`} className="font-medium text-brand-700">Review</Link> : null}</div></div>)}</div>}</Card></div> : null}

      {activeTab === 'time-off' ? <div className="space-y-5">{timeOffLoading ? <Card className="p-5"><p className="text-sm text-gray-500">Loading time-off requests...</p></Card> : timeOffError ? <Card className="p-5"><p className="text-sm text-accent-700">{timeOffError}</p></Card> : employeeTimeOff.length === 0 ? <Card className="p-6"><EmptyState title="No time-off requests yet." description="Submitted requests and approval history will appear here." /></Card> : ([['Pending Requests', pendingTimeOff], ['Upcoming Approved', upcomingApprovedTimeOff], ['Past Requests', pastTimeOff]] as Array<[string, TimeOffRequest[]]>).map(([title, requests]) => <Card key={title} className="overflow-hidden"><div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-900">{title}</h2></div>{requests.length === 0 ? <p className="p-4 text-sm text-gray-500">No requests in this group.</p> : <div className="divide-y divide-gray-100">{requests.map((request) => <button key={request.id} type="button" onClick={() => setSelectedTimeOff(request)} className="grid w-full gap-2 p-4 text-left text-sm hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_180px_120px]"><div><p className="font-medium text-gray-900">{roleLabel(request.requestType)}</p><p className="mt-1 text-xs text-gray-500">Submitted {formatDateTime(request.submittedAt)}</p></div><p className="text-gray-700">{formatTimeOffRange(request)}</p><Badge label={roleLabel(request.status)} className={request.status === 'approved' ? 'bg-green-50 text-green-700' : request.status === 'denied' ? 'bg-red-50 text-red-700' : request.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'} /></button>)}</div>}</Card>)}</div> : null}
      {activeTab === 'training' ? <Card className="p-6"><EmptyState title="Training" description="Training records and assigned courses will appear here once Training is enabled." /></Card> : null}
      {activeTab === 'documents' ? <Card className="overflow-hidden"><div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-900">Employee Documents</h2><p className="text-sm text-gray-500">Files already attached directly to this employee.</p></div>{documentsLoading ? <p className="p-5 text-sm text-gray-500">Loading documents...</p> : documentsError ? <p className="p-5 text-sm text-accent-700">{documentsError}</p> : employeeFiles.length === 0 ? <div className="p-6"><EmptyState title="No employee documents" description="No files are currently attached to this employee. Employee document upload and categories are not yet part of the profile workflow." /></div> : <div className="divide-y divide-gray-100">{employeeFiles.map((file) => <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-gray-900">{file.originalFileName || file.fileName}</p><p className="mt-1 text-xs text-gray-500">{roleLabel(file.category || 'document')} · {formatBytes(file.sizeBytes)} · {formatDateTime(file.uploadedAt)}</p></div><Button variant="secondary" size="sm" onClick={() => void downloadDocument(file)}><Download size={14} /> Download</Button></div>)}</div>}</Card> : null}

      <EmployeeEditModal open={editOpen} employeeId={employee.id} onClose={() => setEditOpen(false)} />
      <TimeOffReviewModal request={selectedTimeOff} onClose={() => setSelectedTimeOff(null)} onUpdated={(request) => { setTimeOffRequests((current) => current.map((item) => item.id === request.id ? { ...item, ...request } : item)); setSelectedTimeOff((current) => current?.id === request.id ? { ...current, ...request } : current); }} />
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Employee" footer={<><Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => { deleteEmployee(employee.id); navigate('/employees'); }}>Delete</Button></>}><p className="text-gray-600">Delete {employee.name}'s employee record?</p></Modal>
    </div>
  );
}