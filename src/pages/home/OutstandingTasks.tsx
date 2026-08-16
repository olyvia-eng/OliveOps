import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ClipboardList, GripVertical, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Task, TaskPriority } from '../../types';
import { Badge, Button, Card, EmptyState, Input, Select } from '../../components/ui';
import type { HomeTaskFilter } from './homeDashboardModel.js';

interface OutstandingTasksProps {
  tasks: Task[];
  filter: HomeTaskFilter;
  filterLabels: Record<HomeTaskFilter, string>;
  filterOrder: HomeTaskFilter[];
  expanded: boolean;
  addRequest: number;
  onFilterChange: (filter: HomeTaskFilter) => void;
  onFilterLabelChange: (filter: HomeTaskFilter, label: string) => void;
  onFilterOrderChange: (filters: HomeTaskFilter[]) => void;
  onViewAll: () => void;
  onAdd: (input: { title: string; dueDate?: string; priority: TaskPriority }) => Promise<boolean>;
  onToggle: (task: Task) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onDismissCompletedToday: (taskId: string) => void;
}

const priorityTone = (priority?: string) => {
  if (priority === 'high') return 'bg-accent-100 text-accent-700';
  if (priority === 'low') return 'bg-brand-100 text-brand-700 dark:bg-brand-600 dark:text-brand-100';
  return 'bg-gray-100 text-gray-700 dark:bg-brand-600 dark:text-brand-100';
};

