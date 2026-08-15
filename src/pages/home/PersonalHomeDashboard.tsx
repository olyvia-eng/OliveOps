import { useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarCheck2, Clock3, ListTodo } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PersonalCalendar from '../../components/calendar/PersonalCalendar';
import usePersonalCalendarEvents, { type PersonalCalendarRange } from '../../components/calendar/usePersonalCalendarEvents';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import { Card, StatCard } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { Task, TaskPriority } from '../../types';
import JobDetailPanel, { type JobDetailTab } from '../jobs/JobDetailPanel';
import {
  buildRecentActivity,
  buildUpcomingItems,
  filterTasksByRange,
  getHoursLoggedToday,
  getJobsThisWeek,
  getPersonalJobs,
  getPersonalTasks,
  getTaskSummary,
  resolveSessionEmployee,
  type HomeTaskFilter,
} from './homeDashboardModel.js';
import OutstandingTasks from './OutstandingTasks';
import PersonalDashboardSidebar from './PersonalDashboardSidebar';

interface PersonalHomeDashboardProps {
  currentUserId: string;
  currentUserName: string;
  currentUserEmail?: string;
  currentUserRole: string;
  onOpenSchedule?: () => void;
  onOpenTimeClock?: () => void;
}

const taskFilters: HomeTaskFilter[] = ['all', 'today', 'overdue', 'week', 'completed'];
const jobTabs: JobDetailTab[] = ['overview', 'scope', 'team', 'invoices', 'notes'];

