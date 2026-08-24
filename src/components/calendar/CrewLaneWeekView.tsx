import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import type { Crew } from '../../types';
import type { NormalizedScheduleEntry, PackedWeeklyScheduleSpan } from '../../utils/scheduleModel.js';
import { buildWeeklyScheduleSpans, packWeeklyScheduleSpans, resolveScheduleColour } from '../../utils/scheduleModel.js';
import type { CalendarColourBy } from '../../types';

type Lane = {
  id: string;
  label: string;
  entries: NormalizedScheduleEntry[];
  external?: boolean;
};

const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');
const columnTemplate = 'minmax(7.5rem, 9rem) repeat(5, minmax(7.5rem, 1fr)) repeat(2, minmax(5.25rem, 0.7fr))';

function laneSpans(entries: NormalizedScheduleEntry[], days: Date[]) {
  return packWeeklyScheduleSpans(buildWeeklyScheduleSpans(entries, days.map(dayKey)));
}

function ScheduleBar({ span, colourBy, selected, hasConflict, canManage, onSelect }: {
  span: PackedWeeklyScheduleSpan;
  colourBy: CalendarColourBy;
  selected: boolean;
  hasConflict: boolean;
  canManage: boolean;
  onSelect: (entry: NormalizedScheduleEntry) => void;
}) {
  const { entry } = span;
  const colour = entry.source === 'time_off'
    ? resolveScheduleColour({ source: 'time_off', colourBy, job: { status: entry.status }, crew: entry.crew, division: entry.division })
    : resolveScheduleColour({ source: entry.source === 'external' ? entry.provider : 'oliveops', colourBy, job: { status: entry.status }, crew: entry.crew, division: entry.division });
  const detail = [entry.crew?.name ?? (entry.source === 'oliveops' ? 'Unassigned crew' : ''), entry.summary, span.columnSpan > 2 ? entry.division?.name : ''].filter(Boolean).join(' · ');
  const time = entry.allDay ? '' : entry.timeLabel;

  return (
    <button
      type="button"
      draggable={canManage && entry.source === 'oliveops'}
      onDragStart={(event) => {
        if (!entry.jobId) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-oliveops-job', JSON.stringify({ jobId: entry.jobId, startKey: entry.startKey }));
      }}
      onClick={() => onSelect(entry)}
      className={`relative z-10 min-w-0 overflow-hidden rounded-md border-l-[3px] px-2 py-1.5 text-left shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${selected ? 'ring-2 ring-brand-400' : ''}`}
      style={{
        gridColumn: `${span.startColumn} / ${span.endColumn + 1}`,
        gridRow: span.row + 1,
        backgroundColor: colour.tint,
        borderColor: colour.value,
        color: colour.value,
      }}
      title={[entry.title, detail, time].filter(Boolean).join('\n')}
    >
      <span className="flex min-w-0 items-center gap-1">
        {entry.source !== 'oliveops' ? <CalendarDays size={12} className="shrink-0" /> : null}
        <span className="truncate text-xs font-semibold">{entry.title}</span>
        {hasConflict ? <AlertTriangle size={12} className="ml-auto shrink-0 text-amber-700" aria-label="Scheduling conflict" /> : null}
      </span>
      {span.columnSpan > 1 && detail ? <span className="block truncate text-[10px] opacity-85">{detail}</span> : null}
      {time ? <span className="block truncate text-[10px] font-medium opacity-80">{time}</span> : null}
    </button>
  );
}

