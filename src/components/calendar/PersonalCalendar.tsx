import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { addDays } from 'date-fns';
import type { Customer, ExternalCalendarEvent, Job, Task, CalendarView } from '../../types';
import { getJobScheduleWindow } from '../../utils/jobSchedule';
import { CalendarToolbar, ScheduleEventCard } from './CalendarControls';
import { resolveScheduleColour } from '../../utils/scheduleModel.js';

const VIEW_MAP: Record<CalendarView, 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
};

type SelectedItem =
  | { kind: 'job'; job: Job }
  | { kind: 'task'; task: Task }
  | { kind: 'external'; event: ExternalCalendarEvent };

export default function PersonalCalendar({ jobs, tasks, customers, externalEvents = [], selectedDate, onDateChange, onRangeChange, onOpenJob, onSelectTask }: {
  jobs: Job[];
  tasks: Task[];
  customers: Customer[];
  externalEvents?: ExternalCalendarEvent[];
  selectedDate?: Date;
  onDateChange?: (date: Date) => void;
  onRangeChange?: (range: { start: Date; end: Date }) => void;
  onOpenJob?: (jobId: string) => void;
  onSelectTask?: (taskId: string) => void;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [view, setView] = useState<CalendarView>('week');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<SelectedItem | null>(null);

  useEffect(() => {
    if (!selectedDate) return;
    const api = calendarRef.current?.getApi();
    if (!api) return;
    const current = api.getDate();
    if (current.toDateString() !== selectedDate.toDateString()) api.gotoDate(selectedDate);
  }, [selectedDate]);

  const calendarEvents = useMemo(() => {
    const jobEvents = jobs.flatMap((job) => {
      const schedule = getJobScheduleWindow(job);
      if (!schedule || job.status === 'cancelled') return [];
      const customer = customers.find((item) => item.id === job.customerId);
      return [{
        id: `job:${job.id}`,
        title: job.title,
        start: schedule.start,
        end: schedule.allDay ? addDays(schedule.end, 1) : schedule.end,
        allDay: schedule.allDay,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        extendedProps: { kind: 'job' as const, job, summary: customer?.name ?? 'OliveOps job' },
      }];
    });
    const taskEvents = tasks.filter((task) => task.dueDate && task.status === 'open').map((task) => ({
      id: `task:${task.id}`,
      title: task.title,
      start: task.dueDate,
      allDay: true,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      extendedProps: { kind: 'task' as const, task },
    }));
    const providerEvents = externalEvents.map((event) => ({
      id: `external:${event.provider}:${event.externalCalendarId}:${event.externalEventId}`,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      extendedProps: { kind: 'external' as const, event },
    }));
    return [...jobEvents, ...taskEvents, ...providerEvents];
  }, [customers, externalEvents, jobs, tasks]);

  const navigate = (action: 'today' | 'prev' | 'next') => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    api[action]();
  };

  const changeView = (nextView: CalendarView) => {
    setView(nextView);
    calendarRef.current?.getApi().changeView(VIEW_MAP[nextView]);
  };

  return (
    <>
      <div className="border-b border-brand-100 px-4 py-4 dark:border-brand-600">
        <CalendarToolbar title={title} view={view} onNavigate={navigate} onViewChange={changeView} />
      </div>
      <div className="p-3 sm:p-4">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin] as any}
          initialView="timeGridWeek"
          headerToolbar={false}
          events={calendarEvents}
          height={520}
          contentHeight={455}
          nowIndicator
          allDaySlot
          weekends
          dayMaxEvents={3}
          slotMinTime="06:00:00"
          slotMaxTime="18:00:00"
          scrollTime="07:00:00"
          datesSet={(arg) => {
            setTitle(arg.view.title);
            onRangeChange?.({ start: arg.start, end: arg.end });
            onDateChange?.(arg.view.calendar.getDate());
          }}
          eventContent={(content) => {
            const props = content.event.extendedProps as any;
            if (props.kind === 'external') {
              const event = props.event as ExternalCalendarEvent;
              return <ScheduleEventCard title={content.event.title} summary={event.location || 'Personal event'} detail={event.sourceLabel} colour={resolveScheduleColour({ source: event.provider, colourBy: 'status' })} compact={content.view.type === 'dayGridMonth'} source={event.provider} />;
            }
            if (props.kind === 'task') {
              return <ScheduleEventCard title={content.event.title} summary="My task" detail="Due" colour={{ value: '#7c3aed', tint: '#f3e8ff' }} compact={content.view.type === 'dayGridMonth'} />;
            }
            return <ScheduleEventCard title={content.event.title} summary={props.summary} detail="Assigned work" colour={resolveScheduleColour({ colourBy: 'status', job: props.job })} compact={content.view.type === 'dayGridMonth'} />;
          }}
          eventClick={(click) => {
            const props = click.event.extendedProps as any;
            if (props.kind === 'job') setSelected({ kind: 'job', job: props.job });
            if (props.kind === 'task') {
              setSelected({ kind: 'task', task: props.task });
              onSelectTask?.(props.task.id);
            }
            if (props.kind === 'external') setSelected({ kind: 'external', event: props.event });
          }}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-brand-100 px-4 py-3 text-xs text-brand-600 dark:border-brand-600 dark:text-brand-200" aria-label="My Calendar legend">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" />Assigned work</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-600" />Tasks</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Google</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-600" />Outlook</span>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-40">
          <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} aria-label="Close calendar details" />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-brand-100 bg-white p-5 shadow-2xl dark:border-brand-600 dark:bg-brand-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-brand-500">{selected.kind === 'external' ? selected.event.sourceLabel : selected.kind === 'task' ? 'My task' : 'Assigned job'}</p>
                <h2 className="mt-2 text-xl font-semibold text-brand-900 dark:text-brand-50">{selected.kind === 'external' ? selected.event.title : selected.kind === 'task' ? selected.task.title : selected.job.title}</h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="h-9 w-9 text-brand-500" aria-label="Close">&times;</button>
            </div>
            <div className="mt-5 text-sm text-brand-700 dark:text-brand-100">
              {selected.kind === 'external' ? <p>{selected.event.location || 'No location provided.'}</p> : null}
              {selected.kind === 'task' ? <p>{selected.task.description || `Due ${selected.task.dueDate}`}</p> : null}
              {selected.kind === 'job' ? <p>{selected.job.scheduleNotes || selected.job.notes || 'No schedule notes.'}</p> : null}
            </div>
            {selected.kind === 'job' && onOpenJob ? <button type="button" className="mt-6 text-sm font-semibold text-brand-700 hover:underline" onClick={() => onOpenJob(selected.job.id)}>Open job</button> : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
