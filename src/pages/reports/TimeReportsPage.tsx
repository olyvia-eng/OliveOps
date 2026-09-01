import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { endOfWeek, format, startOfMonth, startOfWeek, subWeeks } from 'date-fns';
import { useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import { Card, PageHeader, StatCard, Button, Select, Input } from '../../components/ui';
import { durationHours, formatDateTime, generateId, nowISO } from '../../utils';
import { resolveAttachmentUrl } from '../../utils/fileUpload';
import type { BusinessUserRole } from '../../auth/types';
import type { AuditEvent, TimeCorrectionRequest, TimeEntry, TimeEntryWorkType } from '../../types';
import { emitAppToast } from '../../toast';
import { buildEffectiveTimeEntries } from '../../utils/timeCorrections';
import { formatTimeEntryDuration, getTimeEntryPresentation, sortTimeEntriesNewestFirst } from '../../utils/timeEntryPresentation.js';
import EditTimeEntryModal from '../../components/time/EditTimeEntryModal';
import { Pencil } from 'lucide-react';

interface TimeReportsPageProps {
  currentUserRole: BusinessUserRole;
  currentUserId: string;
  currentUserName: string;
  currentUserEmail: string;
}

type WorkTypeFilter = 'all' | TimeEntryWorkType;
type JobFilter = 'all' | string;
type UnbillableCategoryFilter = 'all' | 'uncategorized' | string;
type PayrollPeriodPreset = 'custom' | 'this_week' | 'last_week' | 'this_month';

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

function entryTypeMeta(entry: Partial<TimeEntry>) {
  const workType = normalizeWorkType(entry);
  if (workType === 'drive_time') {
    return { label: 'Drive Time', className: 'bg-accent-50 text-accent-600' };
  }
  if (workType === 'non_billable') {
    return { label: 'Non-Billable', className: 'bg-brand-100 text-brand-700' };
  }
  return { label: 'Job Work', className: 'bg-brand-200 text-brand-800' };
}

function correctionLocationLabel(jobId: string | undefined, workAreaNameSnapshot: string | undefined, jobs: Array<{ id: string; title: string }>) {
  const jobLabel = jobId ? jobs.find((job) => job.id === jobId)?.title : undefined;
  const workAreaLabel = workAreaNameSnapshot?.trim();
  return [jobLabel, workAreaLabel].filter(Boolean).join(' · ');
}

function escapeCsvValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export default function TimeReportsPage({
  currentUserRole,
  currentUserId,
  currentUserName,
  currentUserEmail,
}: TimeReportsPageProps) {
  const location = useLocation();
  const {
    timeEntries,
    timeCorrections,
    jobs,
    employees,
    unbillableTimeCategories,
    updateTimeEntry,
    editTimeEntry,
    approveTimeCorrectionRequest,
    rejectTimeCorrectionRequest,
  } = useStore();
  const [startDate, setStartDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [payrollPeriodPreset, setPayrollPeriodPreset] = useState<PayrollPeriodPreset>('this_month');
  const [workTypeFilter, setWorkTypeFilter] = useState<WorkTypeFilter>('all');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const [unbillableCategoryFilter, setUnbillableCategoryFilter] = useState<UnbillableCategoryFilter>('all');
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillAuditEvents, setBackfillAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingBackfillAudits, setLoadingBackfillAudits] = useState(false);
  const [expandedAuditEventId, setExpandedAuditEventId] = useState<string | null>(null);
  const [reviewingCorrectionId, setReviewingCorrectionId] = useState<string | null>(null);
  const [correctionStatusFilter, setCorrectionStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [editingTimeEntry, setEditingTimeEntry] = useState<TimeEntry | null>(null);
  const detailSectionRef = useRef<HTMLDivElement | null>(null);

  const correctionHighlightId = useMemo(() => {
    const query = new URLSearchParams(location.search);
    const id = query.get('correctionId');
    if (!id || !id.trim()) return null;
    return id.trim();
  }, [location.search]);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const requestedStatus = query.get('correctionStatus');
    if (
      requestedStatus === 'pending'
      || requestedStatus === 'approved'
      || requestedStatus === 'rejected'
    ) {
      setCorrectionStatusFilter(requestedStatus);
    }
  }, [location.search]);

  const effectiveTimeEntries = useMemo(
    () => buildEffectiveTimeEntries(timeEntries, timeCorrections),
    [timeEntries, timeCorrections]
  );

  const employeeSearchValue = employeeSearch.trim().toLowerCase();
  const jobsSorted = useMemo(() => [...jobs].sort((a, b) => a.title.localeCompare(b.title)), [jobs]);
  const unbillableCategoriesSorted = useMemo(
    () => [...unbillableTimeCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [unbillableTimeCategories]
  );
  const isJobFocused = jobFilter !== 'all';

  const getEmployeeName = useCallback(
    (employeeId: string) => employees.find((employee) => employee.id === employeeId)?.name ?? 'Unknown',
    [employees]
  );
  const getJobTitle = useCallback(
    (jobId: string) => jobs.find((job) => job.id === jobId)?.title ?? 'Unknown job',
    [jobs]
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

  useEffect(() => {
    let cancelled = false;

    const resolveUrls = async () => {
      const candidates = effectiveTimeEntries.filter((entry) => Boolean(entry.clockOutPhotoFileId || entry.photoAttachmentFileId || entry.photoAttachmentUrl));
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
  }, [effectiveTimeEntries]);

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

  useEffect(() => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'owner') {
      setBackfillAuditEvents([]);
      return;
    }

    let cancelled = false;
    const loadBackfillAuditEvents = async () => {
      setLoadingBackfillAudits(true);
      try {
        const response = await fetch('/api/data?entity=audit-events', {
          method: 'GET',
          credentials: 'include',
        });
        if (!response.ok) return;

        const payload = (await response.json()) as { ok?: boolean; items?: AuditEvent[] };
        if (!payload.ok || !Array.isArray(payload.items)) return;

        const events = payload.items
          .filter((item) => item.action === 'backfill_time_entries')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 8);

        if (!cancelled) setBackfillAuditEvents(events);
      } finally {
        if (!cancelled) setLoadingBackfillAudits(false);
      }
    };

    void loadBackfillAuditEvents();
    return () => {
      cancelled = true;
    };
  }, [currentUserRole]);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedEmployeeId]);

  const filteredEntries = useMemo(() => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59.999`);

    return sortTimeEntriesNewestFirst(effectiveTimeEntries.filter((entry) => {
        const clockInDate = new Date(entry.clockIn);
        if (Number.isNaN(clockInDate.getTime())) return false;
        if (clockInDate < start || clockInDate > end) return false;

        if (employeeSearchValue) {
          const employeeName = getEmployeeName(entry.employeeId).toLowerCase();
          if (!employeeName.includes(employeeSearchValue)) return false;
        }

        if (selectedEmployeeId && entry.employeeId !== selectedEmployeeId) return false;

        if (jobFilter !== 'all') {
          const workType = normalizeWorkType(entry);
          if (workType !== 'job') return false;

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
  }, [effectiveTimeEntries, employeeSearchValue, endDate, getEmployeeName, jobFilter, selectedEmployeeId, startDate, unbillableCategoryFilter, workTypeFilter]);

  const recentEntries = useMemo(
    () => sortTimeEntriesNewestFirst(effectiveTimeEntries).slice(0, 20),
    [effectiveTimeEntries]
  );

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

  const employeeTotals = useMemo(() => {
    const map = new Map<string, number>();
    filteredEntries.forEach((entry) => {
      const hours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
      map.set(entry.employeeId, (map.get(entry.employeeId) ?? 0) + hours);
    });

    return [...map.entries()]
      .map(([employeeId, hours]) => ({
        employeeId,
        name: employees.find((employee) => employee.id === employeeId)?.name ?? 'Unknown',
        hours,
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [employees, filteredEntries]);

  const jobTotals = useMemo(() => {
    const map = new Map<string, number>();

    filteredEntries.forEach((entry) => {
      if (normalizeWorkType(entry) !== 'job') return;
      const jobIds = normalizeJobIds(entry);
      if (jobIds.length === 0) return;

      const hoursShare = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes) / jobIds.length;
      jobIds.forEach((jobId) => {
        map.set(jobId, (map.get(jobId) ?? 0) + hoursShare);
      });
    });

    return [...map.entries()]
      .map(([jobId, hours]) => ({
        jobId,
        title: jobs.find((job) => job.id === jobId)?.title ?? 'Unknown job',
        hours,
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [filteredEntries, jobs]);

  const legacyEntries = useMemo(
    () =>
      timeEntries.filter((entry) => {
        const hasWorkType = typeof entry.workType === 'string';
        const jobIds = normalizeJobIds(entry);
        return !hasWorkType || (normalizeWorkType(entry) === 'job' && jobIds.length === 0 && typeof entry.jobId === 'string');
      }),
    [timeEntries]
  );

  const correctionRows = useMemo(() => {
    return timeCorrections
      .filter((item) => item.status === correctionStatusFilter)
      .slice()
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  }, [correctionStatusFilter, timeCorrections]);

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

  const backfillLegacyEntries = async () => {
    setBackfillRunning(true);
    try {
      for (const entry of legacyEntries) {
        const existingJobIds = normalizeJobIds(entry);
        const nextWorkType = typeof entry.workType === 'string'
          ? normalizeWorkType(entry)
          : (existingJobIds.length > 0 || typeof entry.jobId === 'string' ? 'job' : 'non_billable');
        const nextJobIds = nextWorkType === 'job'
          ? (existingJobIds.length > 0 ? existingJobIds : (typeof entry.jobId === 'string' ? [entry.jobId] : []))
          : [];

        await updateTimeEntry(entry.id, {
          workType: nextWorkType,
          jobId: nextWorkType === 'job' ? (entry.jobId ?? nextJobIds[0]) : undefined,
          jobIds: nextJobIds,
          breakMinutes: entry.breakMinutes ?? 0,
          notes: entry.notes ?? '',
          status: entry.status ?? 'clocked_out',
          clockIn: entry.clockIn,
          clockOut: entry.clockOut,
          employeeId: entry.employeeId,
        });
      }

      const auditEvent: AuditEvent = {
        id: generateId(),
        action: 'backfill_time_entries',
        actorUserId: currentUserId,
        actorName: currentUserName,
        actorEmail: currentUserEmail,
        affectedEntryCount: legacyEntries.length,
        createdAt: nowISO(),
        metadata: {
          filters: {
            startDate,
            endDate,
            workTypeFilter,
            jobFilter,
            employeeSearch: employeeSearch.trim(),
          },
        },
      };

      const auditResponse = await fetch('/api/data?entity=audit-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ data: auditEvent }),
      });

      if (auditResponse.ok) {
        setBackfillAuditEvents((current) => [auditEvent, ...current].slice(0, 8));
      }

      emitAppToast({ tone: 'success', message: 'Legacy time entries backfilled successfully.' });
    } finally {
      setBackfillRunning(false);
    }
  };

  const totalHours = filteredEntries.reduce((sum, entry) => sum + durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes), 0);

  const employeeSummaryRows = useMemo(() => {
    const map = new Map<string, { total: number; job: number; drive_time: number; non_billable: number }>();

    filteredEntries.forEach((entry) => {
      const hours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
      const workType = normalizeWorkType(entry);
      const current = map.get(entry.employeeId) ?? {
        total: 0,
        job: 0,
        drive_time: 0,
        non_billable: 0,
      };

      current.total += hours;
      current[workType] += hours;
      map.set(entry.employeeId, current);
    });

    return [...map.entries()]
      .map(([employeeId, totals]) => ({
        employeeId,
        employeeName: getEmployeeName(employeeId),
        ...totals,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredEntries, getEmployeeName]);

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

  const handleExportSummaryCsv = () => {
    const payrollPeriodLabel =
      payrollPeriodPreset === 'this_month'
        ? 'This Month'
        : payrollPeriodPreset === 'this_week'
          ? 'This Week'
          : payrollPeriodPreset === 'last_week'
            ? 'Last Week'
            : 'Custom';

    const selectedWorkTypeLabel =
      workTypeFilter === 'all'
        ? 'All Types'
        : workTypeFilter === 'job'
          ? 'Job Work'
          : workTypeFilter === 'drive_time'
            ? 'Drive Time'
            : 'Non-Billable Work';
    const selectedJobLabel = jobFilter === 'all' ? 'All Jobs' : getJobTitle(jobFilter);
    const employeeFilterLabel = employeeSearch.trim() ? employeeSearch.trim() : 'All Employees';

    const filterRows = [
      ['Report', 'Bookkeeper Time Summary'],
      ['Generated At', new Date().toISOString()],
      ['Payroll Period', payrollPeriodLabel],
      ['Start Date', startDate],
      ['End Date', endDate],
      ['Work Type', selectedWorkTypeLabel],
      ['Job', selectedJobLabel],
      ['Unbillable Category', unbillableCategoryFilter === 'all' ? 'All Categories' : unbillableCategoryFilter === 'uncategorized' ? 'Uncategorized' : (unbillableCategoriesSorted.find((item) => item.id === unbillableCategoryFilter)?.name ?? 'Unknown Category')],
      ['Employee Search', employeeFilterLabel],
      ['Focused Employee', selectedEmployeeId ? getEmployeeName(selectedEmployeeId) : 'None'],
      ['Matching Entries', String(filteredEntries.length)],
      [],
    ];

    const header = ['Employee', 'Total Hours', 'Job Hours', 'Drive Time Hours', 'Non-Billable Hours'];

    const rows = employeeSummaryRows.map((row) => [
      row.employeeName,
      row.total.toFixed(2),
      row.job.toFixed(2),
      row.drive_time.toFixed(2),
      row.non_billable.toFixed(2),
    ]);

    const csv = [...filterRows, header, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const jobSegment = jobFilter === 'all'
      ? 'all-jobs'
      : getJobTitle(jobFilter)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'selected-job';
    anchor.download = `time-summary-${jobSegment}-${startDate}-to-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Time Reports"
        subtitle="Filter hours by date, type, employee, and job."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Hours" value={`${totalHours.toFixed(1)} hrs`} />
        <StatCard label="Job Work" value={`${totalsByType.job.toFixed(1)} hrs`} color="text-brand-700" />
        <StatCard label="Drive Time" value={`${totalsByType.drive_time.toFixed(1)} hrs`} color="text-accent-700" />
        <StatCard label="Non-Billable" value={`${totalsByType.non_billable.toFixed(1)} hrs`} color="text-brand-600" />
      </div>

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-3">
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
            <Input
              label="Employee Search"
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Search by employee name"
            />
          </div>
          <div className="flex items-end gap-2">
            <p className="text-sm text-gray-500">
              {selectedEmployeeId ? `Focused: ${getEmployeeName(selectedEmployeeId)}` : 'No focused employee'}
            </p>
            {selectedEmployeeId && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedEmployeeId(null)}>
                Clear Employee
              </Button>
            )}
            <p className="text-sm text-gray-500">
              {isJobFocused ? `Focused Job: ${getJobTitle(jobFilter)}` : 'No focused job'}
            </p>
            {isJobFocused && (
              <Button variant="ghost" size="sm" onClick={() => setJobFilter('all')}>
                Clear Job
              </Button>
            )}
            <p className="text-sm text-gray-500">
              {unbillableCategoryFilter === 'all'
                ? 'All unbillable categories'
                : unbillableCategoryFilter === 'uncategorized'
                  ? 'Focused Category: Uncategorized'
                  : `Focused Category: ${unbillableCategoriesSorted.find((item) => item.id === unbillableCategoryFilter)?.name ?? 'Unknown'}`}
            </p>
            {unbillableCategoryFilter !== 'all' && (
              <Button variant="ghost" size="sm" onClick={() => setUnbillableCategoryFilter('all')}>
                Clear Category
              </Button>
            )}
          </div>
          <div className="flex items-end">
            <p className="text-sm text-gray-500">Showing {filteredEntries.length} entries</p>
          </div>
        </div>
      </Card>

      {(currentUserRole === 'admin' || currentUserRole === 'owner') && (
        <Card className="overflow-hidden mb-6">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
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
                <option value="rejected">Rejected</option>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                        <span className="text-xs text-gray-500">{item.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden mb-6">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Non-Billable Category Breakdown</h2>
          <p className="text-xs text-gray-500 mt-1">Hours grouped by unbillable category within current filters.</p>
        </div>
        {nonBillableCategoryTotals.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">No non-billable entries in this range.</p>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {nonBillableCategoryTotals.map((item) => (
                <div key={item.label} className="rounded-lg border border-gray-100 bg-white p-3">
                  <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{item.hours.toFixed(2)} hrs</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden mb-6">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Recent Time Entries</h2>
          <p className="text-xs text-gray-500 mt-1">Latest 20 entries across all employees.</p>
        </div>
        {recentEntries.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">No time entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-left text-xs">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Activity / Location</th>
                  <th className="py-2 font-medium">Clock In</th>
                  <th className="py-2 font-medium">Clock Out</th>
                  <th className="py-2 font-medium">Job Notes</th>
                  <th className="px-4 py-2 font-medium text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentEntries.map((entry) => {
                  const typeMeta = entryTypeMeta(entry);
                  const hours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
                  const presentation = getTimeEntryPresentation(entry, jobs);
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">{getEmployeeName(entry.employeeId)}</td>
                      <td className="py-2 text-gray-600 max-w-xs">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${typeMeta.className}`}>
                          {typeMeta.label}
                        </span>
                        <p className="text-xs text-gray-500 truncate mt-1">{presentation.workLabel}</p>
                      </td>
                      <td className="py-2 text-gray-500 text-xs">{formatDateTime(entry.clockIn)}</td>
                      <td className="py-2 text-gray-500 text-xs">{entry.clockOut ? formatDateTime(entry.clockOut) : <span className="text-brand-700 font-medium">Active</span>}</td>
                      <td className="py-2 text-gray-600 max-w-xs truncate">
                        {entry.notes?.trim() ? entry.notes : '—'}
                        {attachmentUrls[entry.id] ? (
                          <div className="mt-1">
                            <a href={attachmentUrls[entry.id]} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:text-brand-800">
                              View photo
                            </a>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-brand-600">{formatTimeEntryDuration(hours)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Hours by Employee</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500 text-left text-xs">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium text-right">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {employeeTotals.length === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-4 text-sm text-gray-400">No entries in this range.</td></tr>
                ) : employeeTotals.map((item) => (
                  <tr key={item.employeeId}>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedEmployeeId(item.employeeId)}
                        className={`text-left hover:underline ${selectedEmployeeId === item.employeeId ? 'font-semibold text-brand-700' : ''}`}
                      >
                        {item.name}
                      </button>
                    </td>
                    <td className="py-2 text-right font-semibold">{item.hours.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Hours by Job</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500 text-left text-xs">
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="py-2 font-medium text-right">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobTotals.length === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-4 text-sm text-gray-400">No job work in this range.</td></tr>
                ) : jobTotals.map((item) => (
                  <tr key={item.jobId}>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setJobFilter((current) => (current === item.jobId ? 'all' : item.jobId));
                          detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className={`text-left hover:underline ${jobFilter === item.jobId ? 'font-semibold text-brand-700' : ''}`}
                      >
                        {item.title}
                      </button>
                    </td>
                    <td className="py-2 text-right font-semibold">{item.hours.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div ref={detailSectionRef}>
      <Card className="mt-6 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-800">Time Entry Detail</h2>
            <p className="text-xs text-gray-500">Job totals split evenly across selected jobs.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleExportSummaryCsv} disabled={filteredEntries.length === 0}>
              Bookkeeper Export
            </Button>
            {currentUserRole === 'admin' && (
              <>
                <p className="text-xs text-gray-500">Legacy entries needing backfill: {legacyEntries.length}</p>
                <Button onClick={() => void backfillLegacyEntries()} disabled={backfillRunning || legacyEntries.length === 0}>
                  {backfillRunning ? 'Backfilling...' : 'Backfill Legacy Entries'}
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-left text-xs">
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="py-2 font-medium">Activity</th>
                <th className="py-2 font-medium">Job / Work Area</th>
                <th className="py-2 font-medium">Clock In</th>
                <th className="py-2 font-medium">Clock Out</th>
                <th className="py-2 font-medium">Notes</th>
                <th className="py-2 font-medium text-right">Duration</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredEntries.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-gray-400">No entries match these filters.</td></tr>
              ) : filteredEntries.map((entry) => {
                const hours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
                const isFocusedEmployee = selectedEmployeeId === entry.employeeId;
                const presentation = getTimeEntryPresentation(entry, jobs);
                return (
                  <tr
                    key={entry.id}
                    className={`align-top ${isFocusedEmployee ? 'bg-brand-50/60' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-2 font-medium text-gray-800">{getEmployeeName(entry.employeeId)}</td>
                    <td className="py-2 text-gray-600">{presentation.activityLabel}</td>
                    <td className="py-2 text-gray-600 max-w-xs">
                      <p className="truncate">{presentation.workLabel}</p>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{formatDateTime(entry.clockIn)}</td>
                    <td className="py-2 text-gray-500 text-xs">{entry.clockOut ? formatDateTime(entry.clockOut) : <span className="text-brand-700 font-medium">Active</span>}</td>
                    <td className="py-2 text-gray-600 max-w-xs truncate">
                      {entry.notes?.trim() ? entry.notes : '—'}
                      {attachmentUrls[entry.id] ? (
                        <div className="mt-1">
                          <a href={attachmentUrls[entry.id]} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:text-brand-800">
                            View photo
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 text-right font-semibold text-brand-600">{formatTimeEntryDuration(hours)}</td>
                    <td className="px-4 py-2 text-right">
                      {(currentUserRole === 'owner' || currentUserRole === 'admin') ? <Button variant="ghost" size="sm" onClick={() => setEditingTimeEntry(entry)}><Pencil size={14} /> Edit</Button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      </div>

      {(currentUserRole === 'admin' || currentUserRole === 'owner') && (
        <Card className="mt-6 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Recent Backfill Activity</h2>
            <p className="text-xs text-gray-500 mt-1">Tracks who ran legacy backfill and how many entries were affected.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-left text-xs">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="py-2 font-medium">User</th>
                  <th className="py-2 font-medium">Email</th>
                  <th className="py-2 font-medium text-right">Entries</th>
                  <th className="px-4 py-2 font-medium text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loadingBackfillAudits ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-400">Loading backfill activity...</td></tr>
                ) : backfillAuditEvents.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-400">No backfill activity recorded yet.</td></tr>
                ) : backfillAuditEvents.map((event) => {
                  const isExpanded = expandedAuditEventId === event.id;
                  const metadataFilters = event.metadata && typeof event.metadata === 'object' && 'filters' in event.metadata
                    ? (event.metadata.filters as {
                      startDate?: string;
                      endDate?: string;
                      workTypeFilter?: string;
                      jobFilter?: string;
                      employeeSearch?: string;
                    })
                    : null;
                  const metadataJobLabel = metadataFilters?.jobFilter
                    ? (metadataFilters.jobFilter === 'all' ? 'All Jobs' : getJobTitle(metadataFilters.jobFilter))
                    : '—';

                  return (
                    <Fragment key={event.id}>
                      <tr>
                        <td className="px-4 py-2 text-gray-600 text-xs">{formatDateTime(event.createdAt)}</td>
                        <td className="py-2 text-gray-700">{event.actorName}</td>
                        <td className="py-2 text-gray-500">{event.actorEmail}</td>
                        <td className="py-2 text-right font-semibold text-gray-800">{event.affectedEntryCount}</td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedAuditEventId(isExpanded ? null : event.id)}
                          >
                            {isExpanded ? 'Hide Filters' : 'View Filters'}
                          </Button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="px-4 py-3 bg-gray-50 text-xs text-gray-600">
                            {metadataFilters ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                                <p><span className="font-medium text-gray-700">Start:</span> {metadataFilters.startDate ?? '—'}</p>
                                <p><span className="font-medium text-gray-700">End:</span> {metadataFilters.endDate ?? '—'}</p>
                                <p><span className="font-medium text-gray-700">Type:</span> {metadataFilters.workTypeFilter ?? '—'}</p>
                                <p><span className="font-medium text-gray-700">Job:</span> {metadataJobLabel}</p>
                                <p><span className="font-medium text-gray-700">Employee Search:</span> {metadataFilters.employeeSearch?.trim() ? metadataFilters.employeeSearch : '—'}</p>
                              </div>
                            ) : (
                              <p>No filter metadata recorded for this event.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {currentUserRole !== 'admin' && (
        <p className="mt-4 text-xs text-gray-500">Backfill tools are restricted to admin users.</p>
      )}
      <EditTimeEntryModal
        entry={editingTimeEntry}
        employeeName={editingTimeEntry ? getEmployeeName(editingTimeEntry.employeeId) : ''}
        jobs={jobs}
        unbillableCategories={unbillableTimeCategories}
        onClose={() => setEditingTimeEntry(null)}
        onSave={editTimeEntry}
      />
    </div>
  );
}
