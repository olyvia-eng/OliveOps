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
import { Plus } from 'lucide-react';
import { useStore } from '../../store';
import { Badge, Button, Card, PageHeader } from '../../components/ui';
import type { CalendarColourBy, CalendarPreferences, CalendarView, GoogleCalendarEvent } from '../../types';
import ScheduleJobModal from '../../components/calendar/ScheduleJobModal';
import { CalendarFilters, CalendarLegend, CalendarToolbar, ColourBySelector, ScheduleEventCard } from '../../components/calendar/CalendarControls';
import { formatDate, statusColor } from '../../utils';
import { DEFAULT_CALENDAR_PREFERENCES, filterScheduleEntries, getEffectiveDivision, getScheduleLegend, normalizeCalendarPreferences, resolveScheduleColour } from '../../utils/scheduleModel.js';
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
  source: 'oliveops';
  summary: string;
  timeLabel: string;
  status: string;
  employeeCount: number;
  equipmentCount: number;
  crewName: string;
  colour: { value: string; tint: string };
} | {
  source: 'google';
  googleEvent: GoogleCalendarEvent;
};

const CALENDAR_VIEW_MAP: Record<CalendarView, 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
};

const canManageScheduleRole = (role: string) => role === 'owner' || role === 'admin' || role === 'foreman';

