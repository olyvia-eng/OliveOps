import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { endOfWeek, format, startOfMonth, startOfWeek, subWeeks } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../../store';
import { Card, PageHeader, StatCard, Button, Select } from '../../components/ui';
import { durationHours, formatDateTime } from '../../utils';
import { resolveAttachmentUrl } from '../../utils/fileUpload';
import type { BusinessUserRole } from '../../auth/types';
import type { TimeCorrectionRequest, TimeEntry, TimeEntryWorkType } from '../../types';
import { emitAppToast } from '../../toast';
import { buildEffectiveTimeEntries } from '../../utils/timeCorrections';
import { formatTimeEntryDuration, getTimeEntryPresentation, groupTimeEntriesByEmployeeDay, sortTimeEntriesNewestFirst } from '../../utils/timeEntryPresentation.js';
import TimeEntryDetailModal from '../../components/time/TimeEntryDetailModal';
import ManualTimeEntryModal from '../../components/time/ManualTimeEntryModal';
import { useTimeEntryPage } from '../../hooks/useTimeEntryPage';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';

interface TimeReportsPageProps {
  currentUserRole: BusinessUserRole;
  currentUserId: string;
  currentUserName: string;
  currentUserEmail: string;
}

type WorkTypeFilter = 'all' | TimeEntryWorkType;
type EmployeeFilter = 'all' | string;
type JobFilter = 'all' | string;
type UnbillableCategoryFilter = 'all' | 'uncategorized' | string;
type PayrollPeriodPreset = 'custom' | 'this_week' | 'last_week' | 'this_month';
type ReportTab = 'entries' | 'corrections';

function normalizeWorkType(entry: Partial<TimeEntry>): TimeEntryWorkType {
  if (entry.workType === 'drive_time' || entry.workType === 'non_billable') return entry.workType;
  return 'job';
}

function normalizeJobIds(entry: Partial<TimeEntry>): string[] {
  if (Array.isArray(entry.jobIds) && entry.jobIds.length > 0) {
    return entry.jobIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }
  if (typeof entry.jobId === 'string' && entry.jobId.trim().length > 0) {
    return [entry.jobId];
  }
  return [];
}

function correctionLocationLabel(jobId: string | undefined, workAreaNameSnapshot: string | undefined, jobs: Array<{ id: string; title: string }>) {
  const jobLabel = jobId ? jobs.find((job) => job.id === jobId)?.title : undefined;
  const workAreaLabel = workAreaNameSnapshot?.trim();
  return [jobLabel, workAreaLabel].filter(Boolean).join(' · ');
}

