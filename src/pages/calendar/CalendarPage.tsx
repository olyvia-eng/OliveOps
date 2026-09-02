import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {
  format,
  addDays,
  startOfWeek,
  subDays,
} from 'date-fns';
import { AlertTriangle, Plus } from 'lucide-react';
import { useStore } from '../../store';
import { Badge, Button, Card, Modal, PageHeader } from '../../components/ui';
import type { CalendarColourBy, CalendarPreferences, CalendarView } from '../../types';
import ScheduleJobModal from '../../components/calendar/ScheduleJobModal';
import { CalendarFilters, CalendarLegend, CalendarToolbar, ColourBySelector, ScheduleEventCard } from '../../components/calendar/CalendarControls';
import CrewLaneWeekView from '../../components/calendar/CrewLaneWeekView';
import { formatDate, statusColor } from '../../utils';
import { DEFAULT_CALENDAR_PREFERENCES, filterScheduleEntries, getEffectiveDivision, getScheduleLegend, normalizeCalendarPreferences, resolveScheduleColour } from '../../utils/scheduleModel.js';
import { exclusiveEndDateKey, formatTimeOffType, getEmployeeTimeOffConflicts, getJobTimeOffConflicts, normalizeTimeOffScheduleEntry, type EmployeeTimeOffConflict, type ScheduleTimeOff } from '../../utils/employeeAvailability.js';
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

type CalendarEventExtendedProps = {
  source: 'oliveops' | 'time_off';
  summary: string;
  timeLabel: string;
  status: string;
  employeeCount: number;
  equipmentCount: number;
  crewName: string;
  colour: { value: string; tint: string };
  timeOffConflictCount?: number;
  timeOffRequest?: ScheduleTimeOff;
};

const CALENDAR_VIEW_MAP: Record<CalendarView, 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
};

const canManageScheduleRole = (role: string) => role === 'owner' || role === 'admin' || role === 'foreman';
const getWeekRange = (value: Date) => {
  const start = startOfWeek(value, { weekStartsOn: 1 });
  const end = addDays(start, 7);
  return { start, end, title: `${format(start, 'MMM d')} - ${format(addDays(end, -1), 'MMM d, yyyy')}` };
};