export default function CalendarPage({ currentUserRole }: Props) {
  const navigate = useNavigate();
  const { jobs, customers, employees, budgets, crews, divisions, equipmentAssets, updateJob } = useStore();
  const calendarRef = useRef<any>(null);
  const [preferences, setPreferences] = useState<CalendarPreferences>(DEFAULT_CALENDAR_PREFERENCES);
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [equipmentFilter, setEquipmentFilter] = useState('all');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleJobId, setScheduleJobId] = useState<string | undefined>(undefined);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<GoogleCalendarEvent | null>(null);
  const [visibleRange, setVisibleRange] = useState(() => ({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date()),
    title: format(new Date(), 'MMMM yyyy'),
  }));
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

  const normalizedEntries = useMemo(() => allScheduledJobs.map((entry) => ({
    source: 'oliveops' as const,
    jobId: entry.job.id,
    status: entry.job.status,
    startKey: entry.schedule.startKey,
    endKey: entry.schedule.endKey,
    crew: entry.crew,
    division: entry.division,
    employeeIds: entry.job.assignedEmployeeIds ?? [],
    equipmentIds: entry.job.assignedEquipmentIds ?? [],
  })), [allScheduledJobs]);

  const filteredEntries = useMemo(() => filterScheduleEntries(normalizedEntries, {
    divisionId: divisionFilter,
    resourceId: resourceFilter,
    jobId: jobFilter,
    equipmentId: equipmentFilter,
    showGoogleEvents: preferences.showGoogleEvents,
  }), [divisionFilter, equipmentFilter, jobFilter, normalizedEntries, preferences.showGoogleEvents, resourceFilter]);

  const scheduledJobs = useMemo(() => {
    const visibleJobIds = new Set(filteredEntries.map((entry) => entry.jobId));
    return allScheduledJobs.filter((entry) => visibleJobIds.has(entry.job.id));
  }, [allScheduledJobs, filteredEntries]);

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
        timeLabel: entry.timeLabel,
        status: entry.job.status,
        employeeCount: entry.assignedEmployees.length,
        equipmentCount: entry.assignedEquipment.length,
        crewName: entry.crew?.name ?? 'Unassigned crew',
        colour: resolveScheduleColour({ colourBy: preferences.colourBy, job: entry.job, crew: entry.crew, division: entry.division }),
      } satisfies CalendarEventExtendedProps,
    }));
    const externalEvents = (preferences.showGoogleEvents ? googleEvents : []).map((event) => ({
      id: `google:${event.googleCalendarId}:${event.googleEventId}`,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      editable: false,
      startEditable: false,
      durationEditable: false,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: 'inherit',
      extendedProps: {
        source: 'google' as const,
        googleEvent: event,
      } satisfies CalendarEventExtendedProps,
    }));
    return [...oliveOpsEvents, ...externalEvents];
  }, [googleEvents, preferences.colourBy, preferences.showGoogleEvents, scheduledJobs]);

  const currentRangeHasEvents = useMemo(() => {
    const hasJobs = scheduledJobs.some((entry) => entry.schedule.start < visibleRange.end && entry.schedule.end >= visibleRange.start);
    const hasGoogleEvents = preferences.showGoogleEvents && googleEvents.some((event) => new Date(event.start) < visibleRange.end && new Date(event.end) >= visibleRange.start);
    return hasJobs || hasGoogleEvents;
  }, [googleEvents, preferences.showGoogleEvents, scheduledJobs, visibleRange.end, visibleRange.start]);

  const selectedEvent = useMemo(() => {
    return scheduledJobs.find((entry) => entry.job.id === selectedJobId) ?? null;
  }, [scheduledJobs, selectedJobId]);

  const selectedEventConflicts = useMemo(() => {
    if (!selectedEvent) return [];

    return getJobAssignmentConflicts({
      jobId: selectedEvent.job.id,
      jobs,
      scheduleWindow: selectedEvent.schedule,
      crewId: selectedEvent.job.crewId,
      assignedEmployeeIds: selectedEvent.job.assignedEmployeeIds ?? [],
      assignedEquipmentIds: selectedEvent.job.assignedEquipmentIds ?? [],
    });
  }, [jobs, selectedEvent]);

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
        calendarRef.current?.getApi().changeView(CALENDAR_VIEW_MAP[next.view]);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setPreferences(DEFAULT_CALENDAR_PREFERENCES);
      }
    };
    void loadPreferences();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedJobId && !scheduledJobs.some((entry) => entry.job.id === selectedJobId)) {
      setSelectedJobId(null);
    }
  }, [scheduledJobs, selectedJobId]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: visibleRange.start.toISOString(),
      to: visibleRange.end.toISOString(),
    });
    const loadGoogleEvents = async () => {
      try {
        const response = await fetch(`/api/integrations/google/events?${params}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        const payload = await response.json() as { ok?: boolean; events?: GoogleCalendarEvent[] };
        if (response.ok && payload.ok && Array.isArray(payload.events)) setGoogleEvents(payload.events);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setGoogleEvents([]);
      }
    };
    void loadGoogleEvents();
    return () => controller.abort();
  }, [visibleRange.end, visibleRange.start]);

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
    updatePreferences({ view });
    calendarRef.current?.getApi().changeView(CALENDAR_VIEW_MAP[view]);
  };

  const handleEventDrop = async (eventDrop: any) => {
    if (eventDrop.event.extendedProps?.source === 'google') {
      eventDrop.revert();
      return;
    }
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
    if (props.source === 'google') {
      return (
        <ScheduleEventCard title={content.event.title} summary="External event" detail="Google Calendar" colour={resolveScheduleColour({ source: 'google', colourBy: preferences.colourBy })} compact={content.view.type === 'dayGridMonth'} source="google" />
      );
    }
    const selected = content.event.id === selectedJobId;
    const compact = content.view.type === 'dayGridMonth';

    return <ScheduleEventCard title={content.event.title} summary={`${props.crewName} · ${props.summary}`} detail={`${props.timeLabel}${props.employeeCount > 0 ? ` · ${props.employeeCount} people` : ''}${props.equipmentCount > 0 ? ` · ${props.equipmentCount} equip` : ''}`} colour={props.colour} compact={compact} selected={selected} />;
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
    crewId?: string;
    divisionId?: string;
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
          <CalendarToolbar title={visibleRange.title} view={preferences.view} onNavigate={handleCalendarNavigation} onViewChange={handleViewChange} />
          <CalendarFilters divisions={divisionOptions} crews={crews.filter((crew) => crew.active)} employees={employees} jobs={jobs} equipment={equipmentAssets} divisionId={divisionFilter} resourceId={resourceFilter} jobId={jobFilter} equipmentId={equipmentFilter} showGoogleEvents={preferences.showGoogleEvents} onDivisionChange={setDivisionFilter} onResourceChange={setResourceFilter} onJobChange={setJobFilter} onEquipmentChange={setEquipmentFilter} onGoogleChange={(showGoogleEvents) => updatePreferences({ showGoogleEvents })} />
          <div className="mt-4 flex flex-col gap-3 border-t border-brand-100 pt-3 dark:border-brand-600 lg:flex-row lg:items-center lg:justify-between">
            <ColourBySelector value={preferences.colourBy} onChange={(colourBy: CalendarColourBy) => updatePreferences({ colourBy })} />
            <CalendarLegend items={legendItems} showGoogleEvents={preferences.showGoogleEvents} />
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

          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin] as any}
            initialView={CALENDAR_VIEW_MAP[preferences.view]}
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
            eventClick={(eventClick) => {
              const props = eventClick.event.extendedProps as CalendarEventExtendedProps;
              if (props.source === 'google') {
                setSelectedJobId(null);
                setSelectedGoogleEvent(props.googleEvent);
                return;
              }
              setSelectedGoogleEvent(null);
              setSelectedJobId(eventClick.event.id);
            }}
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
        crews={crews}
        divisions={divisions}
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
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate(`/jobs/${selectedEvent.job.id}`)}>Open Job</Button>
              {canManageSchedule ? <Button onClick={() => { setScheduleJobId(selectedEvent.job.id); setScheduleOpen(true); }}>Edit Schedule</Button> : null}
            </div>
          </div>
        </div>
      ) : null}

      {selectedGoogleEvent ? (
        <div className="fixed inset-0 z-40">
          <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setSelectedGoogleEvent(null)} aria-label="Close Google event details" />
          <div className="absolute right-0 top-0 h-full w-full max-w-md border-l border-brand-100 bg-white p-5 shadow-2xl dark:border-brand-600 dark:bg-brand-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge label="Google Calendar" className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100" />
                <h2 className="mt-3 text-xl font-semibold text-brand-900 dark:text-brand-50">{selectedGoogleEvent.title}</h2>
              </div>
              <button type="button" onClick={() => setSelectedGoogleEvent(null)} className="h-9 w-9 rounded-xl text-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:text-brand-200 dark:hover:bg-brand-600 dark:hover:text-brand-50">&times;</button>
            </div>
            <div className="mt-5 space-y-4 text-sm">
              <div className="rounded-lg border border-brand-100 p-4 dark:border-brand-600">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Date and time</p>
                <p className="mt-2 font-medium text-brand-900 dark:text-brand-50">
                  {selectedGoogleEvent.allDay
                    ? `${formatDate(selectedGoogleEvent.start)} · All day`
                    : `${format(new Date(selectedGoogleEvent.start), 'MMM d, yyyy, h:mm a')} - ${format(new Date(selectedGoogleEvent.end), 'h:mm a')}`}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Location</p>
                <p className="mt-2 text-brand-700 dark:text-brand-100">{selectedGoogleEvent.location || 'No location provided.'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Source</p>
                <p className="mt-2 text-brand-700 dark:text-brand-100">Google Calendar · Read-only in OliveOps</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
