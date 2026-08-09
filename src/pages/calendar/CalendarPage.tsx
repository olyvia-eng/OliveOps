import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {
  format,
  startOfMonth,
  endOfMonth,
  addDays,
  subDays,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useStore } from '../../store';
import { Badge, Button, Card, PageHeader, Select } from '../../components/ui';
import ScheduleJobModal from '../../components/calendar/ScheduleJobModal';
import { formatDate, statusColor } from '../../utils';
import {
  formatCustomerPropertyLabel,
  formatScheduleTimeLabel,
  getAssignedEquipmentForJob,
  getJobAssignmentConflicts,
  getJobScheduleWindow,
} from '../../utils/jobSchedule';

interface Props {
  currentUserRole: string;
}

type CalendarView = 'month' | 'week' | 'day';

type CalendarEventExtendedProps = {
  summary: string;
  timeLabel: string;
  status: string;
  employeeCount: number;
  equipmentCount: number;
};

const CALENDAR_VIEW_MAP: Record<CalendarView, 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
};

const canManageScheduleRole = (role: string) => role === 'owner' || role === 'admin' || role === 'foreman';

export default function CalendarPage({ currentUserRole }: Props) {
  const navigate = useNavigate();
  const { jobs, customers, employees, budgets, equipmentAssets, updateJob } = useStore();
  const calendarRef = useRef<any>(null);
  const [activeView, setActiveView] = useState<CalendarView>('month');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleJobId, setScheduleJobId] = useState<string | undefined>(undefined);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState(() => ({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date()),
    title: format(new Date(), 'MMMM yyyy'),
  }));
  const canManageSchedule = canManageScheduleRole(currentUserRole);

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

  const calendarEvents = useMemo(() => {
    return scheduledJobs.map((entry) => ({
      id: entry.job.id,
      title: entry.job.title,
      start: entry.schedule.start,
      end: entry.schedule.allDay ? addDays(entry.schedule.end, 1) : entry.schedule.end,
      allDay: entry.schedule.allDay,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: 'inherit',
      extendedProps: {
        summary: entry.summary,
        timeLabel: entry.timeLabel,
        status: entry.job.status,
        employeeCount: entry.assignedEmployees.length,
        equipmentCount: entry.assignedEquipment.length,
      } satisfies CalendarEventExtendedProps,
    }));
  }, [scheduledJobs]);

  const currentRangeHasJobs = useMemo(() => {
    return scheduledJobs.some((entry) => entry.schedule.start < visibleRange.end && entry.schedule.end >= visibleRange.start);
  }, [scheduledJobs, visibleRange.end, visibleRange.start]);

  const selectedEvent = useMemo(() => {
    return scheduledJobs.find((entry) => entry.job.id === selectedJobId) ?? null;
  }, [scheduledJobs, selectedJobId]);

  const selectedEventConflicts = useMemo(() => {
    if (!selectedEvent) return [];

    return getJobAssignmentConflicts({
      jobId: selectedEvent.job.id,
      jobs,
      scheduleWindow: selectedEvent.schedule,
      assignedEmployeeIds: selectedEvent.job.assignedEmployeeIds,
      assignedEquipmentIds: selectedEvent.job.assignedEquipmentIds ?? [],
    });
  }, [jobs, selectedEvent]);

  const divisionOptions = useMemo(() => {
    return [...new Set(budgets.map((budget) => budget.division).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }, [budgets]);

  useEffect(() => {
    if (selectedJobId && !scheduledJobs.some((entry) => entry.job.id === selectedJobId)) {
      setSelectedJobId(null);
    }
  }, [scheduledJobs, selectedJobId]);

  const formatConflictWindow = (start: Date, end: Date, allDay: boolean) => {
    if (allDay) {
      const startLabel = format(start, 'MMM d');
      const endLabel = format(end, 'MMM d');
      return startLabel === endLabel ? `${startLabel} · All day` : `${startLabel} - ${endLabel} · All day`;
    }
    return `${format(start, 'MMM d, h:mm a')} - ${format(end, 'MMM d, h:mm a')}`;
  };

  const handleDatesSet = (arg: any) => {
    setVisibleRange({
      start: arg.start,
      end: arg.end,
      title: arg.view.title,
    });
  };

  const handleCalendarNavigation = (action: 'today' | 'prev' | 'next') => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    if (action === 'today') api.today();
    if (action === 'prev') api.prev();
    if (action === 'next') api.next();
  };

  const handleViewChange = (view: CalendarView) => {
    setActiveView(view);
    calendarRef.current?.getApi().changeView(CALENDAR_VIEW_MAP[view]);
  };

  const handleEventDrop = async (eventDrop: any) => {
    const start = eventDrop.event.start;
    const end = eventDrop.event.end ?? eventDrop.event.start;

    if (!start || !end) {
      eventDrop.revert();
      return;
    }

    const payload = eventDrop.event.allDay
      ? {
          startDate: format(start, 'yyyy-MM-dd'),
          endDate: format(subDays(end, 1), 'yyyy-MM-dd'),
          scheduledStartAt: undefined,
          scheduledEndAt: undefined,
          scheduleAllDay: true,
          scheduleConfirmed: true,
        }
      : {
          startDate: format(start, 'yyyy-MM-dd'),
          endDate: format(end, 'yyyy-MM-dd'),
          scheduledStartAt: start.toISOString(),
          scheduledEndAt: end.toISOString(),
          scheduleAllDay: false,
          scheduleConfirmed: true,
        };

    const saved = await updateJob(eventDrop.event.id, payload);
    if (!saved) {
      eventDrop.revert();
    }
  };

  const renderEventContent = (content: any) => {
    const props = content.event.extendedProps as CalendarEventExtendedProps;
    const selected = content.event.id === selectedJobId;
    const compact = content.view.type === 'dayGridMonth';

    return (
      <div className={`rounded-lg border px-2 py-1 text-left ${selected ? 'border-brand-400 bg-brand-100 ring-2 ring-brand-300' : 'border-brand-100 bg-brand-50'} text-brand-900`}>
        <p className="truncate text-xs font-semibold">{content.event.title}</p>
        {!compact ? <p className="truncate text-[11px] text-brand-700">{props.summary}</p> : null}
        <p className="truncate text-[10px] text-brand-600">{props.timeLabel}{props.employeeCount > 0 ? ` · ${props.employeeCount} crew` : ''}{props.equipmentCount > 0 ? ` · ${props.equipmentCount} equip` : ''}</p>
      </div>
    );
  };

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
              <Button variant="secondary" size="sm" onClick={() => handleCalendarNavigation('today')}>Today</Button>
              <Button variant="secondary" size="sm" onClick={() => handleCalendarNavigation('prev')}><ChevronLeft size={16} /></Button>
              <h2 className="inline-flex items-center gap-2 px-2 text-base font-semibold text-brand-900 dark:text-brand-50">
                <CalendarDays size={18} className="text-brand-600 dark:text-brand-200" />
                {visibleRange.title}
              </h2>
              <Button variant="secondary" size="sm" onClick={() => handleCalendarNavigation('next')}><ChevronRight size={16} /></Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['month', 'week', 'day'] as CalendarView[]).map((view) => (
                <Button
                  key={view}
                  size="sm"
                  variant={activeView === view ? 'primary' : 'secondary'}
                  onClick={() => handleViewChange(view)}
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
          {!currentRangeHasJobs ? (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-dashed border-brand-200 bg-brand-50/60 px-4 py-3 text-sm text-brand-700 dark:border-brand-500/40 dark:bg-brand-800/50 dark:text-brand-100 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{activeView === 'month' ? 'No work scheduled this month.' : activeView === 'week' ? 'No work scheduled this week.' : 'No work scheduled this day.'}</p>
                <p className="text-brand-500 dark:text-brand-200">Schedule a Job to start building your operations calendar.</p>
              </div>
              {canManageSchedule ? <Button size="sm" onClick={() => { setScheduleJobId(undefined); setScheduleOpen(true); }}><Plus size={14} /> Schedule Job</Button> : null}
            </div>
          ) : null}

          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin] as any}
            initialView={CALENDAR_VIEW_MAP[activeView]}
            initialDate={new Date()}
            events={calendarEvents}
            headerToolbar={false}
            editable={canManageSchedule}
            eventStartEditable={canManageSchedule}
            dayMaxEvents={3}
            weekends
            allDaySlot
            moreLinkClick="popover"
            height="auto"
            nowIndicator
            eventOverlap
            slotEventOverlap
            slotMinTime="05:00:00"
            slotMaxTime="22:00:00"
            datesSet={handleDatesSet}
            eventContent={renderEventContent}
            eventClick={(eventClick) => setSelectedJobId(eventClick.event.id)}
            eventDrop={(eventDrop) => void handleEventDrop(eventDrop)}
          />
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

              {selectedEventConflicts.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent-700">Scheduling Conflicts</p>
                  <div className="mt-2 space-y-2">
                    {selectedEventConflicts.map((conflict) => {
                      const employeeNames = conflict.conflictingEmployeeIds
                        .map((employeeId) => employees.find((employee) => employee.id === employeeId)?.name ?? employeeId)
                        .join(', ');
                      const equipmentNames = conflict.conflictingEquipmentIds
                        .map((assetId) => equipmentAssets.find((asset) => asset.id === assetId)?.name ?? assetId)
                        .join(', ');

                      return (
                        <div key={`selected-conflict-${conflict.job.id}`} className="rounded-2xl border border-accent-200 bg-accent-50/80 p-3 text-sm text-accent-900">
                          <p className="font-medium">{conflict.job.title}</p>
                          <p className="mt-1 text-xs text-accent-700">{formatConflictWindow(conflict.schedule.start, conflict.schedule.end, conflict.schedule.allDay)}</p>
                          {employeeNames ? <p className="mt-1 text-xs">Employees: {employeeNames}</p> : null}
                          {equipmentNames ? <p className="mt-1 text-xs">Equipment: {equipmentNames}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
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
