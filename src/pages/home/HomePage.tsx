import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format, formatDistanceToNow, startOfWeek } from 'date-fns';
import { Briefcase, CalendarDays, CheckCircle2, Circle, ClipboardList, FileText, Plus, Users } from 'lucide-react';
import DashboardOnboardingCard from '../../components/dashboard/DashboardOnboardingCard';
import { buildDashboardOnboardingItems, calculateDashboardOnboardingProgress } from '../../components/dashboard/onboardingProgress';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { formatCustomerPropertyLabel, formatScheduleTimeLabel, getJobScheduleWindow } from '../../utils/jobSchedule';
import type { GoogleCalendarEvent } from '../../types';
import { getEffectiveDivision, groupScheduleEntriesByDay, resolveScheduleColour } from '../../utils/scheduleModel.js';

interface HomePageProps {
  currentUserId: string;
  currentUserName: string;
}

type QuickCreateAction = {
  id: string;
  label: string;
  to: string;
  icon: ReactNode;
};

const quickCreateActions: QuickCreateAction[] = [
  { id: 'qc-customer', label: 'New Client', to: '/crm?create=customer', icon: <Users size={15} /> },
  { id: 'qc-estimate', label: 'New Estimate', to: '/estimates?create=estimate', icon: <FileText size={15} /> },
  { id: 'qc-job', label: 'New Job', to: '/jobs?create=job', icon: <Briefcase size={15} /> },
];

const dateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseTime = (value?: string) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const relative = (value?: string) => {
  if (!value) return 'just now';
  const time = parseTime(value);
  if (!time) return 'just now';
  return formatDistanceToNow(new Date(time), { addSuffix: true });
};

const priorityTone = (priority?: string) => {
  if (priority === 'high') return 'bg-accent-100 text-accent-700';
  if (priority === 'low') return 'bg-brand-100 text-brand-700';
  return 'bg-gray-100 text-gray-700';
};

