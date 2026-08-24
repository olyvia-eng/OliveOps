import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Circle, ClipboardList, ListPlus, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Task, TaskPriority, TaskTab } from '../../types';
import { Badge, Button, Card, EmptyState, Input, Modal, Select } from '../../components/ui';
import { taskCreationDefaults } from './homeDashboardModel.js';

interface OutstandingTasksProps {
  heading?: string;
  subtitle?: string;
  tasks: Task[];
  allTasks: Task[];
  filter: string;
  customTaskTabs: TaskTab[];
  filterOrder: string[];
  expanded: boolean;
  addRequest: number;
  onFilterChange: (filter: string) => void;
  onFilterOrderChange: (filters: string[]) => void;
  onCreateCustomTab: (name: string) => { ok: boolean; tab?: TaskTab; error?: string };
  onRenameCustomTab: (id: string, name: string) => { ok: boolean; error?: string };
  onDeleteCustomTab: (id: string) => boolean;
  onViewAll: () => void;
  onAdd: (input: { title: string; dueDate?: string; priority: TaskPriority; taskTabId?: string; parentTaskId?: string }) => Promise<boolean>;
  onUpdate: (taskId: string, input: { title: string; dueDate?: string; priority: TaskPriority; taskTabId?: string }) => Promise<boolean>;
  onToggle: (task: Task) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onDismissCompletedToday: (taskId: string) => void;
  filterLabels?: Record<string, string>;
  onRenameFilter?: (filter: string, name: string) => void | Promise<void>;
  allowCustomTabs?: boolean;
}

const systemTabLabels: Record<string, string> = { all: 'Open', today: 'Today', overdue: 'Overdue', week: 'This week', completed: 'Completed' };

const priorityTone = (priority?: string) => {
  if (priority === 'high') return 'bg-accent-100 text-accent-700';
  if (priority === 'low') return 'bg-brand-100 text-brand-700 dark:bg-brand-600 dark:text-brand-100';
  return 'bg-gray-100 text-gray-700 dark:bg-brand-600 dark:text-brand-100';
};