export default function OutstandingTasks({ tasks, filter, filterLabels, filterOrder, expanded, addRequest, onFilterChange, onFilterLabelChange, onFilterOrderChange, onViewAll, onAdd, onToggle, onDelete, onDismissCompletedToday }: OutstandingTasksProps) {
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [editingFilter, setEditingFilter] = useState<HomeTaskFilter | null>(null);
  const [filterDraft, setFilterDraft] = useState('');
  const [draggedFilter, setDraggedFilter] = useState<HomeTaskFilter | null>(null);
  const visibleTasks = expanded ? tasks : tasks.slice(0, 5);

  useEffect(() => {
    if (addRequest > 0) setAdding(true);
  }, [addRequest]);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    const ok = await onAdd({ title: title.trim(), dueDate: dueDate || undefined, priority });
    setSubmitting(false);
    if (!ok) return;
    setTitle('');
    setDueDate('');
    setPriority('normal');
    setAdding(false);
  };

  const editFilter = (value: HomeTaskFilter) => {
    if (filter !== value) {
      onFilterChange(value);
      return;
    }
    if (value !== 'today') {
      setFilterDraft(filterLabels[value]);
      setEditingFilter(value);
    }
  };

  const moveFilter = (value: HomeTaskFilter, nextIndex: number) => {
    const currentIndex = filterOrder.indexOf(value);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= filterOrder.length || currentIndex === nextIndex) return;
    const next = [...filterOrder];
    next.splice(currentIndex, 1);
    next.splice(nextIndex, 0, value);
    onFilterOrderChange(next);
  };

  const saveFilterLabel = (value: HomeTaskFilter) => {
    onFilterLabelChange(value, filterDraft);
    setEditingFilter(null);
  };

  return (
    <Card id="outstanding-tasks" className="overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 px-4 py-3 dark:border-brand-600">
        <div>
          <h2 className="font-semibold text-brand-900 dark:text-brand-50">Tasks</h2>
          <p className="mt-0.5 text-xs text-brand-400 dark:text-brand-300">Your next personal actions</p>
        </div>
        <Button size="sm" onClick={() => setAdding((value) => !value)}>{adding ? <X /> : <Plus />}{adding ? 'Cancel' : 'Add task'}</Button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-brand-100 px-3 py-2 dark:border-brand-600" aria-label="Task filters">
        {filterOrder.map((value, index) => (
          <div key={value} draggable onDragStart={() => setDraggedFilter(value)} onDragEnd={() => setDraggedFilter(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => {
            if (draggedFilter) moveFilter(draggedFilter, index);
            setDraggedFilter(null);
          }} className="flex shrink-0 items-center gap-0.5">
            <GripVertical size={14} className="cursor-grab text-brand-300" aria-hidden="true" />
            {editingFilter === value ? (
          <Input autoFocus value={filterDraft} maxLength={30} aria-label={`Rename ${filterLabels[value]} filter`} className="h-8 w-28 shrink-0 px-2 text-xs" onChange={(event) => setFilterDraft(event.target.value)} onBlur={() => saveFilterLabel(value)} onKeyDown={(event) => {
            if (event.key === 'Enter') saveFilterLabel(value);
            if (event.key === 'Escape') {
              setFilterDraft(filterLabels[value]);
              setEditingFilter(null);
            }
          }} />
        ) : (
          <button type="button" onClick={() => editFilter(value)} title={filter === value && value !== 'today' ? 'Click again to rename' : undefined} className={`h-8 shrink-0 rounded-md px-3 text-xs font-semibold ${filter === value ? 'bg-brand-700 text-white' : 'text-brand-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-600'}`}>{value === 'today' ? 'Today' : filterLabels[value]}</button>
        )}
            <button type="button" disabled={index === 0} onClick={() => moveFilter(value, index - 1)} aria-label={`Move ${filterLabels[value]} earlier`} title="Move earlier" className="grid h-7 w-6 place-items-center rounded text-brand-400 hover:bg-brand-50 disabled:opacity-30"><ChevronLeft size={13} /></button>
            <button type="button" disabled={index === filterOrder.length - 1} onClick={() => moveFilter(value, index + 1)} aria-label={`Move ${filterLabels[value]} later`} title="Move later" className="grid h-7 w-6 place-items-center rounded text-brand-400 hover:bg-brand-50 disabled:opacity-30"><ChevronRight size={13} /></button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="border-b border-brand-100 bg-brand-50/60 p-4 dark:border-brand-600 dark:bg-brand-800/30">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_8rem_auto]">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs doing?" aria-label="Task title" />
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" />
            <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} aria-label="Priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select>
            <Button onClick={() => void submit()} disabled={!title.trim() || submitting}>{submitting ? 'Adding...' : 'Add'}</Button>
          </div>
        </div>
      ) : null}

      {visibleTasks.length === 0 ? <EmptyState icon={<ClipboardList />} title="Nothing here" description={filter === 'completed' ? 'Completed tasks will appear here.' : 'You are clear for this view.'} /> : (
        <ul className="divide-y divide-brand-100 dark:divide-brand-600">
          {visibleTasks.map((task) => (
            <li key={task.id} className="flex items-start gap-3 px-4 py-3">
              <button type="button" onClick={() => void onToggle(task)} className="mt-0.5 text-brand-700 dark:text-brand-200" aria-label={task.status === 'completed' ? 'Mark task open' : 'Mark task complete'}>{task.status === 'completed' ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${task.status === 'completed' ? 'text-brand-400 line-through dark:text-brand-300' : 'text-brand-900 dark:text-brand-50'}`}>{task.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-400 dark:text-brand-300">
                  <span>{task.dueDate ? `Due ${task.dueDate}` : 'No due date'}</span>
                  <Badge label={task.priority ?? 'normal'} className={priorityTone(task.priority)} />
                  <span>Updated {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}</span>
                </div>
              </div>
              <button type="button" onClick={() => filter === 'today' && task.status === 'completed' ? onDismissCompletedToday(task.id) : void onDelete(task.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-400 hover:bg-accent-50 hover:text-accent-700" aria-label={filter === 'today' && task.status === 'completed' ? `Hide ${task.title} from Today` : `Remove ${task.title}`}><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}

      {!expanded && tasks.length > 5 ? <div className="border-t border-brand-100 p-3 text-center dark:border-brand-600"><button type="button" onClick={onViewAll} className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-100">View all {tasks.length} tasks</button></div> : null}
    </Card>
  );
}
