import { format, formatDistanceToNow } from 'date-fns';
import { CalendarClock, CalendarDays, CheckSquare, Clock3, ExternalLink, Plus, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';
import type { HomeActivityItem, HomeUpcomingItem } from './homeDashboardModel.js';
import MiniMonthCalendar from './MiniMonthCalendar';

interface PersonalDashboardSidebarProps {
  selectedDate: Date;
  upcoming: HomeUpcomingItem[];
  activity: HomeActivityItem[];
  showTimeClock: boolean;
  onSelectDate: (date: Date) => void;
  onOpenJob: (jobId: string) => void;
  onOpenTask: () => void;
  onAddTask: () => void;
  onOpenSchedule: () => void;
  onOpenTimeClock?: () => void;
}

const sourceTone = (item: HomeUpcomingItem) => item.kind === 'external' ? (item.provider === 'google' ? 'bg-blue-500' : 'bg-sky-500') : item.kind === 'task' ? 'bg-violet-500' : 'bg-brand-600';

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="rounded-lg p-4"><h2 className="mb-3 text-sm font-semibold text-brand-900 dark:text-brand-50">{title}</h2>{children}</Card>;
}

export default function PersonalDashboardSidebar({ selectedDate, upcoming, activity, showTimeClock, onSelectDate, onOpenJob, onOpenTask, onAddTask, onOpenSchedule, onOpenTimeClock }: PersonalDashboardSidebarProps) {
  return (
    <aside className="space-y-4">
      <Card className="rounded-lg p-4"><MiniMonthCalendar selectedDate={selectedDate} onSelect={onSelectDate} /></Card>

      <SidebarSection title="Upcoming Schedule">
        {upcoming.length === 0 ? <p className="text-sm text-brand-400 dark:text-brand-300">No upcoming items in this calendar range.</p> : (
          <ol className="space-y-3">
            {upcoming.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => item.jobId ? onOpenJob(item.jobId) : item.taskId ? onOpenTask() : undefined} className={`flex w-full items-start gap-3 text-left ${item.kind === 'external' ? 'cursor-default' : 'group'}`}>
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${sourceTone(item)}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-brand-900 group-hover:text-brand-600 dark:text-brand-50">{item.title}</span>
                    <span className="mt-0.5 block text-xs text-brand-400 dark:text-brand-300">{item.allDay ? format(new Date(item.start), 'EEE, MMM d') : format(new Date(item.start), 'EEE, MMM d · h:mm a')}</span>
                    {item.location ? <span className="mt-0.5 block truncate text-xs text-brand-400 dark:text-brand-300">{item.location}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </SidebarSection>

      <SidebarSection title="Recent Activity">
        {activity.length === 0 ? <p className="text-sm text-brand-400 dark:text-brand-300">No recent personal activity.</p> : (
          <ol className="space-y-3">
            {activity.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <span className="mt-0.5 text-brand-400">{item.kind === 'time' ? <Clock3 size={15} /> : item.kind === 'task' ? <CheckSquare size={15} /> : <CalendarClock size={15} />}</span>
                <span className="min-w-0"><span className="block text-sm text-brand-800 dark:text-brand-100">{item.title}</span><span className="mt-0.5 block text-xs text-brand-400 dark:text-brand-300">{formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}</span></span>
              </li>
            ))}
          </ol>
        )}
      </SidebarSection>

      <SidebarSection title="Quick Actions">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onAddTask} className="flex min-h-20 flex-col items-start justify-between rounded-md border border-brand-100 p-3 text-left text-sm font-semibold text-brand-800 hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-100 dark:hover:bg-brand-600"><Plus size={17} />New task</button>
          <button type="button" onClick={onOpenSchedule} className="flex min-h-20 flex-col items-start justify-between rounded-md border border-brand-100 p-3 text-left text-sm font-semibold text-brand-800 hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-100 dark:hover:bg-brand-600"><CalendarDays size={17} />Schedule</button>
          {showTimeClock && onOpenTimeClock ? <button type="button" onClick={onOpenTimeClock} className="flex min-h-20 flex-col items-start justify-between rounded-md border border-brand-100 p-3 text-left text-sm font-semibold text-brand-800 hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-100 dark:hover:bg-brand-600"><Clock3 size={17} />Time clock</button> : null}
          <Link to="/settings/personal-calendar" className="flex min-h-20 flex-col items-start justify-between rounded-md border border-brand-100 p-3 text-left text-sm font-semibold text-brand-800 hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-100 dark:hover:bg-brand-600"><Settings2 size={17} />Connections <ExternalLink size={12} className="self-end text-brand-400" /></Link>
        </div>
      </SidebarSection>
    </aside>
  );
}
