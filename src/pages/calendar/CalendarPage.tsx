import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../../store';
import { Button, Card, EmptyState, PageHeader } from '../../components/ui';

export default function CalendarPage() {
  const { jobs } = useStore();
  const [monthCursor, setMonthCursor] = useState(new Date());

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(monthCursor);
    const monthEnd = endOfMonth(monthCursor);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [monthCursor]);

  const jobsByDate = useMemo(() => {
    const map = new Map<string, { id: string; title: string }[]>();

    jobs.forEach((job) => {
      const start = new Date(job.startDate);
      if (Number.isNaN(start.getTime())) return;

      const key = format(start, 'yyyy-MM-dd');
      const existing = map.get(key) ?? [];
      existing.push({ id: job.id, title: job.title });
      map.set(key, existing);
    });

    return map;
  }, [jobs]);

  const currentMonthHasJobs = useMemo(() => {
    return monthDays.some((day) => {
      if (!isSameMonth(day, monthCursor)) return false;
      return (jobsByDate.get(format(day, 'yyyy-MM-dd')) ?? []).length > 0;
    });
  }, [jobsByDate, monthCursor, monthDays]);

  const hasAnyScheduledJobs = jobsByDate.size > 0;

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="View scheduled job start dates in a monthly calendar."
      />

      <Card>
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <button
            onClick={() => setMonthCursor((prev) => subMonths(prev, 1))}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft size={16} /> Prev
          </button>
          <h2 className="text-base font-semibold text-gray-900 inline-flex items-center gap-2">
            <CalendarDays size={18} className="text-brand-600" />
            {format(monthCursor, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => setMonthCursor((prev) => addMonths(prev, 1))}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>

        <div className="p-4">
          {!currentMonthHasJobs ? (
            hasAnyScheduledJobs ? (
              <EmptyState
                icon={<CalendarDays aria-hidden="true" />}
                title="Nothing scheduled for this period"
                description="Try another month to review scheduled work."
              />
            ) : (
              <EmptyState
                icon={<CalendarDays aria-hidden="true" />}
                title="Nothing scheduled yet"
                description="Schedule jobs to start building your calendar."
                action={<Link to="/jobs"><Button>Open Jobs</Button></Link>}
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-7 text-xs text-gray-500 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="px-2 py-1 font-medium">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {monthDays.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayJobs = jobsByDate.get(key) ?? [];

                  return (
                    <div
                      key={key}
                      className={`min-h-28 rounded-lg border p-2 ${
                        isSameMonth(day, monthCursor)
                          ? 'bg-white border-gray-200'
                          : 'bg-gray-50 border-gray-100 text-gray-300'
                      } ${isToday(day) ? 'ring-2 ring-brand-300' : ''}`}
                    >
                      <p className={`text-xs mb-1 ${isToday(day) ? 'font-bold text-brand-700' : 'text-gray-600'}`}>
                        {format(day, 'd')}
                      </p>

                      {dayJobs.slice(0, 3).map((job) => (
                        <Link
                          key={job.id}
                          to={`/jobs/${job.id}`}
                          className="block text-[11px] truncate text-brand-700 bg-brand-50 hover:bg-brand-100 rounded px-1 py-0.5 mb-1"
                          title={job.title}
                        >
                          {job.title}
                        </Link>
                      ))}

                      {dayJobs.length > 3 && (
                        <p className="text-[11px] text-gray-500">+{dayJobs.length - 3} more</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
