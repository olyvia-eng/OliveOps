import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import type { CalendarColourBy } from '../../types';
import type { NormalizedScheduleEntry } from '../../utils/scheduleModel.js';
import { buildWeeklyScheduleSpans, resolveScheduleColour } from '../../utils/scheduleModel.js';

const dateKey = (date: Date) => format(date, 'yyyy-MM-dd');

export default function WeeklyScheduleSummary({ days, entries, colourBy = 'crew', onSelect }: {
  days: Date[];
  entries: NormalizedScheduleEntry[];
  colourBy?: CalendarColourBy;
  onSelect: (entry: NormalizedScheduleEntry) => void;
}) {
  const fullWeekSpans = buildWeeklyScheduleSpans(entries, days.map(dateKey));
  const showWeekend = fullWeekSpans.some((span) => span.endColumn > 5);
  const visibleDays = showWeekend ? days : days.slice(0, 5);
  const spans = buildWeeklyScheduleSpans(entries, visibleDays.map(dateKey));
  const todayKey = dateKey(new Date());
  const dayColumns = visibleDays.length;
  const gridTemplate = `minmax(8.5rem, 11rem) repeat(${dayColumns}, minmax(5.5rem, 1fr))`;

  if (spans.length === 0) return null;

  return (
    <div className="overflow-x-auto pb-1">
      <div className={showWeekend ? 'min-w-[790px]' : 'min-w-[620px]'}>
        <div className="grid border-b border-brand-100 dark:border-brand-600" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Work</div>
          {visibleDays.map((day, index) => {
            const isToday = dateKey(day) === todayKey;
            return <div key={dateKey(day)} className={`border-l border-brand-100 px-2 py-2 text-center dark:border-brand-600 ${index > 4 ? 'bg-brand-50/70 dark:bg-brand-800/50' : ''} ${isToday ? 'bg-accent-50 ring-1 ring-inset ring-accent-300 dark:bg-accent-900/20' : ''}`}><p className="text-[10px] font-semibold uppercase text-brand-500 dark:text-brand-200">{format(day, 'EEE')}</p><p className={`text-xs font-semibold ${isToday ? 'text-accent-700 dark:text-accent-100' : 'text-brand-900 dark:text-brand-50'}`}>{format(day, 'MMM d')}</p></div>;
          })}
        </div>
        <div className="divide-y divide-brand-100 dark:divide-brand-600">
          {spans.map((span) => {
            const { entry } = span;
            const colour = resolveScheduleColour({ source: entry.source === 'external' ? entry.provider : 'oliveops', colourBy, job: { status: entry.status }, crew: entry.crew, division: entry.division });
            const time = entry.allDay ? '' : entry.timeLabel;
            return (
              <div key={`${entry.source}:${entry.jobId ?? entry.externalEventId}`} className="grid min-h-14" style={{ gridTemplateColumns: gridTemplate }}>
                <button type="button" onClick={() => onSelect(entry)} className="min-w-0 px-3 py-2 text-left hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-brand-600">
                  <span className="flex items-center gap-1 truncate text-xs font-semibold text-brand-900 dark:text-brand-50">{entry.source === 'external' ? <CalendarDays size={12} className="shrink-0" /> : null}{entry.title}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-brand-500 dark:text-brand-200">{entry.source === 'external' ? entry.externalEvent?.sourceLabel : entry.crew?.name ?? 'Unassigned crew'}</span>
                </button>
                <div className="col-span-full col-start-2 row-start-1 grid gap-1 p-1.5" style={{ gridTemplateColumns: `repeat(${dayColumns}, minmax(5.5rem, 1fr))` }}>
                  {visibleDays.map((day, index) => <div key={dateKey(day)} className={`border-l border-brand-100 first:border-l-0 dark:border-brand-600 ${index > 4 ? 'bg-brand-50/60 dark:bg-brand-800/40' : ''} ${dateKey(day) === todayKey ? 'bg-accent-50/60 dark:bg-accent-900/10' : ''}`} style={{ gridColumn: index + 1, gridRow: 1 }} />)}
                  <button type="button" onClick={() => onSelect(entry)} className="z-10 min-w-0 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left shadow-sm hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" style={{ gridColumn: `${span.startColumn} / ${span.endColumn + 1}`, gridRow: 1, backgroundColor: colour.tint, borderColor: colour.value, color: colour.value }} title={[entry.title, entry.summary, time].filter(Boolean).join('\n')}>
                    <span className="block truncate text-[11px] font-semibold">{span.columnSpan > 1 ? entry.title : entry.summary || entry.title}</span>
                    {time ? <span className="block truncate text-[10px] font-medium opacity-80">{time}</span> : null}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}