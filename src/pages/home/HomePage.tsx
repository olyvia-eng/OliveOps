import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Briefcase, CalendarDays, CheckCircle2, Circle, ClipboardList, FileText, Plus, Users } from 'lucide-react';
import DashboardOnboardingCard from '../../components/dashboard/DashboardOnboardingCard';
import { buildDashboardOnboardingItems, calculateDashboardOnboardingProgress } from '../../components/dashboard/onboardingProgress';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { formatCustomerPropertyLabel, formatScheduleTimeLabel, getJobScheduleWindow } from '../../utils/jobSchedule';

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

  const today = new Date();
  const todayKey = dateKey(today);
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

  const todaysSchedule = useMemo(() => {
    return jobs
      .filter((job) => {
        if (job.status !== 'scheduled' && job.status !== 'in_progress') return false;
        const window = getJobScheduleWindow(job);
        return Boolean(window && todayKey >= window.startKey && todayKey <= window.endKey);
      })
      .slice()
      .sort((left, right) => {
        const leftWindow = getJobScheduleWindow(left);
        const rightWindow = getJobScheduleWindow(right);
        if (!leftWindow || !rightWindow) return 0;
        return leftWindow.start.getTime() - rightWindow.start.getTime();
      });
  }, [jobs, todayKey]);

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
            <h2 className="font-semibold text-gray-900 dark:text-brand-50">Today&apos;s Schedule</h2>
            <Link to="/calendar" className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline">Open Calendar</Link>
          </div>

          {todaysSchedule.length === 0 ? (
            <EmptyState
              icon={<CalendarDays aria-hidden="true" />}
              title="No jobs scheduled today"
              description="Use Calendar to assign work and keep the crew aligned."
              action={<Link to="/calendar"><Button variant="secondary">Plan in Calendar</Button></Link>}
            />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-brand-600">
              {todaysSchedule.slice(0, 8).map((job) => {
                const customer = customers.find((item) => item.id === job.customerId);
                return (
                  <li key={job.id} className="p-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-brand-50">{job.title}</p>
                      <p className="text-xs text-gray-500 dark:text-brand-300 mt-1">{formatCustomerPropertyLabel(job, customer)}</p>
                      <p className="text-xs text-gray-500 dark:text-brand-300 mt-1">{formatScheduleTimeLabel(job)}</p>
                    </div>
                    <div className="text-right">
                      <Badge label={job.status.replace('_', ' ')} className={job.status === 'in_progress' ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-700'} />
                      <div className="mt-2">
                        <Link to={`/jobs/${job.id}`} className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline">Open Job</Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