export default function CalendarPage({ currentUserRole }: Props) {
  const navigate = useNavigate();
  const { jobs, customers, employees, budgets, budgetDivisions, crews, divisions, equipmentAssets, updateJobSchedule } = useStore();
  const calendarRef = useRef<any>(null);
  const [preferences, setPreferences] = useState<CalendarPreferences>(DEFAULT_CALENDAR_PREFERENCES);
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState('all');
  const [crewFilter, setCrewFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [equipmentFilter, setEquipmentFilter] = useState('all');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleJobId, setScheduleJobId] = useState<string | undefined>(undefined);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTimeOffId, setSelectedTimeOffId] = useState<string | null>(null);
  const [approvedTimeOff, setApprovedTimeOff] = useState<ScheduleTimeOff[]>([]);
  const [pendingTimeOffOverride, setPendingTimeOffOverride] = useState<{ conflicts: EmployeeTimeOffConflict[]; proceed: () => void; cancel: () => void } | null>(null);
  const [visibleRange, setVisibleRange] = useState(() => getWeekRange(new Date()));
  const canManageSchedule = canManageScheduleRole(currentUserRole);

  const allScheduledJobs = useMemo(() => {
    return jobs
      .map((job) => {
        const schedule = getJobScheduleWindow(job);
        if (!schedule) return null;

        const customer = customers.find((item) => item.id === job.customerId) ?? null;
        const assignedEmployees = employees.filter((employee) => (job.assignedEmployeeIds ?? []).includes(employee.id));
        const assignedEquipment = getAssignedEquipmentForJob(job, equipmentAssets);
        const crew = crews.find((item) => item.id === job.crewId) ?? null;
        const division = getEffectiveDivision(job, divisions, budgets);

        return {
          job,
          customer,
          schedule,
          assignedEmployees,
          assignedEquipment,
          crew,
          division,
          summary: formatCustomerPropertyLabel(job, customer),
          timeLabel: formatScheduleTimeLabel(job),
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((left, right) => left.schedule.start.getTime() - right.schedule.start.getTime() || left.job.title.localeCompare(right.job.title));
  }, [budgets, crews, customers, divisions, employees, equipmentAssets, jobs]);

  const oliveOpsEntries = useMemo(() => allScheduledJobs.map((entry) => ({
    source: 'oliveops' as const,
    jobId: entry.job.id,
    title: entry.job.title,
    summary: entry.summary,
    timeLabel: entry.schedule.allDay ? '' : entry.timeLabel,
    status: entry.job.status,
    start: entry.schedule.start.toISOString(),
    end: entry.schedule.end.toISOString(),
    startKey: entry.schedule.startKey,
    endKey: entry.schedule.endKey,
    allDay: entry.schedule.allDay,
    crew: entry.crew,
    division: entry.division,
    employeeIds: entry.job.assignedEmployeeIds ?? [],
    equipmentIds: entry.job.assignedEquipmentIds ?? [],
  })), [allScheduledJobs]);

  const timeOffEntries = useMemo(() => approvedTimeOff.map((request) => {
    const employee = employees.find((item) => item.id === request.employeeId);
    const employeeCrews = crews.filter((crew) => crew.leadEmployeeId === request.employeeId || crew.memberIds.includes(request.employeeId));
    return {
      ...normalizeTimeOffScheduleEntry(request, employee, [...new Set(employeeCrews.map((crew) => crew.defaultDivisionId).filter((id): id is string => Boolean(id)))]),
      crewIds: employeeCrews.map((crew) => crew.id),
    };
  }), [approvedTimeOff, crews, employees]);

  const normalizedEntries = useMemo(() => [...oliveOpsEntries, ...timeOffEntries], [oliveOpsEntries, timeOffEntries]);

  const filteredEntries = useMemo(() => filterScheduleEntries(normalizedEntries, {
    divisionId: divisionFilter,
    crewId: crewFilter,
    employeeId: employeeFilter,
    status: statusFilter,
    jobId: jobFilter,
    equipmentId: equipmentFilter,
    showGoogleEvents: preferences.showGoogleEvents,
    showOutlookEvents: preferences.showOutlookEvents,
  }), [crewFilter, divisionFilter, employeeFilter, equipmentFilter, jobFilter, normalizedEntries, preferences.showGoogleEvents, preferences.showOutlookEvents, statusFilter]);

  const scheduledJobs = useMemo(() => {
    const visibleJobIds = new Set(filteredEntries.map((entry) => entry.jobId));
    return allScheduledJobs.filter((entry) => visibleJobIds.has(entry.job.id));
  }, [allScheduledJobs, filteredEntries]);
  const filteredTimeOffEntries = useMemo(() => filteredEntries.filter((entry) => entry.source === 'time_off'), [filteredEntries]);

  const legendItems = useMemo(() => getScheduleLegend(filteredEntries, preferences.colourBy), [filteredEntries, preferences.colourBy]);

  const calendarEvents = useMemo(() => {
    const oliveOpsEvents = scheduledJobs.map((entry) => ({
      id: entry.job.id,
      title: entry.job.title,
      start: entry.schedule.start,
      end: entry.schedule.allDay ? addDays(entry.schedule.end, 1) : entry.schedule.end,
      allDay: entry.schedule.allDay,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: 'inherit',
      extendedProps: {
        source: 'oliveops' as const,
        summary: entry.summary,
        timeLabel: entry.schedule.allDay ? '' : entry.timeLabel,
        status: entry.job.status,
        employeeCount: entry.assignedEmployees.length,
        equipmentCount: entry.assignedEquipment.length,
        crewName: entry.crew?.name ?? 'Unassigned crew',
        colour: resolveScheduleColour({ colourBy: preferences.colourBy, job: entry.job, crew: entry.crew, division: entry.division }),
        timeOffConflictCount: getJobTimeOffConflicts(entry.job, approvedTimeOff, crews).length,
      } satisfies CalendarEventExtendedProps,
    }));
    const timeOffEvents = filteredTimeOffEntries.map((entry) => ({
      id: `time-off:${entry.timeOffRequestId}`,
      title: entry.title,
      start: entry.startKey,
      end: exclusiveEndDateKey(entry.endKey),
      allDay: true,
      editable: false,
      startEditable: false,
      durationEditable: false,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: 'inherit',
      extendedProps: {
        source: 'time_off' as const,
        summary: 'Approved Time Off',
        timeLabel: '',
        status: 'approved',
        employeeCount: 1,
        equipmentCount: 0,
        crewName: '',
        colour: resolveScheduleColour({ source: 'time_off', colourBy: preferences.colourBy }),
        timeOffRequest: entry.timeOffRequest,
      } satisfies CalendarEventExtendedProps,
    }));
    return [...oliveOpsEvents, ...timeOffEvents];
  }, [approvedTimeOff, crews, filteredTimeOffEntries, preferences.colourBy, scheduledJobs]);

  const currentRangeHasEvents = useMemo(() => {
    const firstKey = format(visibleRange.start, 'yyyy-MM-dd');
    const lastKey = format(subDays(visibleRange.end, 1), 'yyyy-MM-dd');
    return filteredEntries.some((entry) => entry.startKey <= lastKey && entry.endKey >= firstKey);
  }, [filteredEntries, visibleRange.end, visibleRange.start]);

  const selectedEvent = useMemo(() => {
    return scheduledJobs.find((entry) => entry.job.id === selectedJobId) ?? null;
  }, [scheduledJobs, selectedJobId]);
  const selectedTimeOff = useMemo(() => approvedTimeOff.find((request) => request.id === selectedTimeOffId) ?? null, [approvedTimeOff, selectedTimeOffId]);

  const selectedEventConflicts = useMemo(() => {
    if (!selectedEvent) return [];

    return getJobAssignmentConflicts({
      jobId: selectedEvent.job.id,
      jobs,
      scheduleWindow: selectedEvent.schedule,
      crewId: selectedEvent.job.crewId ?? undefined,
      assignedEmployeeIds: selectedEvent.job.assignedEmployeeIds ?? [],
      assignedEquipmentIds: selectedEvent.job.assignedEquipmentIds ?? [],
    });
  }, [jobs, selectedEvent]);

  const conflictJobIds = useMemo(() => new Set(allScheduledJobs
    .filter((entry) => getJobAssignmentConflicts({
      jobId: entry.job.id,
      jobs,
      scheduleWindow: entry.schedule,
      crewId: entry.job.crewId ?? undefined,
      assignedEmployeeIds: entry.job.assignedEmployeeIds ?? [],
      assignedEquipmentIds: entry.job.assignedEquipmentIds ?? [],
    }).length > 0 || getJobTimeOffConflicts(entry.job, approvedTimeOff, crews).length > 0)
    .map((entry) => entry.job.id)), [allScheduledJobs, approvedTimeOff, crews, jobs]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(visibleRange.start, index)), [visibleRange.start]);
  const hasNarrowingFilter = divisionFilter !== 'all' || crewFilter !== 'all' || employeeFilter !== 'all' || statusFilter !== 'all' || jobFilter !== 'all' || equipmentFilter !== 'all';
  const visibleLaneCrews = useMemo(() => {
    if (!hasNarrowingFilter) return crews.filter((crew) => crew.active);
    const visibleCrewIds = new Set(filteredEntries.filter((entry) => entry.source === 'oliveops').map((entry) => entry.crew?.id).filter(Boolean));
    return crews.filter((crew) => visibleCrewIds.has(crew.id));
  }, [crews, filteredEntries, hasNarrowingFilter]);

  const divisionOptions = useMemo(() => {
    const options = new Map(divisions.filter((division) => division.active).map((division) => [division.id, { id: division.id, name: division.name }]));
    allScheduledJobs.forEach((entry) => {
      if (entry.division) options.set(entry.division.id, { id: entry.division.id, name: entry.division.name });
    });
    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [allScheduledJobs, divisions]);

  useEffect(() => {
    const controller = new AbortController();
    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/calendar-preferences', { credentials: 'include', signal: controller.signal });
        const payload = await response.json() as { ok?: boolean; preferences?: Partial<CalendarPreferences> };
        if (!response.ok || !payload.ok) return;
        const next = normalizeCalendarPreferences(payload.preferences);
        setPreferences(next);
        if (next.view === 'week') setVisibleRange(getWeekRange(new Date()));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setPreferences(DEFAULT_CALENDAR_PREFERENCES);
      }
    };
    void loadPreferences();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadApprovedTimeOff = async () => {
      const startDate = format(visibleRange.start, 'yyyy-MM-dd');
      const endDate = format(subDays(visibleRange.end, 1), 'yyyy-MM-dd');
      try {
        const response = await fetch(`/api/time-off-requests?action=schedule&startDate=${startDate}&endDate=${endDate}`, { credentials: 'include', signal: controller.signal });
        const payload = await response.json() as { ok?: boolean; items?: ScheduleTimeOff[] };
        if (response.ok && payload.ok) setApprovedTimeOff(payload.items ?? []);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setApprovedTimeOff([]);
      }
    };
    void loadApprovedTimeOff();
    const refreshOnFocus = () => void loadApprovedTimeOff();
    window.addEventListener('focus', refreshOnFocus);
    return () => { controller.abort(); window.removeEventListener('focus', refreshOnFocus); };
  }, [visibleRange.end, visibleRange.start]);

  useEffect(() => {
    if (selectedJobId && !scheduledJobs.some((entry) => entry.job.id === selectedJobId)) {
      setSelectedJobId(null);
    }
  }, [scheduledJobs, selectedJobId]);

  const formatConflictWindow = (start: Date, end: Date, allDay: boolean) => {
    if (allDay) {
      const startLabel = format(start, 'MMM d');
      const endLabel = format(end, 'MMM d');
      return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
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
    if (preferences.view === 'week') {
      const target = action === 'today' ? new Date() : addDays(visibleRange.start, action === 'prev' ? -7 : 7);
      setVisibleRange(getWeekRange(target));
      return;
    }
    const api = calendarRef.current?.getApi();
    if (!api) return;

    if (action === 'today') api.today();
    if (action === 'prev') api.prev();
    if (action === 'next') api.next();
  };

  const updatePreferences = (patch: Partial<CalendarPreferences>) => {
    const previous = preferences;
    const next = normalizeCalendarPreferences({ ...preferences, ...patch });
    setPreferences(next);
    void fetch('/api/calendar-preferences', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).then((response) => {
      if (!response.ok) setPreferences(previous);
    }).catch(() => setPreferences(previous));
  };

  const handleViewChange = (view: CalendarView) => {
    const currentView = preferences.view;
    updatePreferences({ view });
    if (view === 'week') setVisibleRange(getWeekRange(visibleRange.start));
    if (currentView !== 'week' && view !== 'week') calendarRef.current?.getApi().changeView(CALENDAR_VIEW_MAP[view]);
  };

  const handleWeekShift = async (jobId: string, dayDelta: number) => {
    if (!dayDelta) return;
    const entry = allScheduledJobs.find((item) => item.job.id === jobId);
    if (!entry) return;
    const shiftedStart = addDays(entry.schedule.start, dayDelta);
    const shiftedEnd = addDays(entry.schedule.end, dayDelta);
    const payload = entry.schedule.allDay ? {
      startDate: format(shiftedStart, 'yyyy-MM-dd'),
      endDate: format(shiftedEnd, 'yyyy-MM-dd'),
    } : {
      startDate: format(shiftedStart, 'yyyy-MM-dd'),
      endDate: format(shiftedEnd, 'yyyy-MM-dd'),
      scheduledStartAt: shiftedStart.toISOString(),
      scheduledEndAt: shiftedEnd.toISOString(),
    };
    const conflicts = getEmployeeTimeOffConflicts({ employeeIds: entry.job.assignedEmployeeIds ?? [], crewId: entry.job.crewId ?? undefined, crews, startDate: payload.startDate, endDate: payload.endDate, approvedTimeOff });
    if (conflicts.length > 0) {
      setPendingTimeOffOverride({ conflicts, proceed: () => { setPendingTimeOffOverride(null); void updateJobSchedule(jobId, payload); }, cancel: () => setPendingTimeOffOverride(null) });
      return;
    }
    await updateJobSchedule(jobId, payload);
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

    const entry = allScheduledJobs.find((item) => item.job.id === eventDrop.event.id);
    if (!entry) { eventDrop.revert(); return; }
    const conflicts = getEmployeeTimeOffConflicts({ employeeIds: entry.job.assignedEmployeeIds ?? [], crewId: entry.job.crewId ?? undefined, crews, startDate: payload.startDate, endDate: payload.endDate, approvedTimeOff });
    const save = async () => { const saved = await updateJobSchedule(eventDrop.event.id, payload); if (!saved) eventDrop.revert(); };
    if (conflicts.length > 0) {
      setPendingTimeOffOverride({ conflicts, proceed: () => { setPendingTimeOffOverride(null); void save(); }, cancel: () => { setPendingTimeOffOverride(null); eventDrop.revert(); } });
      return;
    }
    await save();
  };

  const renderEventContent = (content: any) => {
    const props = content.event.extendedProps as CalendarEventExtendedProps;
    const selected = content.event.id === selectedJobId;
    const compact = content.view.type === 'dayGridMonth';

    const detail = props.source === 'time_off'
      ? 'All Day'
      : [props.timeLabel, props.employeeCount > 0 ? `${props.employeeCount} people` : '', props.equipmentCount > 0 ? `${props.equipmentCount} equip` : '', props.timeOffConflictCount ? `${props.timeOffConflictCount} unavailable` : ''].filter(Boolean).join(' · ');
    return <ScheduleEventCard title={content.event.title} summary={props.source === 'time_off' ? props.summary : `${props.crewName} · ${props.summary}`} detail={detail} colour={props.colour} compact={compact} selected={selected} />;
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
    crewId: string | null;
    divisionId?: string | null;
    assignedEmployeeIds: string[];
    assignedEquipmentIds: string[];
  }) => {
    const { jobId, ...schedule } = payload;
    return updateJobSchedule(jobId, schedule);
  };

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Coordinate company jobs, crews, employees, and equipment."
        action={canManageSchedule ? <Button onClick={() => { setScheduleJobId(undefined); setScheduleOpen(true); }}><Plus size={16} /> Schedule</Button> : undefined}
      />

      <Card className="overflow-hidden">
        <div className="border-b border-brand-100 px-4 py-4 dark:border-brand-600">
          <CalendarToolbar title={visibleRange.title} view={preferences.view} onNavigate={handleCalendarNavigation} onViewChange={handleViewChange} />
          <CalendarFilters divisions={divisionOptions} crews={crews.filter((crew) => crew.active)} employees={employees} jobs={jobs} equipment={equipmentAssets} divisionId={divisionFilter} crewId={crewFilter} employeeId={employeeFilter} status={statusFilter} jobId={jobFilter} equipmentId={equipmentFilter} onDivisionChange={setDivisionFilter} onCrewChange={setCrewFilter} onEmployeeChange={setEmployeeFilter} onStatusChange={setStatusFilter} onJobChange={setJobFilter} onEquipmentChange={setEquipmentFilter} />
          <div className="mt-4 flex flex-col gap-3 border-t border-brand-100 pt-3 dark:border-brand-600 lg:flex-row lg:items-center lg:justify-between">
            <ColourBySelector value={preferences.colourBy} onChange={(colourBy: CalendarColourBy) => updatePreferences({ colourBy })} />
            <CalendarLegend items={legendItems} />
          </div>
        </div>

        <div className="p-4">
          {!currentRangeHasEvents ? (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-dashed border-brand-200 bg-brand-50/60 px-4 py-3 text-sm text-brand-700 dark:border-brand-500/40 dark:bg-brand-800/50 dark:text-brand-100 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{preferences.view === 'month' ? 'No work scheduled this month.' : preferences.view === 'week' ? 'No work scheduled this week.' : 'No work scheduled this day.'}</p>
                <p className="text-brand-500 dark:text-brand-200">Schedule a Job to start building your operations calendar.</p>
              </div>
              {canManageSchedule ? <Button size="sm" onClick={() => { setScheduleJobId(undefined); setScheduleOpen(true); }}><Plus size={14} /> Schedule Job</Button> : null}
            </div>
          ) : null}

          {preferences.view === 'week' ? (
            <CrewLaneWeekView
              days={weekDays}
              entries={filteredEntries}
              activeCrews={visibleLaneCrews}
              colourBy={preferences.colourBy}
              selectedJobId={selectedJobId}
              conflictJobIds={conflictJobIds}
              canManage={canManageSchedule}
              onSelect={(entry) => {
                if (entry.source === 'time_off') { setSelectedTimeOffId(entry.timeOffRequestId ?? null); setSelectedJobId(null); }
                else { setSelectedJobId(entry.jobId ?? null); setSelectedTimeOffId(null); }
              }}
              onShiftJob={(jobId, dayDelta) => void handleWeekShift(jobId, dayDelta)}
            />
          ) : (
            <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin] as any}
            initialView={CALENDAR_VIEW_MAP[preferences.view]}
            initialDate={visibleRange.start}
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
            eventClick={(eventClick) => {
              const props = eventClick.event.extendedProps as CalendarEventExtendedProps;
              if (props.source === 'time_off') { setSelectedTimeOffId(props.timeOffRequest?.id ?? null); setSelectedJobId(null); }
              else { setSelectedJobId(eventClick.event.id); setSelectedTimeOffId(null); }
            }}
            eventDrop={(eventDrop) => void handleEventDrop(eventDrop)}
            />
          )}
        </div>
      </Card>

      <ScheduleJobModal
        open={scheduleOpen}
        title={scheduleJobId ? 'Edit Schedule' : 'Schedule Job'}
        jobs={jobs}
        customers={customers}
        employees={employees}
        equipmentAssets={equipmentAssets}
        crews={crews}
        divisions={divisions}
        budgetDivisions={budgetDivisions}
        initialJobId={scheduleJobId}
        approvedTimeOff={approvedTimeOff}
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
                {!selectedEvent.schedule.allDay ? <p className="mt-1 text-brand-500 dark:text-brand-200">{selectedEvent.timeLabel}</p> : null}
                <p className="mt-2 text-brand-500 dark:text-brand-200">{selectedEvent.job.scheduleNotes?.trim() || selectedEvent.job.notes?.trim() || 'No schedule notes.'}</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Crew & Division</p>
                <p className="mt-2 text-brand-700 dark:text-brand-100">{selectedEvent.crew?.name ?? 'No primary crew'} · {selectedEvent.division?.name ?? 'No division'}</p>
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
                      const crewName = conflict.conflictingCrewId
                        ? crews.find((crew) => crew.id === conflict.conflictingCrewId)?.name ?? conflict.conflictingCrewId
                        : '';

                      return (
                        <div key={`selected-conflict-${conflict.job.id}`} className="rounded-2xl border border-accent-200 bg-accent-50/80 p-3 text-sm text-accent-900">
                          <p className="font-medium">{conflict.job.title}</p>
                          <p className="mt-1 text-xs text-accent-700">{formatConflictWindow(conflict.schedule.start, conflict.schedule.end, conflict.schedule.allDay)}</p>
                          {crewName ? <p className="mt-1 text-xs">Crew: {crewName}</p> : null}
                          {employeeNames ? <p className="mt-1 text-xs">Employees: {employeeNames}</p> : null}
                          {equipmentNames ? <p className="mt-1 text-xs">Equipment: {equipmentNames}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {getJobTimeOffConflicts(selectedEvent.job, approvedTimeOff, crews).length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={16} /> {getJobTimeOffConflicts(selectedEvent.job, approvedTimeOff, crews).length} employee unavailable</p>
                  {getJobTimeOffConflicts(selectedEvent.job, approvedTimeOff, crews).map((conflict) => <p key={conflict.requestId} className="mt-1 text-xs">{conflict.employeeName} has approved {formatTimeOffType(conflict.requestType)} during this scheduled assignment.</p>)}
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

      {selectedTimeOff ? (
        <div className="fixed inset-0 z-40">
          <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setSelectedTimeOffId(null)} aria-label="Close time off details" />
          <div className="absolute right-0 top-0 h-full w-full max-w-md border-l border-brand-100 bg-white p-5 shadow-2xl dark:border-brand-600 dark:bg-brand-700">
            <div className="flex items-start justify-between gap-3"><div><Badge label="Approved" className="bg-rose-100 text-rose-700" /><h2 className="mt-3 text-xl font-semibold text-brand-900 dark:text-brand-50">{selectedTimeOff.employeeName}</h2><p className="mt-1 text-sm text-brand-500 dark:text-brand-200">Approved Time Off</p></div><button type="button" onClick={() => setSelectedTimeOffId(null)} className="h-9 w-9 rounded-xl text-brand-400 hover:bg-brand-50">&times;</button></div>
            <dl className="mt-6 space-y-4 text-sm"><div><dt className="text-xs font-semibold uppercase text-brand-400">Request Type</dt><dd className="mt-1 font-medium text-brand-900 dark:text-brand-50">{formatTimeOffType(selectedTimeOff.requestType)}</dd></div><div><dt className="text-xs font-semibold uppercase text-brand-400">Dates</dt><dd className="mt-1 font-medium text-brand-900 dark:text-brand-50">{selectedTimeOff.startDate === selectedTimeOff.endDate ? selectedTimeOff.startDate : `${selectedTimeOff.startDate} - ${selectedTimeOff.endDate}`}</dd></div><div><dt className="text-xs font-semibold uppercase text-brand-400">Status</dt><dd className="mt-1 font-medium text-brand-900 dark:text-brand-50">Approved</dd></div></dl>
            <div className="mt-6 flex gap-2"><Button variant="secondary" onClick={() => navigate(`/employees/${selectedTimeOff.employeeId}?tab=time-off`)}>View Employee</Button>{currentUserRole === 'owner' || currentUserRole === 'admin' ? <Button onClick={() => navigate('/time-off')}>View Requests</Button> : null}</div>
          </div>
        </div>
      ) : null}

      <Modal open={Boolean(pendingTimeOffOverride)} onClose={() => pendingTimeOffOverride?.cancel()} title={`${pendingTimeOffOverride?.conflicts.length ?? 0} ${(pendingTimeOffOverride?.conflicts.length ?? 0) === 1 ? 'employee is' : 'employees are'} unavailable`} footer={<><Button variant="secondary" onClick={() => pendingTimeOffOverride?.cancel()}>Go Back</Button><Button onClick={() => pendingTimeOffOverride?.proceed()}>Schedule Anyway</Button></>}>
        <p className="text-sm text-brand-500">Approved Time Off overlaps the proposed schedule change.</p>
        <div className="mt-3 space-y-2">{pendingTimeOffOverride?.conflicts.map((conflict) => <div key={conflict.requestId} className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><p className="font-semibold">{conflict.employeeName}</p><p className="mt-1 text-xs">{formatTimeOffType(conflict.requestType)} · {conflict.startDate === conflict.endDate ? conflict.startDate : `${conflict.startDate} - ${conflict.endDate}`}</p></div>)}</div>
      </Modal>

    </div>
  );
}