export default function CrewLaneWeekView({ days, entries, activeCrews, colourBy, selectedJobId, conflictJobIds, canManage, onSelect, onShiftJob }: {
  days: Date[];
  entries: NormalizedScheduleEntry[];
  activeCrews: Crew[];
  colourBy: CalendarColourBy;
  selectedJobId: string | null;
  conflictJobIds: Set<string>;
  canManage: boolean;
  onSelect: (entry: NormalizedScheduleEntry) => void;
  onShiftJob: (jobId: string, dayDelta: number) => void;
}) {
  const oliveOpsEntries = entries.filter((entry) => entry.source === 'oliveops');
  const externalEntries = entries.filter((entry) => entry.source === 'external');
  const timeOffEntries = entries.filter((entry) => entry.source === 'time_off');
  const usedCrewIds = new Set(oliveOpsEntries.map((entry) => entry.crew?.id).filter(Boolean));
  const crewsById = new Map(activeCrews.map((crew) => [crew.id, crew]));
  oliveOpsEntries.forEach((entry) => {
    if (entry.crew) crewsById.set(entry.crew.id, entry.crew);
  });
  const lanes: Lane[] = [...crewsById.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((crew) => ({ id: `crew:${crew.id}`, label: crew.name, entries: oliveOpsEntries.filter((entry) => entry.crew?.id === crew.id) }))
    .filter((lane) => activeCrews.some((crew) => `crew:${crew.id}` === lane.id) || usedCrewIds.has(lane.id.slice(5)));
  const unassigned = oliveOpsEntries.filter((entry) => !entry.crew);
  if (unassigned.length > 0) lanes.push({ id: 'unassigned', label: 'Unassigned', entries: unassigned });
  if (timeOffEntries.length > 0) lanes.unshift({ id: 'time-off', label: 'Time Off', entries: timeOffEntries, external: true });
  if (externalEntries.length > 0) lanes.push({ id: 'external', label: 'External / Google', entries: externalEntries, external: true });
  const todayKey = dayKey(new Date());

  if (lanes.length === 0) {
    return <div className="rounded-lg border border-dashed border-brand-200 px-4 py-10 text-center text-sm text-brand-500 dark:border-brand-600 dark:text-brand-200">No work matches the current filters.</div>;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-[860px]">
        <div className="grid border-b border-brand-100 dark:border-brand-600" style={{ gridTemplateColumns: columnTemplate }}>
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Crew</div>
          {days.map((day, index) => {
            const isToday = dayKey(day) === todayKey;
            const weekend = index > 4;
            return <div key={dayKey(day)} className={`border-l border-brand-100 px-2 py-2 text-center dark:border-brand-600 ${weekend ? 'bg-brand-50/70 dark:bg-brand-800/50' : ''} ${isToday ? 'bg-accent-50 ring-1 ring-inset ring-accent-300 dark:bg-accent-900/20' : ''}`}><p className="text-[11px] font-semibold uppercase text-brand-500 dark:text-brand-200">{format(day, 'EEE')}</p><p className={`text-sm font-semibold ${isToday ? 'text-accent-700 dark:text-accent-100' : 'text-brand-900 dark:text-brand-50'}`}>{format(day, 'MMM d')}</p></div>;
          })}
        </div>
        {lanes.map((lane) => {
          const spans = laneSpans(lane.entries, days);
          const rowCount = Math.max(1, ...spans.map((span) => span.row + 1));
          return (
            <div key={lane.id} className="grid border-b border-brand-100 last:border-b-0 dark:border-brand-600" style={{ gridTemplateColumns: columnTemplate }}>
              <div className={`flex min-h-14 items-start border-r border-brand-100 px-3 py-3 dark:border-brand-600 ${lane.external ? 'bg-brand-50/70 dark:bg-brand-800/50' : ''}`}><span className="truncate text-sm font-semibold text-brand-800 dark:text-brand-50">{lane.label}</span></div>
              <div className="relative col-span-7 grid gap-1 p-1.5" style={{ gridTemplateColumns: 'repeat(5, minmax(7.5rem, 1fr)) repeat(2, minmax(5.25rem, 0.7fr))', gridTemplateRows: `repeat(${rowCount}, minmax(2.75rem, auto))` }}>
                {days.map((day, index) => {
                  const isToday = dayKey(day) === todayKey;
                  return <div key={dayKey(day)} className={`relative border-l border-brand-100 first:border-l-0 dark:border-brand-600 ${index > 4 ? 'bg-brand-50/60 dark:bg-brand-800/40' : ''} ${isToday ? 'bg-accent-50/70 dark:bg-accent-900/10' : ''}`} style={{ gridColumn: index + 1, gridRow: `1 / span ${rowCount}` }} onDragOver={(event) => { if (canManage) event.preventDefault(); }} onDrop={(event) => { const raw = event.dataTransfer.getData('application/x-oliveops-job'); if (!raw) return; const payload = JSON.parse(raw) as { jobId: string; startKey: string }; onShiftJob(payload.jobId, differenceInCalendarDays(day, parseISO(payload.startKey))); }} />;
                })}
                {spans.map((span) => <ScheduleBar key={`${span.entry.source}:${span.entry.jobId ?? span.entry.externalEventId ?? span.entry.timeOffRequestId}`} span={span} colourBy={colourBy} selected={span.entry.jobId === selectedJobId} hasConflict={Boolean(span.entry.jobId && conflictJobIds.has(span.entry.jobId))} canManage={canManage} onSelect={onSelect} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}