export default function TimeReportsPage({
  currentUserRole,
}: TimeReportsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    timeEntries,
    timeCorrections,
    jobs,
    employees,
    unbillableTimeCategories,
    addTimeEntry,
    approveTimeCorrectionRequest,
    rejectTimeCorrectionRequest,
  } = useStore();
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || format(new Date(), 'yyyy-MM-dd'));
  const [payrollPeriodPreset, setPayrollPeriodPreset] = useState<PayrollPeriodPreset>('this_month');
  const [workTypeFilter, setWorkTypeFilter] = useState<WorkTypeFilter>((searchParams.get('workType') as WorkTypeFilter) || 'all');
  const [employeeFilter, setEmployeeFilter] = useState<EmployeeFilter>(searchParams.get('employeeId') || 'all');
  const [jobFilter, setJobFilter] = useState<JobFilter>(searchParams.get('jobId') || 'all');
  const [unbillableCategoryFilter, setUnbillableCategoryFilter] = useState<UnbillableCategoryFilter>(searchParams.get('unbillableCategoryId') || 'all');
  const [reviewingCorrectionId, setReviewingCorrectionId] = useState<string | null>(null);
  const [correctionStatusFilter, setCorrectionStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [selectedTimeEntryId, setSelectedTimeEntryId] = useState<string | null>(null);
  const [expandedEmployeeDayKeys, setExpandedEmployeeDayKeys] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<ReportTab>('entries');
  const [exporting, setExporting] = useState(false);
  const [addingTimeEntry, setAddingTimeEntry] = useState(false);
  const canAddTimeEntry = currentUserRole === 'owner' || currentUserRole === 'admin';

  const correctionHighlightId = useMemo(() => {
    const id = searchParams.get('correctionId');
    if (!id || !id.trim()) return null;
    return id.trim();
  }, [searchParams]);

  useEffect(() => {
    const requestedStatus = searchParams.get('correctionStatus');
    if (
      requestedStatus === 'pending'
      || requestedStatus === 'approved'
      || requestedStatus === 'rejected'
    ) {
      setCorrectionStatusFilter(requestedStatus);
      setActiveTab('corrections');
    }
  }, [searchParams]);

  const effectiveTimeEntries = useMemo(
    () => buildEffectiveTimeEntries(timeEntries, timeCorrections),
    [timeEntries, timeCorrections]
  );
  const employeesSorted = useMemo(() => [...employees].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.name.localeCompare(right.name);
  }), [employees]);
  const jobsSorted = useMemo(() => [...jobs].sort((a, b) => a.title.localeCompare(b.title)), [jobs]);
  const unbillableCategoriesSorted = useMemo(
    () => [...unbillableTimeCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [unbillableTimeCategories]
  );
  const getEmployeeName = useCallback(
    (employeeId: string) => employees.find((employee) => employee.id === employeeId)?.name ?? 'Unknown',
    [employees]
  );
  const getUnbillableCategoryLabel = useCallback(
    (entry: TimeEntry) => {
      if (normalizeWorkType(entry) !== 'non_billable') return 'Not Non-Billable';
      if (!entry.unbillableCategoryId) return 'Uncategorized';

      const current = unbillableCategoriesSorted.find((item) => item.id === entry.unbillableCategoryId);
      return current?.name ?? entry.unbillableCategoryName ?? 'Uncategorized';
    },
    [unbillableCategoriesSorted]
  );

  const timeEntryPageFilters = useMemo(() => ({
    startDate,
    endDate,
    employeeId: employeeFilter === 'all' ? undefined : employeeFilter,
    jobId: jobFilter === 'all' ? undefined : jobFilter,
    workType: workTypeFilter === 'all' ? undefined : workTypeFilter,
    unbillableCategoryId: unbillableCategoryFilter === 'all' ? undefined : unbillableCategoryFilter,
    includeZero: true,
  }), [employeeFilter, endDate, jobFilter, startDate, unbillableCategoryFilter, workTypeFilter]);
  const requestedPageSize = Number(searchParams.get('timeEntryPageSize'));
  const timeEntryPage = useTimeEntryPage({ surface: 'reports', defaultPageSize: [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25, filters: timeEntryPageFilters });
  const lastScrolledPageVersion = useRef(timeEntryPage.loadedVersion);
  const selectedTimeEntry = timeEntryPage.items.find((entry) => entry.id === selectedTimeEntryId) ?? null;
  // One "John clocked in, drove, worked, drove, clocked out" day reads as six separate rows unless
  // grouped - collapse same-employee/same-day entries into a single expandable row instead. Grouping
  // only spans the currently loaded page (see useTimeEntryPage), so a day that straddles a page
  // boundary can appear split across two pages; that only matters at page size 25 with a very high
  // volume of same-day entries, which the grouping itself makes far less likely to reach in the first place.
  const groupedEntryRows = useMemo(() => groupTimeEntriesByEmployeeDay(timeEntryPage.items), [timeEntryPage.items]);
  const toggleEmployeeDayGroup = useCallback((key: string) => {
    setExpandedEmployeeDayKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (selectedTimeEntryId && !timeEntryPage.items.some((entry) => entry.id === selectedTimeEntryId)) {
      setSelectedTimeEntryId(null);
    }
  }, [selectedTimeEntryId, timeEntryPage.items, timeEntryPage.loadedVersion]);

  useEffect(() => {
    if (timeEntryPage.navigationVersion > 0 && timeEntryPage.loadedVersion !== lastScrolledPageVersion.current) {
      document.getElementById('time-entries-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    lastScrolledPageVersion.current = timeEntryPage.loadedVersion;
  }, [timeEntryPage.loadedVersion, timeEntryPage.navigationVersion]);

  useEffect(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      const values = {
        startDate,
        endDate,
        employeeId: employeeFilter === 'all' ? '' : employeeFilter,
        jobId: jobFilter === 'all' ? '' : jobFilter,
        workType: workTypeFilter === 'all' ? '' : workTypeFilter,
        unbillableCategoryId: unbillableCategoryFilter === 'all' ? '' : unbillableCategoryFilter,
        timeEntryPageSize: String(timeEntryPage.pageSize),
      };
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      next.delete('employeeSearch');
      return next;
    }, { replace: true });
  }, [employeeFilter, endDate, jobFilter, setSearchParams, startDate, timeEntryPage.pageSize, unbillableCategoryFilter, workTypeFilter]);

  useEffect(() => {
    let cancelled = false;

    const resolveUrls = async () => {
      const candidates = timeEntryPage.items.filter((entry) => Boolean(entry.clockOutPhotoFileId || entry.photoAttachmentFileId || entry.photoAttachmentUrl));
      const pairs = await Promise.all(
        candidates.map(async (entry) => {
          const url = await resolveAttachmentUrl({
            fileId: entry.clockOutPhotoFileId ?? entry.photoAttachmentFileId,
            legacyUrl: entry.photoAttachmentUrl,
          });
          return [entry.id, url] as const;
        })
      );

      if (cancelled) return;
      setAttachmentUrls(Object.fromEntries(pairs));
    };

    void resolveUrls();

    return () => {
      cancelled = true;
    };
  }, [timeEntryPage.items]);

  const applyPayrollPreset = (preset: PayrollPeriodPreset) => {
    setPayrollPeriodPreset(preset);
    const today = new Date();

    if (preset === 'custom') return;

    if (preset === 'this_month') {
      setStartDate(format(startOfMonth(today), 'yyyy-MM-dd'));
      setEndDate(format(today, 'yyyy-MM-dd'));
      return;
    }

    if (preset === 'this_week') {
      setStartDate(format(startOfWeek(today, { weekStartsOn: 0 }), 'yyyy-MM-dd'));
      setEndDate(format(today, 'yyyy-MM-dd'));
      return;
    }

    const lastWeekReference = subWeeks(today, 1);
    setStartDate(format(startOfWeek(lastWeekReference, { weekStartsOn: 0 }), 'yyyy-MM-dd'));
    setEndDate(format(endOfWeek(lastWeekReference, { weekStartsOn: 0 }), 'yyyy-MM-dd'));
  };

  const filteredEntries = useMemo(() => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59.999`);

    return sortTimeEntriesNewestFirst(effectiveTimeEntries.filter((entry) => {
        const clockInDate = new Date(entry.clockIn);
        if (Number.isNaN(clockInDate.getTime())) return false;
        if (clockInDate < start || clockInDate > end) return false;

        if (employeeFilter !== 'all' && entry.employeeId !== employeeFilter) return false;

        if (jobFilter !== 'all') {
          const entryJobIds = normalizeJobIds(entry);
          if (!entryJobIds.includes(jobFilter)) return false;
        }

        if (unbillableCategoryFilter !== 'all') {
          const workType = normalizeWorkType(entry);
          if (workType !== 'non_billable') return false;

          if (unbillableCategoryFilter === 'uncategorized') {
            if (entry.unbillableCategoryId) return false;
          } else if (entry.unbillableCategoryId !== unbillableCategoryFilter) {
            return false;
          }
        }

        const workType = normalizeWorkType(entry);
        if (workTypeFilter !== 'all' && workType !== workTypeFilter) return false;
        return true;
      }));
  }, [effectiveTimeEntries, employeeFilter, endDate, jobFilter, startDate, unbillableCategoryFilter, workTypeFilter]);

  const totalsByType = useMemo(() => {
    const totals: Record<TimeEntryWorkType, number> = {
      job: 0,
      drive_time: 0,
      non_billable: 0,
    };

    filteredEntries.forEach((entry) => {
      const workType = normalizeWorkType(entry);
      totals[workType] += durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
    });

    return totals;
  }, [filteredEntries]);

  const correctionRows = useMemo(() => {
    return timeCorrections
      .filter((item) => item.status === correctionStatusFilter)
      .slice()
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  }, [correctionStatusFilter, timeCorrections]);
  const pendingCorrectionCount = useMemo(
    () => timeCorrections.filter((item) => item.status === 'pending').length,
    [timeCorrections]
  );

  useEffect(() => {
    if (!correctionHighlightId) return;

    const row = typeof document !== 'undefined'
      ? document.getElementById(`correction-row-${correctionHighlightId}`)
      : null;
    if (!row) return;

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [correctionHighlightId, correctionRows]);

  const handleApproveCorrection = async (correctionId: string) => {
    if (reviewingCorrectionId) return;
    setReviewingCorrectionId(correctionId);
    const result = await approveTimeCorrectionRequest(correctionId);
    setReviewingCorrectionId(null);

    if (!result.ok) {
      emitAppToast({ tone: 'error', message: result.error ?? 'Could not approve correction request.' });
      return;
    }

    emitAppToast({ tone: 'success', message: 'Correction request approved.' });
  };

  const handleRejectCorrection = async (correctionId: string) => {
    if (reviewingCorrectionId) return;
    const reviewNote = typeof window !== 'undefined'
      ? (window.prompt('Optional rejection note') ?? '').trim()
      : '';
    setReviewingCorrectionId(correctionId);
    const result = await rejectTimeCorrectionRequest(correctionId, reviewNote);
    setReviewingCorrectionId(null);

    if (!result.ok) {
      emitAppToast({ tone: 'error', message: result.error ?? 'Could not reject correction request.' });
      return;
    }

    emitAppToast({ tone: 'success', message: 'Correction request rejected.' });
  };

  const totalHours = filteredEntries.reduce((sum, entry) => sum + durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes), 0);

  const nonBillableCategoryTotals = useMemo(() => {
    const map = new Map<string, number>();

    filteredEntries.forEach((entry) => {
      if (normalizeWorkType(entry) !== 'non_billable') return;
      const label = getUnbillableCategoryLabel(entry);
      const hours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
      map.set(label, (map.get(label) ?? 0) + hours);
    });

    return [...map.entries()]
      .map(([label, hours]) => ({ label, hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [filteredEntries, getUnbillableCategoryLabel]);

  const handleExportSummaryCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ surface: 'reports', action: 'export', limit: '100' });
      for (const [key, value] of Object.entries(timeEntryPageFilters)) {
        if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
      }
      const response = await fetch(`/api/time-entries?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Bookkeeper export could not be generated.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `time-summary-${startDate}-to-${endDate}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Bookkeeper export could not be generated.' });
    } finally {
      setExporting(false);
    }
  };

  const renderTimeEntryRow = (entry: TimeEntry, nested: boolean) => {
    const hours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
    const presentation = getTimeEntryPresentation(entry, jobs);
    return (
      <tr
        key={entry.id}
        tabIndex={0}
        role="button"
        aria-label={`Open Time Entry for ${getEmployeeName(entry.employeeId)}`}
        onClick={() => setSelectedTimeEntryId(entry.id)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedTimeEntryId(entry.id); } }}
        className={`cursor-pointer align-top hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${nested ? 'bg-gray-50/60' : ''}`}
      >
        <td className="px-4 py-2 font-medium text-gray-800">{nested ? null : getEmployeeName(entry.employeeId)}</td>
        <td className={`py-2 text-gray-600 ${nested ? 'pl-4' : ''}`}>{presentation.activityLabel}</td>
        <td className="py-2 text-gray-600 max-w-xs">
          <p className="truncate">{presentation.workLabel}</p>
        </td>
        <td className="py-2 text-gray-500 text-xs">{formatDateTime(entry.clockIn)}</td>
        <td className="py-2 text-gray-500 text-xs">{entry.clockOut ? formatDateTime(entry.clockOut) : <span className="text-brand-700 font-medium">Active</span>}</td>
        <td className="py-2 text-gray-600 max-w-xs truncate">
          {entry.notes?.trim() ? entry.notes : '—'}
          {attachmentUrls[entry.id] ? (
            <div className="mt-1">
              <a href={attachmentUrls[entry.id]} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="text-xs font-medium text-brand-700 hover:text-brand-800">
                View photo
              </a>
            </div>
          ) : null}
        </td>
        <td className="px-4 py-2 text-right font-semibold text-brand-600">{formatTimeEntryDuration(hours)}</td>
      </tr>
    );
  };

  const renderEmployeeDayRows = (group: ReturnType<typeof groupTimeEntriesByEmployeeDay>[number]) => {
    if (group.entries.length === 1) return [renderTimeEntryRow(group.entries[0], false)];

    // group.entries arrives newest-clock-in-first (see useTimeEntryPage); chronological restores
    // earliest-first order so the summary reads as "clocked in at X, clocked out at Y".
    const chronological = [...group.entries].reverse();
    const earliest = chronological[0];
    const latest = chronological[chronological.length - 1];
    const totalHours = group.entries.reduce((sum, entry) => sum + durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes), 0);
    const uniqueActivityLabels = [...new Set(chronological.map((entry) => getTimeEntryPresentation(entry, jobs).activityLabel))];
    const uniqueWorkLabels = [...new Set(chronological.map((entry) => getTimeEntryPresentation(entry, jobs).workLabel))];
    const isExpanded = expandedEmployeeDayKeys.has(group.key);

    const summaryRow = (
      <tr key={group.key} className="align-top">
        <td className="px-4 py-2 font-medium text-gray-800">
          <button
            type="button"
            className="flex items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.entries.length} time entries for ${getEmployeeName(group.employeeId)}`}
            onClick={() => toggleEmployeeDayGroup(group.key)}
          >
            {isExpanded ? <ChevronDown size={15} className="shrink-0 text-gray-400" /> : <ChevronRight size={15} className="shrink-0 text-gray-400" />}
            <span>{getEmployeeName(group.employeeId)}</span>
            <span className="font-normal text-xs text-gray-400">({group.entries.length})</span>
          </button>
        </td>
        <td className="py-2 text-gray-600">{uniqueActivityLabels.join(' · ')}</td>
        <td className="py-2 text-gray-600 max-w-xs">
          <p className="truncate">{uniqueWorkLabels.join(', ')}</p>
        </td>
        <td className="py-2 text-gray-500 text-xs">{formatDateTime(earliest.clockIn)}</td>
        <td className="py-2 text-gray-500 text-xs">{latest.clockOut ? formatDateTime(latest.clockOut) : <span className="text-brand-700 font-medium">Active</span>}</td>
        <td className="py-2 text-gray-400 text-xs">—</td>
        <td className="px-4 py-2 text-right font-semibold text-brand-600">{formatTimeEntryDuration(totalHours)}</td>
      </tr>
    );

    return isExpanded ? [summaryRow, ...group.entries.map((entry) => renderTimeEntryRow(entry, true))] : [summaryRow];
  };

  return (
    <div>
      <PageHeader
        title="Time Tracking"
        subtitle="Filter hours by date, type, employee, and job."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Hours" value={`${totalHours.toFixed(1)} hrs`} />
        <StatCard label="Job Work" value={`${totalsByType.job.toFixed(1)} hrs`} color="text-brand-700" />
        <StatCard label="Drive Time" value={`${totalsByType.drive_time.toFixed(1)} hrs`} color="text-accent-700" />
        <StatCard label="Non-Billable" value={`${totalsByType.non_billable.toFixed(1)} hrs`} color="text-brand-600" />
      </div>

      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          <div>
            <Select
              label="Payroll Period"
              value={payrollPeriodPreset}
              onChange={(event) => applyPayrollPreset(event.target.value as PayrollPeriodPreset)}
            >
              <option value="this_month">This Month</option>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="custom">Custom</option>
            </Select>
          </div>
          <label className="text-sm text-gray-600">
            <span className="block mb-1 font-medium text-gray-700">Start Date</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setPayrollPeriodPreset('custom');
              }}
              className="w-full h-10 rounded-xl border border-gray-300 px-3 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
            />
          </label>
          <label className="text-sm text-gray-600">
            <span className="block mb-1 font-medium text-gray-700">End Date</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setPayrollPeriodPreset('custom');
              }}
              className="w-full h-10 rounded-xl border border-gray-300 px-3 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
            />
          </label>
          <div>
            <Select label="Work Type" value={workTypeFilter} onChange={(event) => setWorkTypeFilter(event.target.value as WorkTypeFilter)}>
              <option value="all">All Types</option>
              <option value="job">Job Work</option>
              <option value="drive_time">Drive Time</option>
              <option value="non_billable">Non-Billable Work</option>
            </Select>
          </div>
          <div>
            <Select label="Job" value={jobFilter} onChange={(event) => setJobFilter(event.target.value as JobFilter)}>
              <option value="all">All Jobs</option>
              {jobsSorted.map((job) => (
                <option key={job.id} value={job.id}>{job.title}</option>
              ))}
            </Select>
          </div>
          <div>
            <Select
              label="Unbillable Category"
              value={unbillableCategoryFilter}
              onChange={(event) => setUnbillableCategoryFilter(event.target.value as UnbillableCategoryFilter)}
            >
              <option value="all">All Categories</option>
              <option value="uncategorized">Uncategorized</option>
              {unbillableCategoriesSorted.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Select label="Employee" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value as EmployeeFilter)}>
              <option value="all">All Employees</option>
              {employeesSorted.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}{employee.active ? '' : ' (Inactive)'}</option>
              ))}
            </Select>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-500">{filteredEntries.length} time {filteredEntries.length === 1 ? 'entry' : 'entries'}</p>
      </Card>

      <div className="mb-4 flex border-b border-gray-200" role="tablist" aria-label="Time Tracking views">
        <button type="button" role="tab" aria-selected={activeTab === 'entries'} onClick={() => setActiveTab('entries')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === 'entries' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>Time Entries</button>
        <button type="button" role="tab" aria-selected={activeTab === 'corrections'} onClick={() => setActiveTab('corrections')} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === 'corrections' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          Correction Requests
          {pendingCorrectionCount > 0 ? <span className="rounded-full bg-accent-100 px-2 py-0.5 text-xs text-accent-700">{pendingCorrectionCount}</span> : null}
        </button>
      </div>

      {activeTab === 'corrections' && (currentUserRole === 'admin' || currentUserRole === 'owner') && (
        <Card className="overflow-hidden mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 p-4">
            <div>
              <h2 className="font-semibold text-gray-800">Time Correction Requests</h2>
              <p className="text-xs text-gray-500 mt-1">Only approved corrections affect payroll and job costing.</p>
            </div>
            <div className="w-44">
              <Select
                value={correctionStatusFilter}
                onChange={(event) => setCorrectionStatusFilter(event.target.value as 'pending' | 'approved' | 'rejected')}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Denied</option>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-left text-xs">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Original</th>
                  <th className="py-2 font-medium">Requested</th>
                  <th className="py-2 font-medium">Reason</th>
                  <th className="py-2 font-medium">Submitted</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {correctionRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-4 text-gray-400">No requests in this status.</td></tr>
                ) : correctionRows.map((item: TimeCorrectionRequest) => (
                  <tr
                    key={item.id}
                    id={`correction-row-${item.id}`}
                    data-correction-id={item.id}
                    className={item.id === correctionHighlightId ? 'bg-accent-50 ring-1 ring-inset ring-accent-200' : ''}
                  >
                    <td className="px-4 py-2 font-medium text-gray-800">{getEmployeeName(item.employeeId)}</td>
                    <td className="py-2 text-gray-600 capitalize">{item.requestType.replaceAll('_', ' ')}</td>
                    <td className="py-2 text-xs text-gray-500">
                      {item.originalClockInAt ? formatDateTime(item.originalClockInAt) : '—'}
                      {' - '}
                      {item.originalClockOutAt ? formatDateTime(item.originalClockOutAt) : '—'}
                      {correctionLocationLabel(item.originalJobId, item.originalWorkAreaNameSnapshot, jobs) ? <p className="mt-1 font-medium text-gray-700">{correctionLocationLabel(item.originalJobId, item.originalWorkAreaNameSnapshot, jobs)}</p> : null}
                    </td>
                    <td className="py-2 text-xs text-gray-500">
                      {item.requestedClockInAt ? formatDateTime(item.requestedClockInAt) : '—'}
                      {' - '}
                      {item.requestedClockOutAt ? formatDateTime(item.requestedClockOutAt) : '—'}
                      {correctionLocationLabel(item.requestedJobId ?? item.originalJobId, item.requestedWorkAreaNameSnapshot, jobs) ? <p className="mt-1 font-medium text-gray-700">{correctionLocationLabel(item.requestedJobId ?? item.originalJobId, item.requestedWorkAreaNameSnapshot, jobs)}</p> : null}
                    </td>
                    <td className="py-2 text-gray-600 max-w-xs truncate">{item.reason || '—'}</td>
                    <td className="py-2 text-xs text-gray-500">{formatDateTime(item.submittedAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {item.status === 'pending' ? (
                        <div className="inline-flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleApproveCorrection(item.id)}
                            disabled={reviewingCorrectionId === item.id}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleRejectCorrection(item.id)}
                            disabled={reviewingCorrectionId === item.id}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs capitalize text-gray-500">{item.status === 'rejected' ? 'denied' : item.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {activeTab === 'corrections' && currentUserRole !== 'admin' && currentUserRole !== 'owner' ? (
        <p className="py-4 text-sm text-gray-500">Correction request review is available to Owner and Admin users.</p>
      ) : null}

      {activeTab === 'entries' ? <>
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <h2 id="time-entries-heading" className="font-semibold text-gray-800">Time Entries</h2>
            <p className="mt-1 text-xs text-gray-500">Newest clock-in first. Select an entry to view its details.</p>
          </div>
          <div className="flex items-center gap-3">
            {canAddTimeEntry ? <Button onClick={() => setAddingTimeEntry(true)}><Plus size={16} /> Add Time Entry</Button> : null}
            <Button onClick={() => void handleExportSummaryCsv()} disabled={timeEntryPage.loading || Boolean(timeEntryPage.error) || timeEntryPage.items.length === 0 || exporting}>
              {exporting ? 'Exporting...' : 'Bookkeeper Export'}
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-left text-xs">
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="py-2 font-medium">Activity</th>
                <th className="py-2 font-medium">Job / Work Area</th>
                <th className="py-2 font-medium">Clock In</th>
                <th className="py-2 font-medium">Clock Out</th>
                <th className="py-2 font-medium">Notes</th>
                <th className="px-4 py-2 font-medium text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {timeEntryPage.loading ? (
                <tr><td colSpan={7} className="px-4 py-6 text-gray-500" role="status">Loading Time Entries...</td></tr>
              ) : timeEntryPage.error ? (
                <tr><td colSpan={7} className="px-4 py-6"><div className="flex items-center gap-2"><p className="text-sm font-medium text-accent-700" role="alert">{timeEntryPage.error}</p><Button variant="secondary" size="sm" onClick={timeEntryPage.refresh}>Retry</Button></div></td></tr>
              ) : timeEntryPage.items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-gray-400">No entries match these filters.</td></tr>
              ) : groupedEntryRows.flatMap((group) => renderEmployeeDayRows(group))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-sm">
          <p className="text-gray-600">{!timeEntryPage.loading && !timeEntryPage.error && timeEntryPage.items.length > 0 ? <>Showing {timeEntryPage.showingStart}–{timeEntryPage.showingEnd}</> : 'Time Entries'}</p>
          <div className="flex items-end gap-2">
            <Button variant="secondary" size="sm" onClick={timeEntryPage.previous} disabled={!timeEntryPage.hasPrevious || timeEntryPage.loading}>Previous</Button>
            <Button variant="secondary" size="sm" onClick={timeEntryPage.next} disabled={!timeEntryPage.hasNext || timeEntryPage.loading}>Next</Button>
            <Select label="Rows" value={String(timeEntryPage.pageSize)} onChange={(event) => timeEntryPage.setPageSize(Number(event.target.value))}>
              <option value="25">25</option><option value="50">50</option><option value="100">100</option>
            </Select>
          </div>
        </div>
      </Card>
      <section className="mt-5 border-t border-gray-200 pt-4" aria-labelledby="non-billable-breakdown-heading">
        <h2 id="non-billable-breakdown-heading" className="font-semibold text-gray-800">Non-Billable Category Breakdown</h2>
        {nonBillableCategoryTotals.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No non-billable time recorded for this period.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nonBillableCategoryTotals.map((item) => (
              <div key={item.label} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                <p className="mt-1 text-xs text-gray-500">{item.hours.toFixed(2)} hrs</p>
              </div>
            ))}
          </div>
        )}
      </section>
      </> : null}

      <TimeEntryDetailModal
        entry={selectedTimeEntry}
        employeeName={selectedTimeEntry ? getEmployeeName(selectedTimeEntry.employeeId) : ''}
        currentUserRole={currentUserRole}
        onClose={() => setSelectedTimeEntryId(null)}
        onUpdated={timeEntryPage.refresh}
        onDeleted={timeEntryPage.removeAfterDelete}
      />
      <ManualTimeEntryModal
        open={addingTimeEntry}
        employees={employees}
        jobs={jobs}
        unbillableCategories={unbillableTimeCategories}
        onClose={() => setAddingTimeEntry(false)}
        onSave={addTimeEntry}
        onCreated={() => {
          timeEntryPage.refresh();
          emitAppToast({ tone: 'success', message: 'Time Entry added.' });
        }}
      />
    </div>
  );
}
