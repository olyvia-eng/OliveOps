import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Circle, ClipboardList, ListPlus, Pencil, Plus, Rows3, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JobTaskHeading, Task, TaskPriority, TaskTab } from '../../types';
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
  onAdd: (input: { title: string; dueDate?: string; priority: TaskPriority; taskTabId?: string; parentTaskId?: string; headingId?: string }) => Promise<boolean>;
  onUpdate: (taskId: string, input: { title: string; dueDate?: string; priority: TaskPriority; taskTabId?: string; headingId?: string }) => Promise<boolean>;
  onToggle: (task: Task) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onDismissCompletedToday: (taskId: string) => void;
  filterLabels?: Record<string, string>;
  onRenameFilter?: (filter: string, name: string) => void | Promise<void>;
  allowCustomTabs?: boolean;
  jobTaskHeadings?: JobTaskHeading[];
  onAddHeading?: (name: string) => Promise<{ ok: boolean; heading?: JobTaskHeading; error?: string }>;
  onRenameHeading?: (headingId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onDeleteHeading?: (headingId: string) => Promise<{ ok: boolean; movedTaskCount?: number; error?: string }>;
  onReorderHeadings?: (orderedIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  canManageJobTaskHeadings?: boolean;
}

const systemTabLabels: Record<string, string> = { all: 'Open', today: 'Today', overdue: 'Overdue', week: 'This week', completed: 'Completed' };

const priorityTone = (priority?: string) => {
  if (priority === 'high') return 'bg-accent-100 text-accent-700';
  if (priority === 'low') return 'bg-brand-100 text-brand-700 dark:bg-brand-600 dark:text-brand-100';
  return 'bg-gray-100 text-gray-700 dark:bg-brand-600 dark:text-brand-100';
};

export default function OutstandingTasks({ heading = 'Tasks', subtitle = 'Your next personal actions', tasks, allTasks, filter, customTaskTabs, filterOrder, expanded, addRequest, onFilterChange, onFilterOrderChange, onCreateCustomTab, onRenameCustomTab, onDeleteCustomTab, onViewAll, onAdd, onUpdate, onToggle, onDelete, onDismissCompletedToday, filterLabels, onRenameFilter, allowCustomTabs = true, jobTaskHeadings, onAddHeading, onRenameHeading, onDeleteHeading, onReorderHeadings, canManageJobTaskHeadings = false }: OutstandingTasksProps) {
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [taskTabId, setTaskTabId] = useState('');
  const [headingId, setHeadingId] = useState('');
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
  const [headingDialog, setHeadingDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [selectedHeading, setSelectedHeading] = useState<JobTaskHeading | null>(null);
  const [headingName, setHeadingName] = useState('');
  const [headingError, setHeadingError] = useState('');
  const [draggedHeadingId, setDraggedHeadingId] = useState<string | null>(null);
  const visibleTasks = expanded ? tasks : tasks.slice(0, 5);

  const saveFilterName = async () => {
    if (!editingFilter || !editingFilterName.trim() || !onRenameFilter) return;
    await onRenameFilter(editingFilter, editingFilterName.trim());
    setEditingFilter(null);
  };

  const openAdd = (selectedHeadingId = '') => {
    const defaults = taskCreationDefaults(filter, customTaskTabs, new Date());
    setEditingTask(null);
    setParentTask(null);
    setTitle('');
    setDueDate(defaults.dueDate);
    setPriority('normal');
    setTaskTabId(defaults.taskTabId);
    setHeadingId(selectedHeadingId);
    setAdding(true);
  };

  const openAddSubtask = (task: Task) => {
    setEditingTask(null);
    setParentTask(task);
    setTitle('');
    setDueDate(task.dueDate ?? '');
    setPriority('normal');
    setTaskTabId(task.taskTabId ?? '');
    setHeadingId(task.headingId ?? '');
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
    const input = { title: title.trim(), dueDate: dueDate || undefined, priority, taskTabId: taskTabId || undefined, parentTaskId: parentTask?.id, headingId: headingId || undefined };
    const ok = editingTask ? await onUpdate(editingTask.id, input) : await onAdd(input);
    setSubmitting(false);
    if (!ok) return;
    setTitle('');
    setDueDate('');
    setPriority('normal');
    setTaskTabId('');
    setHeadingId('');
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
    setHeadingId(task.headingId ?? '');
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

  const openHeadingDialog = (mode: 'create' | 'rename' | 'delete', selected?: JobTaskHeading) => {
    setSelectedHeading(selected ?? null);
    setHeadingName(selected?.name ?? '');
    setHeadingError('');
    setHeadingDialog(mode);
  };

  const saveHeading = async () => {
    if (!headingName.trim()) return setHeadingError('Heading name is required.');
    const result = headingDialog === 'rename' && selectedHeading && onRenameHeading
      ? await onRenameHeading(selectedHeading.id, headingName.trim())
      : onAddHeading ? await onAddHeading(headingName.trim()) : { ok: false, error: 'Heading changes are unavailable.' };
    if (!result.ok) return setHeadingError(result.error ?? 'Heading could not be saved.');
    setHeadingDialog(null);
  };

  const deleteHeading = async () => {
    if (!selectedHeading || !onDeleteHeading) return;
    const result = await onDeleteHeading(selectedHeading.id);
    if (!result.ok) return setHeadingError(result.error ?? 'Heading could not be deleted.');
    setHeadingDialog(null);
  };

  const moveHeading = (targetId: string) => {
    if (!draggedHeadingId || !jobTaskHeadings || !onReorderHeadings || draggedHeadingId === targetId) return;
    const orderedIds = jobTaskHeadings.map((item) => item.id);
    const fromIndex = orderedIds.indexOf(draggedHeadingId);
    const targetIndex = orderedIds.indexOf(targetId);
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(targetIndex, 0, draggedHeadingId);
    void onReorderHeadings(orderedIds);
  };

  return (
    <Card id="outstanding-tasks" className="overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 px-4 py-3 dark:border-brand-600">
        <div>
          <h2 className="font-semibold text-brand-900 dark:text-brand-50">{heading}</h2>
          <p className="mt-0.5 text-xs text-brand-400 dark:text-brand-300">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {jobTaskHeadings && canManageJobTaskHeadings ? <Button size="sm" variant="secondary" onClick={() => openHeadingDialog('create')}><Plus />Add Heading</Button> : null}
          <Button size="sm" onClick={() => { if (adding) { setAdding(false); setEditingTask(null); setParentTask(null); } else openAdd(); }}>{adding ? <X /> : <Plus />}{adding ? 'Cancel' : 'Add task'}</Button>
        </div>
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
          <div className={`grid gap-2 ${jobTaskHeadings ? 'sm:grid-cols-[minmax(0,1fr)_10rem_8rem_11rem_11rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_10rem_8rem_11rem_auto]'}`}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs doing?" aria-label="Task title" />
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" />
            <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} aria-label="Priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select>
            <Select value={taskTabId} onChange={(event) => setTaskTabId(event.target.value)} aria-label="Task Tab / Category"><option value="">No category</option>{customTaskTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</Select>
            {jobTaskHeadings ? <Select value={headingId} onChange={(event) => setHeadingId(event.target.value)} aria-label="Heading"><option value="">Uncategorized</option>{jobTaskHeadings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}
            <Button onClick={() => void submit()} disabled={!title.trim() || submitting}>{submitting ? 'Saving...' : editingTask ? 'Save' : parentTask ? 'Add subtask' : 'Add'}</Button>
          </div>
        </div>
      ) : null}

      {jobTaskHeadings ? (
        <div className="divide-y divide-brand-100 dark:divide-brand-600">
          {jobTaskHeadings.map((section) => { const sectionTasks = visibleTasks.filter((task) => task.headingId === section.id); return (
            <section key={section.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { moveHeading(section.id); setDraggedHeadingId(null); }}>
              <div className="group flex items-center gap-2 bg-brand-50/40 px-4 py-2.5 dark:bg-brand-800/20">
                {canManageJobTaskHeadings ? <button type="button" draggable onDragStart={() => setDraggedHeadingId(section.id)} onDragEnd={() => setDraggedHeadingId(null)} aria-label={`Reorder ${section.name}`} className="cursor-grab text-brand-300 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><Rows3 size={15} /></button> : <span className="w-[15px]" />}
                <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-brand-900 dark:text-brand-50">{section.name}</h3><p className="text-xs text-brand-400">{sectionTasks.length} {filter === 'completed' ? 'completed' : 'open'} {sectionTasks.length === 1 ? 'task' : 'tasks'}</p></div>
                <button type="button" onClick={() => openAdd(section.id)} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-200"><Plus size={13} className="inline" /> Add task</button>
                {canManageJobTaskHeadings ? <button type="button" onClick={() => openHeadingDialog('rename', section)} aria-label={`Rename ${section.name}`} className="grid h-8 w-8 place-items-center text-brand-400 hover:text-brand-700"><Pencil size={14} /></button> : null}
                {canManageJobTaskHeadings ? <button type="button" onClick={() => openHeadingDialog('delete', section)} aria-label={`Delete ${section.name}`} className="grid h-8 w-8 place-items-center text-brand-400 hover:text-accent-700"><Trash2 size={14} /></button> : null}
              </div>
              {sectionTasks.length ? <ul className="divide-y divide-brand-100 dark:divide-brand-600">{sectionTasks.map((task) => { const subtasks = allTasks.filter((item) => item.parentTaskId === task.id); const completedCount = subtasks.filter((item) => item.status === 'completed').length; return (
                <li key={task.id}><div className="flex items-start gap-3 px-4 py-3"><button type="button" onClick={() => void onToggle(task)} className="mt-0.5 text-brand-700" aria-label={task.status === 'completed' ? 'Mark task open' : 'Mark task complete'}>{task.status === 'completed' ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button><div className="min-w-0 flex-1"><p className={`text-sm font-medium ${task.status === 'completed' ? 'text-brand-400 line-through' : 'text-brand-900'}`}>{task.title}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-400"><span>{task.dueDate ? `Due ${task.dueDate}` : 'No due date'}</span><Badge label={task.priority ?? 'normal'} className={priorityTone(task.priority)} />{subtasks.length ? <span>{completedCount} of {subtasks.length} subtasks complete</span> : null}</div></div>{task.status === 'open' ? <button type="button" onClick={() => openAddSubtask(task)} className="grid h-8 w-8 place-items-center text-brand-400" aria-label={`Add subtask to ${task.title}`}><ListPlus size={16} /></button> : null}<button type="button" onClick={() => openEditTask(task)} className="grid h-8 w-8 place-items-center text-brand-400" aria-label={`Edit ${task.title}`}><Pencil size={15} /></button><button type="button" onClick={() => void onDelete(task.id)} className="grid h-8 w-8 place-items-center text-brand-400 hover:text-accent-700" aria-label={`Remove ${task.title}`}><X size={15} /></button></div>
                {subtasks.length ? <ul className="border-t border-brand-50 bg-brand-50/40 px-4 py-1">{subtasks.map((subtask) => <li key={subtask.id} className="ml-6 flex items-center gap-3 border-l-2 border-brand-100 px-3 py-2"><button type="button" onClick={() => void onToggle(subtask)} className="text-brand-600" aria-label={subtask.status === 'completed' ? 'Mark subtask open' : 'Mark subtask complete'}>{subtask.status === 'completed' ? <CheckCircle2 size={16} /> : <Circle size={16} />}</button><p className={`min-w-0 flex-1 text-sm ${subtask.status === 'completed' ? 'text-brand-400 line-through' : 'text-brand-800'}`}>{subtask.title}</p><button type="button" onClick={() => openEditTask(subtask)} aria-label={`Edit ${subtask.title}`}><Pencil size={14} /></button><button type="button" onClick={() => void onDelete(subtask.id)} aria-label={`Remove ${subtask.title}`}><X size={14} /></button></li>)}</ul> : null}
                </li>
              ); })}</ul> : <p className="px-10 py-3 text-xs text-brand-400">No {filter === 'completed' ? 'completed' : 'open'} tasks in this section.</p>}
            </section>
          ); })}
          {(() => { const uncategorized = visibleTasks.filter((task) => !task.headingId || !jobTaskHeadings.some((section) => section.id === task.headingId)); return uncategorized.length ? <section><div className="bg-brand-50/40 px-10 py-2.5"><h3 className="text-sm font-semibold text-brand-900">Uncategorized</h3><p className="text-xs text-brand-400">{uncategorized.length} {filter === 'completed' ? 'completed' : 'open'} {uncategorized.length === 1 ? 'task' : 'tasks'}</p></div><ul>{uncategorized.map((task) => <li key={task.id} className="flex items-start gap-3 border-t border-brand-100 px-4 py-3"><button type="button" onClick={() => void onToggle(task)} className="mt-0.5 text-brand-700" aria-label={task.status === 'completed' ? 'Mark task open' : 'Mark task complete'}>{task.status === 'completed' ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button><p className={`min-w-0 flex-1 text-sm font-medium ${task.status === 'completed' ? 'text-brand-400 line-through' : 'text-brand-900'}`}>{task.title}</p><button type="button" onClick={() => openEditTask(task)} aria-label={`Edit ${task.title}`}><Pencil size={15} /></button><button type="button" onClick={() => void onDelete(task.id)} aria-label={`Remove ${task.title}`}><X size={15} /></button></li>)}</ul></section> : null; })()}
          {jobTaskHeadings.length === 0 && visibleTasks.length === 0 ? <EmptyState icon={<ClipboardList />} title="No job tasks yet" description="Create a heading or add your first task." /> : null}
        </div>
      ) : visibleTasks.length === 0 ? <EmptyState icon={<ClipboardList />} title="Nothing here" description={filter === 'completed' ? 'Completed tasks will appear here.' : 'You are clear for this view.'} /> : (
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
      <Modal open={headingDialog === 'create' || headingDialog === 'rename'} onClose={() => setHeadingDialog(null)} title={headingDialog === 'rename' ? 'Rename Heading' : 'Add Heading'} footer={<><Button variant="secondary" onClick={() => setHeadingDialog(null)}>Cancel</Button><Button onClick={() => void saveHeading()}>{headingDialog === 'rename' ? 'Save' : 'Add Heading'}</Button></>}><Input autoFocus label="Heading Name" maxLength={80} value={headingName} onChange={(event) => { setHeadingName(event.target.value); setHeadingError(''); }} error={headingError} /></Modal>
      <Modal open={headingDialog === 'delete'} onClose={() => setHeadingDialog(null)} title={`Delete "${selectedHeading?.name ?? ''}"?`} footer={<><Button variant="secondary" onClick={() => setHeadingDialog(null)}>Cancel</Button><Button variant="danger" onClick={() => void deleteHeading()}>{allTasks.some((task) => task.headingId === selectedHeading?.id) ? 'Move tasks to Uncategorized and delete' : 'Delete Heading'}</Button></>}>{allTasks.some((task) => task.headingId === selectedHeading?.id) ? <p className="text-sm text-brand-500">This heading contains {allTasks.filter((task) => task.headingId === selectedHeading?.id).length} tasks. Its tasks will move to Uncategorized and will not be deleted.</p> : <p className="text-sm text-brand-500">This empty heading will be deleted.</p>}{headingError ? <p className="mt-2 text-sm text-accent-700">{headingError}</p> : null}</Modal>
    </Card>
  );
}
