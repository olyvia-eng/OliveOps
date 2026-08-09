import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useStore } from '../../store';
import { Badge, Button, Card, PageHeader, Select } from '../../components/ui';
import ScheduleJobModal from '../../components/calendar/ScheduleJobModal';
import { formatDate, statusColor } from '../../utils';
import { formatCustomerPropertyLabel, formatScheduleTimeLabel, getAssignedEquipmentForJob, getJobScheduleWindow, getScheduledDayKeys } from '../../utils/jobSchedule';

interface Props {
  currentUserRole: string;
}

type CalendarView = 'month' | 'week' | 'day';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const canManageScheduleRole = (role: string) => role === 'owner' || role === 'admin' || role === 'foreman';

const segmentClassName = (segment: 'single' | 'start' | 'middle' | 'end', selected: boolean) => {
  const shape = {
    single: 'rounded-xl',
    start: 'rounded-l-xl rounded-r-md',
    middle: 'rounded-md',
    end: 'rounded-r-xl rounded-l-md',
  }[segment];
  return `${shape} ${selected ? 'ring-2 ring-brand-300 border-brand-400' : 'border-brand-100'} border`;
};

export default function CalendarPage({ currentUserRole }: Props) {
  const navigate = useNavigate();
  const { jobs, customers, employees, budgets, equipmentAssets, updateJob } = useStore();
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [activeView, setActiveView] = useState<CalendarView>('month');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleJobId, setScheduleJobId] = useState<string | undefined>(undefined);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const canManageSchedule = canManageScheduleRole(currentUserRole);

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(monthCursor);
    const monthEnd = endOfMonth(monthCursor);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [monthCursor]);

  const budgetDivisionById = useMemo(() => {
    const map = new Map<string, string>();
    budgets.forEach((budget) => map.set(budget.id, budget.division));
    return map;
  }, [budgets]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (jobFilter !== 'all' && job.id !== jobFilter) return false;
      if (employeeFilter !== 'all' && !job.assignedEmployeeIds.includes(employeeFilter)) return false;
      if (divisionFilter !== 'all') {
        const division = job.pricingBudgetId ? budgetDivisionById.get(job.pricingBudgetId) : undefined;
        if (division !== divisionFilter) return false;
      }
      return true;
    });
  }, [budgetDivisionById, divisionFilter, employeeFilter, jobFilter, jobs]);

  const scheduledJobs = useMemo(() => {
    return filteredJobs
      .map((job) => {
        const schedule = getJobScheduleWindow(job);
        if (!schedule) return null;

        const customer = customers.find((item) => item.id === job.customerId) ?? null;
        const assignedEmployees = employees.filter((employee) => job.assignedEmployeeIds.includes(employee.id));
        const assignedEquipment = getAssignedEquipmentForJob(job, equipmentAssets);

        return {
          job,
          customer,
          schedule,
          assignedEmployees,
          assignedEquipment,
          summary: formatCustomerPropertyLabel(job, customer),
          timeLabel: formatScheduleTimeLabel(job),
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((left, right) => left.schedule.start.getTime() - right.schedule.start.getTime() || left.job.title.localeCompare(right.job.title));
  }, [customers, employees, equipmentAssets, filteredJobs]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, Array<{
      jobId: string;
      title: string;
      summary: string;
      timeLabel: string;
      status: string;
      segment: 'single' | 'start' | 'middle' | 'end';
      employeeCount: number;
    }>>();

    scheduledJobs.forEach((entry) => {
      const dayKeys = getScheduledDayKeys(entry.job);
      dayKeys.forEach((dayKey, index) => {
        const existing = map.get(dayKey) ?? [];
        const segment = dayKeys.length === 1
          ? 'single'
          : index === 0
            ? 'start'
            : index === dayKeys.length - 1
              ? 'end'
              : 'middle';

        existing.push({
          jobId: entry.job.id,
          title: entry.job.title,
          summary: entry.summary,
          timeLabel: entry.timeLabel,
          status: entry.job.status,
          segment,
          employeeCount: entry.assignedEmployees.length,
        });
        map.set(dayKey, existing);
      });
    });

    return map;
  }, [scheduledJobs]);

  const mobileAgendaDays = useMemo(() => {
    return monthDays
      .filter((day) => isSameMonth(day, monthCursor))
      .map((day) => ({
        day,
        key: format(day, 'yyyy-MM-dd'),
        events: eventsByDate.get(format(day, 'yyyy-MM-dd')) ?? [],
      }))
      .filter((entry) => entry.events.length > 0);
  }, [eventsByDate, monthCursor, monthDays]);

  const currentMonthHasJobs = useMemo(() => {
    const start = startOfMonth(monthCursor);
    const end = endOfMonth(monthCursor);
    return scheduledJobs.some((entry) => isWithinInterval(entry.schedule.start, { start, end }) || isWithinInterval(entry.schedule.end, { start, end }) || (entry.schedule.start < start && entry.schedule.end > end));
  }, [monthCursor, scheduledJobs]);

  const selectedEvent = useMemo(() => {
    return scheduledJobs.find((entry) => entry.job.id === selectedJobId) ?? null;
  }, [scheduledJobs, selectedJobId]);

  const divisionOptions = useMemo(() => {
    return [...new Set(budgets.map((budget) => budget.division).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }, [budgets]);

  useEffect(() => {
    if (selectedJobId && !scheduledJobs.some((entry) => entry.job.id === selectedJobId)) {
      setSelectedJobId(null);
    }
  }, [scheduledJobs, selectedJobId]);

  const handleScheduleSave = async (payload: {
    jobId: string;
    startDate: string;
    endDate?: string;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    scheduleAllDay: boolean;
    scheduleConfirmed: boolean;
    scheduleNotes: string;
    assignedEmployeeIds: string[];
    assignedEquipmentIds: string[];
  }) => {
    return updateJob(payload.jobId, payload);
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Schedule jobs, crews, equipment, and company events."
        action={canManageSchedule ? <Button onClick={() => { setScheduleJobId(undefined); setScheduleOpen(true); }}><Plus size={16} /> Schedule</Button> : undefined}
      />

      <Card className="overflow-hidden">
        <div className="border-b border-brand-100 px-4 py-4 dark:border-brand-600">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setMonthCursor(new Date())}>Today</Button>
              <Button variant="secondary" size="sm" onClick={() => setMonthCursor((prev) => subMonths(prev, 1))}><ChevronLeft size={16} /></Button>
              <h2 className="inline-flex items-center gap-2 px-2 text-base font-semibold text-brand-900 dark:text-brand-50">
                <CalendarDays size={18} className="text-brand-600 dark:text-brand-200" />
                {format(monthCursor, 'MMMM yyyy')}
              </h2>
              <Button variant="secondary" size="sm" onClick={() => setMonthCursor((prev) => addMonths(prev, 1))}><ChevronRight size={16} /></Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['month', 'week', 'day'] as CalendarView[]).map((view) => (
                <Button
                  key={view}
                  size="sm"
                  variant={activeView === view ? 'primary' : 'secondary'}
                  disabled={view !== 'month'}
                  title={view === 'month' ? undefined : 'Week and Day views are planned next without changing calendar libraries in this phase.'}
                  onClick={() => setActiveView(view)}
                >
                  {view.charAt(0).toUpperCase() + view.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <Select value={divisionFilter} onChange={(event) => setDivisionFilter(event.target.value)}>
              <option value="all">All Divisions</option>
              {divisionOptions.map((division) => <option key={division} value={division}>{division}</option>)}
            </Select>
            <Select value={jobFilter} onChange={(event) => setJobFilter(event.target.value)}>
              <option value="all">All Jobs</option>
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
            </Select>
            <Select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option value="all">All Employees</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </Select>
            <div className="hidden xl:block" />
          </div>
        </div>

        <div className="p-4">
          {!currentMonthHasJobs ? (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-dashed border-brand-200 bg-brand-50/60 px-4 py-3 text-sm text-brand-700 dark:border-brand-500/40 dark:bg-brand-800/50 dark:text-brand-100 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">No work scheduled this month.</p>
                <p className="text-brand-500 dark:text-brand-200">Schedule a Job to start building your operations calendar.</p>
              </div>
              {canManageSchedule ? <Button size="sm" onClick={() => { setScheduleJobId(undefined); setScheduleOpen(true); }}><Plus size={14} /> Schedule Job</Button> : null}
            </div>
          ) : null}

          <div className="space-y-3 md:hidden">
            {mobileAgendaDays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-brand-200 px-4 py-6 text-sm text-brand-500 dark:border-brand-500/40 dark:text-brand-200">
                No work scheduled this month.
              </div>
            ) : mobileAgendaDays.map((entry) => (
              <div key={entry.key} className="rounded-2xl border border-brand-100 p-3 dark:border-brand-600">
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-50">{format(entry.day, 'EEEE, MMM d')}</p>
                <div className="mt-3 space-y-2">
                  {entry.events.map((event) => (
                    <button
                      key={`${entry.key}:${event.jobId}:${event.segment}`}
                      type="button"
                      onClick={() => setSelectedJobId(event.jobId)}
                      className={`w-full rounded-2xl bg-white px-3 py-2 text-left transition-colors hover:bg-brand-50 dark:bg-brand-700 dark:hover:bg-brand-600 ${segmentClassName(event.segment, event.jobId === selectedJobId)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-brand-900 dark:text-brand-50">{event.title}</p>
                          <p className="truncate text-xs text-brand-500 dark:text-brand-200">{event.summary}</p>
                        </div>
                        <Badge label={event.status} className={statusColor[event.status]} />
                      </div>
                      <p className="mt-1 text-xs text-brand-500 dark:text-brand-200">{event.timeLabel}{event.employeeCount > 0 ? ` · ${event.employeeCount} assigned` : ''}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <div className="mb-2 grid grid-cols-7 text-xs text-brand-400 dark:text-brand-200">
              {WEEKDAY_LABELS.map((day) => (
                <div key={day} className="px-2 py-1 font-medium">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {monthDays.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayEvents = eventsByDate.get(key) ?? [];

                return (
                  <div
                    key={key}
                    className={`min-h-36 rounded-2xl border p-2 ${
                      isSameMonth(day, monthCursor)
                        ? 'bg-white border-brand-100 dark:bg-brand-700 dark:border-brand-600'
                        : 'bg-brand-50/50 border-brand-100 text-brand-300 dark:bg-brand-800/70 dark:border-brand-700 dark:text-brand-400'
                    } ${isToday(day) ? 'ring-2 ring-brand-300' : ''}`}
                  >
                    <p className={`mb-2 text-xs ${isToday(day) ? 'font-bold text-brand-700 dark:text-brand-100' : 'text-brand-500 dark:text-brand-200'}`}>
                      {format(day, 'd')}
                    </p>

                    <div className="space-y-1.5">
                      {dayEvents.slice(0, 3).map((event) => {
                        const showFull = event.segment === 'single' || event.segment === 'start';
                        return (
                          <button
                            key={`${key}:${event.jobId}:${event.segment}`}
                            type="button"
                            onClick={() => setSelectedJobId(event.jobId)}
                            className={`block w-full bg-brand-50 px-2 py-1.5 text-left text-[11px] text-brand-800 transition-colors hover:bg-brand-100 dark:bg-brand-600 dark:text-brand-50 dark:hover:bg-brand-500 ${segmentClassName(event.segment, event.jobId === selectedJobId)}`}
                            title={`${event.title} · ${event.summary}`}
                          >
                            <p className="truncate font-semibold">{event.title}</p>
                            {showFull ? <p className="truncate text-[10px] text-brand-500 dark:text-brand-100">{event.summary}</p> : null}
                            {showFull ? <p className="truncate text-[10px] text-brand-500 dark:text-brand-100">{event.timeLabel}{event.employeeCount > 0 ? ` · ${event.employeeCount} crew` : ''}</p> : null}
                          </button>
                        );
                      })}
                      {dayEvents.length > 3 ? <p className="px-1 text-[11px] text-brand-400 dark:text-brand-200">+{dayEvents.length - 3} more</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <ScheduleJobModal
        open={scheduleOpen}
        title={scheduleJobId ? 'Edit Schedule' : 'Schedule Job'}
        jobs={jobs}
        customers={customers}
        employees={employees}
        equipmentAssets={equipmentAssets}
        initialJobId={scheduleJobId}
        onClose={() => setScheduleOpen(false)}
        onSave={handleScheduleSave}
      />

      {selectedEvent ? (
        <div className="fixed inset-0 z-40">
          <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setSelectedJobId(null)} aria-label="Close event details" />
          <div className="absolute right-0 top-0 h-full w-full max-w-md border-l border-brand-100 bg-white p-5 shadow-2xl dark:border-brand-600 dark:bg-brand-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge label={selectedEvent.job.status} className={statusColor[selectedEvent.job.status]} />
                <h2 className="mt-3 text-xl font-semibold text-brand-900 dark:text-brand-50">{selectedEvent.job.title}</h2>
                <p className="mt-1 text-sm text-brand-500 dark:text-brand-200">{selectedEvent.summary}</p>
              </div>
              <button type="button" onClick={() => setSelectedJobId(null)} className="h-9 w-9 rounded-xl text-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:text-brand-200 dark:hover:bg-brand-600 dark:hover:text-brand-50">&times;</button>
            </div>

            <div className="mt-5 space-y-4 text-sm">
              <div className="rounded-2xl border border-brand-100 p-4 dark:border-brand-600">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Schedule</p>
                <p className="mt-2 font-medium text-brand-900 dark:text-brand-50">{formatDate(selectedEvent.schedule.start.toISOString())}{selectedEvent.schedule.startKey !== selectedEvent.schedule.endKey ? ` -> ${formatDate(selectedEvent.schedule.end.toISOString())}` : ''}</p>
                <p className="mt-1 text-brand-500 dark:text-brand-200">{selectedEvent.timeLabel}</p>
                <p className="mt-2 text-brand-500 dark:text-brand-200">{selectedEvent.job.scheduleNotes?.trim() || selectedEvent.job.notes?.trim() || 'No schedule notes.'}</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Assigned Employees</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedEvent.assignedEmployees.length === 0
                    ? <span className="text-brand-500 dark:text-brand-200">No employees assigned.</span>
                    : selectedEvent.assignedEmployees.map((employee) => <Badge key={employee.id} label={employee.name} className="bg-brand-100 text-brand-700 dark:bg-brand-600 dark:text-brand-50" />)}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Assigned Equipment</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedEvent.assignedEquipment.length === 0
                    ? <span className="text-brand-500 dark:text-brand-200">No equipment assigned.</span>
                    : selectedEvent.assignedEquipment.map((asset) => <Badge key={asset.id} label={asset.name} className="bg-accent-50 text-accent-700 dark:bg-accent-900/20 dark:text-accent-100" />)}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate(`/jobs/${selectedEvent.job.id}`)}>Open Job</Button>
              {canManageSchedule ? <Button onClick={() => { setScheduleJobId(selectedEvent.job.id); setScheduleOpen(true); }}>Edit Schedule</Button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