export default function OutstandingTasks({ heading = 'Tasks', subtitle = 'Your next personal actions', tasks, allTasks, filter, customTaskTabs, filterOrder, expanded, addRequest, onFilterChange, onFilterOrderChange, onCreateCustomTab, onRenameCustomTab, onDeleteCustomTab, onViewAll, onAdd, onUpdate, onToggle, onDelete, onDismissCompletedToday, filterLabels, onRenameFilter, allowCustomTabs = true }: OutstandingTasksProps) {
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [taskTabId, setTaskTabId] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [parentTask, setParentTask] = useState<Task | null>(null);
  const [draggedFilter, setDraggedFilter] = useState<string | null>(null);
  const [tabDialog, setTabDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [selectedTab, setSelectedTab] = useState<TaskTab | null>(null);
  const [tabName, setTabName] = useState('');
  const [tabError, setTabError] = useState('');
  const [contextTabId, setContextTabId] = useState<string | null>(null);
  const [editingFilter, setEditingFilter] = useState<string | null>(null);
  const [editingFilterName, setEditingFilterName] = useState('');
  const visibleTasks = expanded ? tasks : tasks.slice(0, 5);

  const saveFilterName = async () => {
    if (!editingFilter || !editingFilterName.trim() || !onRenameFilter) return;
    await onRenameFilter(editingFilter, editingFilterName.trim());
    setEditingFilter(null);
  };

  const openAdd = () => {
    const defaults = taskCreationDefaults(filter, customTaskTabs, new Date());
    setEditingTask(null);
    setParentTask(null);
    setTitle('');
    setDueDate(defaults.dueDate);
    setPriority('normal');
    setTaskTabId(defaults.taskTabId);
    setAdding(true);
  };

  const openAddSubtask = (task: Task) => {
    setEditingTask(null);
    setParentTask(task);
    setTitle('');
    setDueDate(task.dueDate ?? '');
    setPriority('normal');
    setTaskTabId(task.taskTabId ?? '');
    setAdding(true);
  };

  useEffect(() => {
    if (addRequest > 0) openAdd();
    // addRequest represents an explicit external add intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequest]);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    const input = { title: title.trim(), dueDate: dueDate || undefined, priority, taskTabId: taskTabId || undefined, parentTaskId: parentTask?.id };
    const ok = editingTask ? await onUpdate(editingTask.id, input) : await onAdd(input);
    setSubmitting(false);
    if (!ok) return;
    setTitle('');
    setDueDate('');
    setPriority('normal');
    setTaskTabId('');
    setEditingTask(null);
    setParentTask(null);
    setAdding(false);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setParentTask(null);
    setTitle(task.title);
    setDueDate(task.dueDate ?? '');
    setPriority(task.priority ?? 'normal');
    setTaskTabId(task.taskTabId ?? '');
    setAdding(true);
  };

  const moveFilter = (value: string, nextIndex: number) => {
    const currentIndex = filterOrder.indexOf(value);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= filterOrder.length || currentIndex === nextIndex) return;
    const next = [...filterOrder];
    next.splice(currentIndex, 1);
    next.splice(nextIndex, 0, value);
    onFilterOrderChange(next);
  };

  const openTabDialog = (mode: 'create' | 'rename' | 'delete', tab?: TaskTab) => {
    setSelectedTab(tab ?? null);
    setTabName(tab?.name ?? '');
    setTabError('');
    setContextTabId(null);
    setTabDialog(mode);
  };

  const saveTab = () => {
    const result: { ok: boolean; tab?: TaskTab; error?: string } = tabDialog === 'rename' && selectedTab
      ? onRenameCustomTab(selectedTab.id, tabName)
      : onCreateCustomTab(tabName);
    if (!result.ok) return setTabError(result.error ?? 'Task tab could not be saved.');
    setTabDialog(null);
    if (result.tab) onFilterChange(result.tab.id);
  };

  const deleteTab = () => {
    if (!selectedTab || !onDeleteCustomTab(selectedTab.id)) return;
    if (filter === selectedTab.id) onFilterChange('all');
    setTabDialog(null);
  };

  return (
    <Card id="outstanding-tasks" className="overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 px-4 py-3 dark:border-brand-600">
        <div>
          <h2 className="font-semibold text-brand-900 dark:text-brand-50">{heading}</h2>
          <p className="mt-0.5 text-xs text-brand-400 dark:text-brand-300">{subtitle}</p>
        </div>
        <Button size="sm" onClick={() => { if (adding) { setAdding(false); setEditingTask(null); setParentTask(null); } else openAdd(); }}>{adding ? <X /> : <Plus />}{adding ? 'Cancel' : 'Add task'}</Button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-brand-100 px-3 py-2 dark:border-brand-600" aria-label="Task filters">
        {filterOrder.map((value, index) => { const customTab = customTaskTabs.find((tab) => tab.id === value); const label = customTab?.name ?? filterLabels?.[value] ?? systemTabLabels[value] ?? value; return (
          <div key={value} className="relative shrink-0" onDragOver={(event) => event.preventDefault()} onDrop={() => {
            if (draggedFilter) moveFilter(draggedFilter, index);
            setDraggedFilter(null);
          }}>
            {editingFilter === value ? <Input autoFocus value={editingFilterName} maxLength={30} aria-label={`Rename ${label} task header`} onChange={(event) => setEditingFilterName(event.target.value)} onBlur={() => void saveFilterName()} onKeyDown={(event) => { if (event.key === 'Enter') void saveFilterName(); if (event.key === 'Escape') setEditingFilter(null); }} className="h-8 w-32 text-xs" /> : <button type="button" draggable onDragStart={() => setDraggedFilter(value)} onDragEnd={() => setDraggedFilter(null)} onClick={() => onFilterChange(value)} onDoubleClick={() => { if (!onRenameFilter) return; setEditingFilter(value); setEditingFilterName(label); }} onContextMenu={(event) => { if (!customTab) return; event.preventDefault(); setContextTabId(value); }} onKeyDown={(event) => { if (customTab && event.shiftKey && event.key === 'F10') { event.preventDefault(); setContextTabId(value); } }} title={onRenameFilter ? 'Double-click to rename' : customTab ? 'Right-click to manage tab' : undefined} className={`h-8 rounded-md px-3 text-xs font-semibold ${filter === value ? 'bg-brand-700 text-white' : 'text-brand-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-600'}`}>{label}</button>}
            {contextTabId === value && customTab ? <div role="menu" className="absolute left-0 top-9 z-20 min-w-28 rounded-md border border-brand-100 bg-white p-1 shadow-lg dark:border-brand-600 dark:bg-brand-700"><button type="button" role="menuitem" onClick={() => openTabDialog('rename', customTab)} className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-brand-50 dark:hover:bg-brand-800">Rename</button><button type="button" role="menuitem" onClick={() => openTabDialog('delete', customTab)} className="block w-full rounded px-3 py-2 text-left text-xs text-accent-700 hover:bg-accent-50">Delete</button></div> : null}
          </div>
        ); })}
        {allowCustomTabs ? <button type="button" onClick={() => openTabDialog('create')} aria-label="Add task tab" title="Add task tab" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-600"><Plus size={15} /></button> : null}
      </div>

      {adding ? (
        <div className="border-b border-brand-100 bg-brand-50/60 p-4 dark:border-brand-600 dark:bg-brand-800/30">
          {parentTask ? <p className="mb-2 text-xs font-semibold text-brand-600 dark:text-brand-200">Subtask of {parentTask.title}</p> : null}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_8rem_11rem_auto]">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs doing?" aria-label="Task title" />
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" />
            <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} aria-label="Priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select>
            <Select value={taskTabId} onChange={(event) => setTaskTabId(event.target.value)} aria-label="Task Tab / Category"><option value="">No category</option>{customTaskTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</Select>
            <Button onClick={() => void submit()} disabled={!title.trim() || submitting}>{submitting ? 'Saving...' : editingTask ? 'Save' : parentTask ? 'Add subtask' : 'Add'}</Button>
          </div>
        </div>
      ) : null}

      {visibleTasks.length === 0 ? <EmptyState icon={<ClipboardList />} title="Nothing here" description={filter === 'completed' ? 'Completed tasks will appear here.' : 'You are clear for this view.'} /> : (
        <ul className="divide-y divide-brand-100 dark:divide-brand-600">
          {visibleTasks.map((task) => { const subtasks = allTasks.filter((item) => item.parentTaskId === task.id); const completedCount = subtasks.filter((item) => item.status === 'completed').length; return (
            <li key={task.id}>
              <div className="flex items-start gap-3 px-4 py-3">
                <button type="button" onClick={() => void onToggle(task)} className="mt-0.5 text-brand-700 dark:text-brand-200" aria-label={task.status === 'completed' ? 'Mark task open' : 'Mark task complete'}>{task.status === 'completed' ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${task.status === 'completed' ? 'text-brand-400 line-through dark:text-brand-300' : 'text-brand-900 dark:text-brand-50'}`}>{task.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-400 dark:text-brand-300">
                    <span>{task.dueDate ? `Due ${task.dueDate}` : 'No due date'}</span>
                    <Badge label={task.priority ?? 'normal'} className={priorityTone(task.priority)} />
                    {subtasks.length ? <span>{completedCount} of {subtasks.length} subtasks complete</span> : null}
                    <span>Updated {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}</span>
                  </div>
                </div>
                {task.status === 'open' ? <button type="button" onClick={() => openAddSubtask(task)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-400 hover:bg-brand-50 hover:text-brand-700" aria-label={`Add subtask to ${task.title}`} title="Add subtask"><ListPlus size={16} /></button> : null}
                <button type="button" onClick={() => openEditTask(task)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-400 hover:bg-brand-50 hover:text-brand-700" aria-label={`Edit ${task.title}`}><Pencil size={15} /></button>
                <button type="button" onClick={() => filter === 'today' && task.status === 'completed' ? onDismissCompletedToday(task.id) : void onDelete(task.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-400 hover:bg-accent-50 hover:text-accent-700" aria-label={filter === 'today' && task.status === 'completed' ? `Hide ${task.title} from Today` : `Remove ${task.title}`}><X size={15} /></button>
              </div>
              {subtasks.length ? <ul className="border-t border-brand-50 bg-brand-50/40 px-4 py-1 dark:border-brand-700 dark:bg-brand-800/20">{subtasks.map((subtask) => (
                <li key={subtask.id} className="ml-6 flex items-start gap-3 border-l-2 border-brand-100 px-3 py-2.5 dark:border-brand-600">
                  <button type="button" onClick={() => void onToggle(subtask)} className="mt-0.5 text-brand-600 dark:text-brand-200" aria-label={subtask.status === 'completed' ? 'Mark subtask open' : 'Mark subtask complete'}>{subtask.status === 'completed' ? <CheckCircle2 size={16} /> : <Circle size={16} />}</button>
                  <div className="min-w-0 flex-1"><p className={`text-sm ${subtask.status === 'completed' ? 'text-brand-400 line-through dark:text-brand-300' : 'text-brand-800 dark:text-brand-100'}`}>{subtask.title}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-400 dark:text-brand-300"><span>{subtask.dueDate ? `Due ${subtask.dueDate}` : 'No due date'}</span><Badge label={subtask.priority ?? 'normal'} className={priorityTone(subtask.priority)} /></div></div>
                  <button type="button" onClick={() => openEditTask(subtask)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-400 hover:bg-white hover:text-brand-700 dark:hover:bg-brand-700" aria-label={`Edit ${subtask.title}`}><Pencil size={14} /></button>
                  <button type="button" onClick={() => void onDelete(subtask.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-400 hover:bg-accent-50 hover:text-accent-700" aria-label={`Remove ${subtask.title}`}><X size={14} /></button>
                </li>
              ))}</ul> : null}
            </li>
          ); })}
        </ul>
      )}

      {!expanded && tasks.length > 5 ? <div className="border-t border-brand-100 p-3 text-center dark:border-brand-600"><button type="button" onClick={onViewAll} className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-100">View all {tasks.length} tasks</button></div> : null}
      <Modal open={tabDialog === 'create' || tabDialog === 'rename'} onClose={() => setTabDialog(null)} title={tabDialog === 'rename' ? 'Rename Task Tab' : 'New Task Tab'} footer={<><Button variant="secondary" onClick={() => setTabDialog(null)}>Cancel</Button><Button onClick={saveTab}>{tabDialog === 'rename' ? 'Save' : 'Create'}</Button></>}><Input autoFocus label="Name" maxLength={30} value={tabName} onChange={(event) => { setTabName(event.target.value); setTabError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') saveTab(); }} error={tabError} /></Modal>
      <Modal open={tabDialog === 'delete'} onClose={() => setTabDialog(null)} title={`Delete "${selectedTab?.name ?? ''}"?`} footer={<><Button variant="secondary" onClick={() => setTabDialog(null)}>Cancel</Button><Button onClick={deleteTab}>Delete Tab</Button></>}><p className="text-sm text-brand-500 dark:text-brand-300">Tasks in this tab will not be deleted. They will continue to appear in system views such as Open, Today, and Completed.</p></Modal>
    </Card>
  );
}
