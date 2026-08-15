import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Circle, ClipboardList, Plus } from 'lucide-react';
import PersonalCalendar from '../../components/calendar/PersonalCalendar';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';

interface HomePageProps {
  currentUserId: string;
  currentUserName: string;
}

const parseTime = (value?: string) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const relative = (value?: string) => {
  const time = parseTime(value);
  return time ? formatDistanceToNow(new Date(time), { addSuffix: true }) : 'just now';
};

const priorityTone = (priority?: string) => {
  if (priority === 'high') return 'bg-accent-100 text-accent-700';
  if (priority === 'low') return 'bg-brand-100 text-brand-700';
  return 'bg-gray-100 text-gray-700';
};

export default function HomePage({ currentUserId, currentUserName }: HomePageProps) {
  const navigate = useNavigate();
  const { customers, jobs, tasks, addTask, updateTask, completeTask, deleteTask } = useStore();
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [addingTask, setAddingTask] = useState(false);

  const myTasks = useMemo(() => tasks
    .filter((task) => task.assignedUserId === currentUserId)
    .slice()
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'open' ? -1 : 1;
      if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
      if (left.dueDate && !right.dueDate) return -1;
      if (!left.dueDate && right.dueDate) return 1;
      return parseTime(right.updatedAt) - parseTime(left.updatedAt);
    }), [currentUserId, tasks]);

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

  const toggleTask = async (taskId: string, completed: boolean) => {
    if (completed) await updateTask(taskId, { status: 'open', completedAt: undefined });
    else await completeTask(taskId);
  };

  const greetingName = currentUserName.split(' ')[0] || currentUserName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  return (
    <div>
      <PageHeader title="My Calendar" subtitle={`Good ${greeting}, ${greetingName}. Your assigned work, due tasks, and personal calendars.`} />

      <Card className="overflow-hidden">
        <PersonalCalendar jobs={jobs} tasks={myTasks} customers={customers} onOpenJob={(jobId) => navigate(`/jobs/${jobId}`)} />
      </Card>

      <Card className="mt-6">
        <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-brand-600">
          <h2 className="font-semibold text-gray-900 dark:text-brand-50">My Tasks</h2>
          <span className="text-xs text-gray-500 dark:text-brand-300">{myTasks.filter((task) => task.status === 'open').length} open</span>
        </div>
        <div className="border-b border-gray-100 p-4 dark:border-brand-600">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Add a task" className="md:col-span-2" />
            <Input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} />
            <Select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as 'low' | 'normal' | 'high')}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </Select>
          </div>
          <Button className="mt-2" onClick={() => void submitTask()} disabled={addingTask}><Plus size={14} /> {addingTask ? 'Adding...' : 'Add Task'}</Button>
        </div>

        {myTasks.length === 0 ? (
          <EmptyState icon={<ClipboardList aria-hidden="true" />} title="No tasks assigned to you" description="Capture the next actions you want to complete." />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-brand-600">
            {myTasks.slice(0, 10).map((task) => (
              <li key={task.id} className="flex items-start gap-3 p-4">
                <button type="button" onClick={() => void toggleTask(task.id, task.status === 'completed')} className="mt-0.5 text-brand-700 dark:text-brand-200" aria-label={task.status === 'completed' ? 'Mark task open' : 'Mark task complete'}>
                  {task.status === 'completed' ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${task.status === 'completed' ? 'text-gray-500 line-through dark:text-brand-300' : 'text-gray-900 dark:text-brand-50'}`}>{task.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-brand-300">
                    <span>{task.dueDate ? `Due ${task.dueDate}` : 'No due date'}</span>
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
    </div>
  );
}