export default function HomePage({ currentUserId, currentUserName }: HomePageProps) {
  const {
    customers,
    estimates,
    jobs,
    employees,
    crews,
    divisions,
    timeEntries,
    expenses,
    budgets,
    budgetRates,
    tasks,
    addTask,
    updateTask,
    completeTask,
    deleteTask,
  } = useStore();

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [addingTask, setAddingTask] = useState(false);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<GoogleCalendarEvent | null>(null);

  const today = new Date();
  const greetingName = currentUserName.split(' ')[0] || currentUserName;

  const onboardingItems = useMemo(() => buildDashboardOnboardingItems({
    businessId: 'home',
    businessName: 'OliveOps',
    employees,
    customers,
    estimates,
    jobs,
    budgets,
    budgetRates,
  }), [budgets, budgetRates, customers, employees, estimates, jobs]);
  const onboardingProgress = useMemo(() => calculateDashboardOnboardingProgress(onboardingItems), [onboardingItems]);

  const hasOperationalData = estimates.length > 0 || jobs.length > 0 || timeEntries.length > 0 || expenses.length > 0;
  const showOnboardingCard = !hasOperationalData && onboardingProgress.completeCount <= 1;

  const myTasks = useMemo(() => {
    return tasks
      .filter((task) => task.assignedUserId === currentUserId)
      .slice()
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'open' ? -1 : 1;
        if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
        if (left.dueDate && !right.dueDate) return -1;
        if (!left.dueDate && right.dueDate) return 1;
        return parseTime(right.updatedAt) - parseTime(left.updatedAt);
      });
  }, [currentUserId, tasks]);

  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weeklySchedule = useMemo(() => {
    const entries = jobs.flatMap((job) => {
      if (job.status !== 'scheduled' && job.status !== 'in_progress') return [];
      const window = getJobScheduleWindow(job);
      if (!window) return [];
      return [{
        source: 'oliveops' as const,
        jobId: job.id,
        status: job.status,
        startKey: window.startKey,
        endKey: window.endKey,
        crew: crews.find((crew) => crew.id === job.crewId) ?? null,
        division: getEffectiveDivision(job, divisions, budgets),
        employeeIds: job.assignedEmployeeIds ?? [],
        equipmentIds: job.assignedEquipmentIds ?? [],
      }];
    });
    return groupScheduleEntriesByDay(entries, weekDays.map(dateKey));
  }, [budgets, crews, divisions, jobs, weekStart.getTime()]);

  useEffect(() => {
    const controller = new AbortController();
    const start = weekStart;
    const end = addDays(start, 7);
    const params = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });
    const load = async () => {
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
    void load();
    return () => controller.abort();
  }, [weekStart.getTime()]);

  const sentEstimates = estimates.filter((estimate) => estimate.status === 'sent');
  const acceptedPendingConversion = estimates.filter((estimate) => estimate.status === 'accepted' && !estimate.convertedToJobId);
  const unscheduledJobs = jobs.filter((job) => job.status === 'scheduled' && !getJobScheduleWindow(job));

  const needsAttentionCount = sentEstimates.length + acceptedPendingConversion.length + unscheduledJobs.length;

  const submitTask = async () => {
    if (!taskTitle.trim()) {
      emitAppToast({ tone: 'error', message: 'Task title is required.' });
      return;
    }

    setAddingTask(true);
    const result = await addTask({
      title: taskTitle.trim(),
      description: '',
      dueDate: taskDueDate || undefined,
      assignedUserId: currentUserId,
      status: 'open',
      priority: taskPriority,
      createdByUserId: currentUserId,
    });
    setAddingTask(false);

    if (!result.ok) return;

    setTaskTitle('');
    setTaskDueDate('');
    setTaskPriority('normal');
    emitAppToast({ tone: 'success', message: 'Task added.' });
  };

  const toggleTask = async (taskId: string, isCompleted: boolean) => {
    if (isCompleted) {
      await updateTask(taskId, { status: 'open', completedAt: undefined });
      return;
    }

    await completeTask(taskId);
  };

  return (
    <div>
      <PageHeader
        title={`Home`}
        subtitle={`Good ${today.getHours() < 12 ? 'morning' : today.getHours() < 18 ? 'afternoon' : 'evening'}, ${greetingName}. Focus on what needs action today.`}
        action={(
          <div className="flex flex-wrap gap-2">
            {quickCreateActions.map((action) => (
              <Link key={action.id} to={action.to}>
                <Button variant="secondary" size="sm">{action.icon} {action.label}</Button>
              </Link>
            ))}
          </div>
        )}
      />

      {showOnboardingCard ? (
        <div className="mb-6">
          <DashboardOnboardingCard items={onboardingItems} businessId="home" prominent />
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <div className="p-4 border-b border-gray-100 dark:border-brand-600 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-brand-50">My Tasks</h2>
            <span className="text-xs text-gray-500 dark:text-brand-300">{myTasks.filter((task) => task.status === 'open').length} open</span>
          </div>
          <div className="p-4 border-b border-gray-100 dark:border-brand-600">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Add a task for today"
                className="md:col-span-2"
              />
              <Input
                type="date"
                value={taskDueDate}
                onChange={(event) => setTaskDueDate(event.target.value)}
              />
              <Select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as 'low' | 'normal' | 'high')}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div className="mt-2">
              <Button onClick={() => void submitTask()} disabled={addingTask}><Plus size={14} /> {addingTask ? 'Adding...' : 'Add Task'}</Button>
            </div>
          </div>

          {myTasks.length === 0 ? (
            <EmptyState
              icon={<ClipboardList aria-hidden="true" />}
              title="No tasks assigned to you"
              description="Capture the next actions you want to complete today."
            />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-brand-600">
              {myTasks.slice(0, 10).map((task) => (
                <li key={task.id} className="p-4 flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void toggleTask(task.id, task.status === 'completed')}
                    className="mt-0.5 text-brand-700 dark:text-brand-200"
                    aria-label={task.status === 'completed' ? 'Mark task open' : 'Mark task complete'}
                  >
                    {task.status === 'completed' ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${task.status === 'completed' ? 'line-through text-gray-500 dark:text-brand-300' : 'text-gray-900 dark:text-brand-50'}`}>{task.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-brand-300">
                      {task.dueDate ? <span>Due {task.dueDate}</span> : <span>No due date</span>}
                      <Badge label={task.priority ?? 'normal'} className={priorityTone(task.priority)} />
                      <span>Updated {relative(task.updatedAt)}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void deleteTask(task.id)}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="p-4 border-b border-gray-100 dark:border-brand-600 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-brand-50">Needs Attention</h2>
            <Badge label={String(needsAttentionCount)} className={needsAttentionCount > 0 ? 'bg-accent-100 text-accent-700' : 'bg-brand-100 text-brand-700'} />
          </div>
          <div className="p-4 space-y-3 text-sm">
            <div className="rounded-lg border border-gray-100 dark:border-brand-600 p-3">
              <p className="font-medium text-gray-900 dark:text-brand-50">Sent estimates awaiting response</p>
              <p className="text-gray-500 dark:text-brand-300 mt-1">{sentEstimates.length} estimates</p>
              <Link to="/estimates?status=sent" className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline mt-2 inline-block">Open estimates</Link>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-brand-600 p-3">
              <p className="font-medium text-gray-900 dark:text-brand-50">Accepted estimates not converted</p>
              <p className="text-gray-500 dark:text-brand-300 mt-1">{acceptedPendingConversion.length} estimates</p>
              <Link to="/estimates?status=accepted" className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline mt-2 inline-block">Review accepted</Link>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-brand-600 p-3">
              <p className="font-medium text-gray-900 dark:text-brand-50">Jobs needing schedule details</p>
              <p className="text-gray-500 dark:text-brand-300 mt-1">{unscheduledJobs.length} jobs</p>
              <Link to="/jobs" className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline mt-2 inline-block">Open jobs</Link>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <div className="p-4 border-b border-gray-100 dark:border-brand-600 flex items-center justify-between">
            <div><h2 className="font-semibold text-gray-900 dark:text-brand-50">This Week</h2><p className="mt-0.5 text-xs text-brand-500 dark:text-brand-200">{format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}</p></div>
            <Link to="/calendar" className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline">Open Calendar</Link>
          </div>

          {weeklySchedule.every((day) => day.entries.length === 0) && googleEvents.length === 0 ? (
            <EmptyState
              icon={<CalendarDays aria-hidden="true" />}
              title="No jobs scheduled this week"
              description="Use Calendar to assign work and keep the crew aligned."
              action={<Link to="/calendar"><Button variant="secondary">Plan in Calendar</Button></Link>}
            />
          ) : (
            <div className="divide-y divide-brand-100 dark:divide-brand-600">
              {weeklySchedule.map((day, index) => (
                <section key={day.dayKey} className="grid min-h-20 gap-3 p-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <div><p className="text-sm font-semibold text-brand-900 dark:text-brand-50">{format(weekDays[index], 'EEE')}</p><p className="text-xs text-brand-500 dark:text-brand-200">{format(weekDays[index], 'MMM d')}</p></div>
                  <div className="space-y-2">
                    {day.entries.length === 0 ? <p className="py-2 text-sm text-brand-400 dark:text-brand-300">No company work scheduled.</p> : day.entries.map((entry) => {
                      const job = jobs.find((item) => item.id === entry.jobId);
                      if (!job) return null;
                      const customer = customers.find((item) => item.id === job.customerId);
                      const colour = resolveScheduleColour({ colourBy: 'crew', job, crew: entry.crew, division: entry.division });
                      return <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-start justify-between gap-3 rounded-lg border-l-[3px] px-3 py-2 hover:brightness-95" style={{ borderColor: colour.value, backgroundColor: colour.tint }}><div className="min-w-0"><p className="truncate text-sm font-semibold" style={{ color: colour.value }}>{job.title}</p><p className="mt-0.5 truncate text-xs text-brand-600">{entry.crew?.name ?? 'Unassigned crew'} · {formatCustomerPropertyLabel(job, customer)}</p></div><span className="shrink-0 text-xs font-medium text-brand-600">{formatScheduleTimeLabel(job)}</span></Link>;
                    })}
                  </div>
                </section>
              ))}
              {googleEvents.slice(0, 5).map((event) => (
                <li key={`${event.googleCalendarId}:${event.googleEventId}`} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-brand-50">{event.title}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-brand-300">
                      {event.allDay ? 'All day' : `${new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${new Date(event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                    </p>
                    {event.location ? <p className="mt-1 truncate text-xs text-gray-500 dark:text-brand-300">{event.location}</p> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge label="Google Calendar" className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100" />
                    <button type="button" onClick={() => setSelectedGoogleEvent(event)} className="mt-2 block text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">View details</button>
                  </div>
                </li>
              ))}
            </div>
          )}
        </Card>
      </div>

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
            <div className="mt-5 space-y-4 text-sm text-brand-700 dark:text-brand-100">
              <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Date and time</p><p className="mt-2">{selectedGoogleEvent.allDay ? `${selectedGoogleEvent.start} · All day` : `${new Date(selectedGoogleEvent.start).toLocaleString()} - ${new Date(selectedGoogleEvent.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Location</p><p className="mt-2">{selectedGoogleEvent.location || 'No location provided.'}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200">Source</p><p className="mt-2">Google Calendar · Read-only in OliveOps</p></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