export default function PersonalHomeDashboard({ currentUserId, currentUserName, currentUserEmail, currentUserRole, onOpenSchedule, onOpenTimeClock }: PersonalHomeDashboardProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { customers, crews, employees, invoices, jobs, tasks, timeEntries, timeCorrections, addTask, updateTask, completeTask, deleteTask } = useStore();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [calendarRange, setCalendarRange] = useState<PersonalCalendarRange | null>(null);
  const [addRequest, setAddRequest] = useState(0);
  const externalEvents = usePersonalCalendarEvents(calendarRange);
  const now = new Date();

  const employee = useMemo(() => resolveSessionEmployee({ employees, userId: currentUserId, email: currentUserEmail }), [currentUserEmail, currentUserId, employees]);
  const personalJobs = useMemo(() => getPersonalJobs({ jobs, crews, employeeId: employee?.id }), [crews, employee?.id, jobs]);
  const personalTasks = useMemo(() => getPersonalTasks(tasks, currentUserId), [currentUserId, tasks]);
  const taskFilterValue = searchParams.get('taskFilter');
  const taskFilter: HomeTaskFilter = taskFilters.includes(taskFilterValue as HomeTaskFilter) ? taskFilterValue as HomeTaskFilter : 'all';
  const tasksExpanded = searchParams.get('tasks') === 'all';
  const filteredTasks = useMemo(() => filterTasksByRange(personalTasks, taskFilter, now).slice().sort((left, right) => {
    if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
    if (left.dueDate && !right.dueDate) return -1;
    if (!left.dueDate && right.dueDate) return 1;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  }), [personalTasks, taskFilter]);
  const summary = useMemo(() => getTaskSummary(personalTasks, now), [personalTasks]);
  const weekJobs = useMemo(() => getJobsThisWeek(personalJobs, now), [personalJobs]);
  const hoursToday = useMemo(() => getHoursLoggedToday(timeEntries, employee?.id, now), [employee?.id, timeEntries]);
  const upcoming = useMemo(() => buildUpcomingItems({ jobs: personalJobs, tasks: personalTasks, externalEvents, customers, now, limit: 5 }), [customers, externalEvents, personalJobs, personalTasks]);
  const activity = useMemo(() => buildRecentActivity({ jobs: personalJobs, tasks: personalTasks, timeEntries, corrections: timeCorrections, employeeId: employee?.id, limit: 5 }), [employee?.id, personalJobs, personalTasks, timeCorrections, timeEntries]);

  const selectedJobId = searchParams.get('homeJob');
  const selectedJob = personalJobs.find((job) => job.id === selectedJobId) ?? null;
  const selectedCustomer = customers.find((customer) => customer.id === selectedJob?.customerId) ?? null;
  const selectedCrew = crews.find((crew) => crew.id === selectedJob?.crewId);
  const selectedEmployeeIds = new Set([...(selectedJob?.assignedEmployeeIds ?? []), ...(selectedCrew?.memberIds ?? []), ...(selectedCrew?.leadEmployeeId ? [selectedCrew.leadEmployeeId] : [])]);
  const selectedEmployees = employees.filter((item) => selectedEmployeeIds.has(item.id));
  const selectedInvoices = invoices.filter((invoice) => invoice.jobId === selectedJob?.id);
  const tabValue = searchParams.get('homeJobTab');
  const selectedTab: JobDetailTab = jobTabs.includes(tabValue as JobDetailTab) ? tabValue as JobDetailTab : 'overview';
  const expandedJob = searchParams.get('homeJobMode') === 'expanded';
  const canViewFinancials = currentUserRole === 'owner' || currentUserRole === 'admin';
  const isFieldPortal = currentUserRole === 'crew_member' || currentUserRole === 'foreman';

  const updateQuery = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    setSearchParams(next);
  };

  const openJob = (jobId: string) => updateQuery({ homeJob: jobId, homeJobTab: 'overview', homeJobMode: null });
  const closeJob = () => updateQuery({ homeJob: null, homeJobTab: null, homeJobMode: null });
  const openTasks = () => {
    updateQuery({ tasks: 'all' });
    window.setTimeout(() => document.getElementById('outstanding-tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const requestAddTask = () => {
    setAddRequest((value) => value + 1);
    window.setTimeout(() => document.getElementById('outstanding-tasks')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };

  const createTask = async (input: { title: string; dueDate?: string; priority: TaskPriority }) => {
    const result = await addTask({ ...input, description: '', assignedUserId: currentUserId, status: 'open', createdByUserId: currentUserId });
    if (result.ok) emitAppToast({ tone: 'success', message: 'Task added.' });
    return result.ok;
  };
  const toggleTask = async (task: Task) => {
    if (task.status === 'completed') await updateTask(task.id, { status: 'open', completedAt: undefined });
    else await completeTask(task.id);
  };
  const removeTask = async (taskId: string) => { await deleteTask(taskId); };

  const greetingName = currentUserName.trim().split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  const dashboard = (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-medium text-brand-500 dark:text-brand-200">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now)}</p>
        <h1 className="mt-1 text-2xl font-semibold text-brand-900 dark:text-brand-50">Good {greeting}, {greetingName}</h1>
        <p className="mt-1 text-sm text-brand-400 dark:text-brand-300">Here is what needs your attention today.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Due Today" value={summary.dueToday} sub={summary.highPriorityDueToday ? `${summary.highPriorityDueToday} high priority` : 'No high-priority tasks'} icon={<ListTodo />} color={summary.dueToday ? 'text-accent-700' : 'text-brand-700 dark:text-brand-100'} />
        <StatCard label="Overdue" value={summary.overdue} sub={summary.overdue ? 'Needs attention' : 'You are caught up'} icon={<CalendarCheck2 />} color={summary.overdue ? 'text-accent-700' : 'text-brand-700 dark:text-brand-100'} />
        <StatCard label="Jobs This Week" value={weekJobs.length} sub="Assigned to you or your crew" icon={<BriefcaseBusiness />} color="text-brand-700 dark:text-brand-100" />
        <StatCard label="Hours Today" value={hoursToday.toFixed(1)} sub="Recorded work hours" icon={<Clock3 />} color="text-brand-700 dark:text-brand-100" />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(17rem,1fr)]">
        <main className="min-w-0 space-y-5">
          <Card className="overflow-hidden rounded-lg">
            <PersonalCalendar jobs={personalJobs} tasks={personalTasks} customers={customers} externalEvents={externalEvents} selectedDate={selectedDate} onDateChange={setSelectedDate} onRangeChange={setCalendarRange} onOpenJob={openJob} onSelectTask={openTasks} />
          </Card>
          <OutstandingTasks tasks={filteredTasks} filter={taskFilter} expanded={tasksExpanded} addRequest={addRequest} onFilterChange={(filter) => updateQuery({ taskFilter: filter, tasks: filter === 'all' ? searchParams.get('tasks') : 'all' })} onViewAll={openTasks} onAdd={createTask} onToggle={toggleTask} onDelete={removeTask} />
        </main>
        <PersonalDashboardSidebar selectedDate={selectedDate} upcoming={upcoming} activity={activity} showTimeClock={Boolean(onOpenTimeClock)} onSelectDate={setSelectedDate} onOpenJob={openJob} onOpenTask={openTasks} onAddTask={requestAddTask} onOpenSchedule={onOpenSchedule ?? (() => navigate('/schedule'))} onOpenTimeClock={onOpenTimeClock} />
      </div>
    </div>
  );

  return (
    <DetailWorkspace
      open={Boolean(selectedJob)}
      expanded={expandedJob}
      detailKey={selectedJob?.id}
      list={dashboard}
      detail={selectedJob ? <JobDetailPanel job={selectedJob} customer={selectedCustomer} assignedEmployees={selectedEmployees} invoices={selectedInvoices} activeTab={selectedTab} expanded={expandedJob} canViewFinancials={canViewFinancials} canEdit={false} canOpenFullRecord={!isFieldPortal} onTabChange={(tab) => updateQuery({ homeJobTab: tab })} onEdit={() => undefined} onExpand={() => updateQuery({ homeJobMode: 'expanded' })} onCollapse={() => updateQuery({ homeJobMode: null })} onClose={closeJob} /> : null}
    />
  );
}
