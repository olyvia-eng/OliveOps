import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, ClipboardList, EllipsisVertical, ListPlus, Pencil, Plus, X } from 'lucide-react';
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
  const [activeHeadingId, setActiveHeadingId] = useState('general');
  const [moveHeadingTasksTo, setMoveHeadingTasksTo] = useState('general');
  const [deleteHeadingTasks, setDeleteHeadingTasks] = useState(false);
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);
  const [draggedHeadingId, setDraggedHeadingId] = useState<string | null>(null);
  const [completedTasksExpanded, setCompletedTasksExpanded] = useState(false);
  const visibleTasks = expanded ? tasks : tasks.slice(0, 5);
  const activeHeading = jobTaskHeadings?.find((item) => item.id === activeHeadingId) ?? null;

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
    setMoveHeadingTasksTo('general');
    setDeleteHeadingTasks(false);
    setHeadingMenuOpen(false);
    setHeadingDialog(mode);
  };

  const saveHeading = async () => {
    if (!headingName.trim()) return setHeadingError('Heading name is required.');
    const result: { ok: boolean; heading?: JobTaskHeading; error?: string } = headingDialog === 'rename' && selectedHeading && onRenameHeading
      ? await onRenameHeading(selectedHeading.id, headingName.trim())
      : onAddHeading ? await onAddHeading(headingName.trim()) : { ok: false, error: 'Heading changes are unavailable.' };
    if (!result.ok) return setHeadingError(result.error ?? 'Heading could not be saved.');
    setHeadingDialog(null);
    if (result.heading) setActiveHeadingId(result.heading.id);
  };

  const deleteHeading = async () => {
    if (!selectedHeading || !onDeleteHeading) return;
    const affectedTasks = allTasks.filter((task) => task.headingId === selectedHeading.id);
    if (affectedTasks.length > 0 && deleteHeadingTasks) {
      for (const task of affectedTasks) await onDelete(task.id);
    } else if (affectedTasks.length > 0) {
      for (const task of affectedTasks) {
        const result = await onUpdate(task.id, {
          title: task.title,
          dueDate: task.dueDate,
          priority: task.priority ?? 'normal',
          taskTabId: task.taskTabId,
          headingId: moveHeadingTasksTo,
        });
        if (!result) return setHeadingError('Tasks could not be moved. The tab was not deleted.');
      }
    }
    const result = await onDeleteHeading(selectedHeading.id);
    if (!result.ok) return setHeadingError(result.error ?? 'Heading could not be deleted.');
    if (activeHeadingId === selectedHeading.id) setActiveHeadingId(moveHeadingTasksTo);
    setHeadingDialog(null);
  };

  const moveHeading = (headingId: string, offset: -1 | 1) => {
    if (!jobTaskHeadings || !onReorderHeadings) return;
    const orderedIds = jobTaskHeadings.map((item) => item.id);
    const fromIndex = orderedIds.indexOf(headingId);
    const targetIndex = fromIndex + offset;
    if (fromIndex < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) return;
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(targetIndex, 0, headingId);
    void onReorderHeadings(orderedIds);
  };

  const moveHeadingTo = (headingId: string, targetId: string) => {
    if (!jobTaskHeadings || !onReorderHeadings || headingId === targetId) return;
    const orderedIds = jobTaskHeadings.map((item) => item.id);
    const fromIndex = orderedIds.indexOf(headingId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(targetIndex, 0, headingId);
    void onReorderHeadings(orderedIds);
  };

  useEffect(() => {
    if (activeHeadingId !== 'general' && !jobTaskHeadings?.some((item) => item.id === activeHeadingId)) {
      setActiveHeadingId('general');
    }
  }, [activeHeadingId, jobTaskHeadings]);

  useEffect(() => {
    setCompletedTasksExpanded(false);
    setHeadingMenuOpen(false);
  }, [activeHeadingId]);

  const renderJobTaskList = (items: Task[]) => <ul className="divide-y divide-brand-100 dark:divide-brand-600">{items.map((task) => {
    const subtasks = allTasks.filter((item) => item.parentTaskId === task.id);
    const completedCount = subtasks.filter((item) => item.status === 'completed').length;
    return <li key={task.id}><div className="flex items-start gap-3 px-4 py-3"><button type="button" onClick={() => void onToggle(task)} className="mt-0.5 text-brand-700" aria-label={task.status === 'completed' ? 'Mark task open' : 'Mark task complete'}>{task.status === 'completed' ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button><div className="min-w-0 flex-1"><p className={`text-sm font-medium ${task.status === 'completed' ? 'text-brand-400 line-through' : 'text-brand-900'}`}>{task.title}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-400"><span>{task.dueDate ? `Due ${task.dueDate}` : 'No due date'}</span><Badge label={task.priority ?? 'normal'} className={priorityTone(task.priority)} />{subtasks.length ? <span>{completedCount} of {subtasks.length} subtasks complete</span> : null}</div></div>{task.status === 'open' ? <button type="button" onClick={() => openAddSubtask(task)} className="grid h-8 w-8 place-items-center text-brand-400" aria-label={`Add subtask to ${task.title}`}><ListPlus size={16} /></button> : null}<button type="button" onClick={() => openEditTask(task)} className="grid h-8 w-8 place-items-center text-brand-400" aria-label={`Edit ${task.title}`}><Pencil size={15} /></button><button type="button" onClick={() => void onDelete(task.id)} className="grid h-8 w-8 place-items-center text-brand-400 hover:text-accent-700" aria-label={`Remove ${task.title}`}><X size={15} /></button></div>
      {subtasks.length ? <ul className="border-t border-brand-50 bg-brand-50/40 px-4 py-1">{subtasks.map((subtask) => <li key={subtask.id} className="ml-6 flex items-center gap-3 border-l-2 border-brand-100 px-3 py-2"><button type="button" onClick={() => void onToggle(subtask)} className="text-brand-600" aria-label={subtask.status === 'completed' ? 'Mark subtask open' : 'Mark subtask complete'}>{subtask.status === 'completed' ? <CheckCircle2 size={16} /> : <Circle size={16} />}</button><p className={`min-w-0 flex-1 text-sm ${subtask.status === 'completed' ? 'text-brand-400 line-through' : 'text-brand-800'}`}>{subtask.title}</p><button type="button" onClick={() => openEditTask(subtask)} aria-label={`Edit ${subtask.title}`}><Pencil size={14} /></button><button type="button" onClick={() => void onDelete(subtask.id)} aria-label={`Remove ${subtask.title}`}><X size={14} /></button></li>)}</ul> : null}
    </li>;
  })}</ul>;

  return (
    <Card id="outstanding-tasks" className="overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 px-4 py-3 dark:border-brand-600">
        <div>
          <h2 className="font-semibold text-brand-900 dark:text-brand-50">{heading}</h2>
          <p className="mt-0.5 text-xs text-brand-400 dark:text-brand-300">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {jobTaskHeadings && canManageJobTaskHeadings ? <Button size="sm" variant="secondary" onClick={() => openHeadingDialog('create')}><Plus />Add Tab</Button> : null}
          <Button size="sm" onClick={() => { if (adding) { setAdding(false); setEditingTask(null); setParentTask(null); } else openAdd(jobTaskHeadings && activeHeadingId !== 'general' ? activeHeadingId : ''); }}>{adding ? <X /> : <Plus />}{adding ? 'Cancel' : 'Add Task'}</Button>
        </div>
      </div>

      {jobTaskHeadings ? <div className="flex items-center gap-1 overflow-x-auto border-b border-brand-100 px-3 py-2 dark:border-brand-600" role="tablist" aria-label="Job task tabs">
        {[{ id: 'general', name: 'General' }, ...jobTaskHeadings].map((tab) => {
          const openCount = allTasks.filter((task) => !task.parentTaskId && task.status === 'open' && (tab.id === 'general' ? !task.headingId || !jobTaskHeadings.some((item) => item.id === task.headingId) : task.headingId === tab.id)).length;
          const persisted = tab.id !== 'general';
          const selected = activeHeadingId === tab.id;
          return <div key={tab.id} draggable={persisted && canManageJobTaskHeadings} onDragStart={() => setDraggedHeadingId(persisted ? tab.id : null)} onDragEnd={() => setDraggedHeadingId(null)} onDragOver={(event) => { if (persisted) event.preventDefault(); }} onDrop={() => { if (persisted && draggedHeadingId) moveHeadingTo(draggedHeadingId, tab.id); setDraggedHeadingId(null); }} className="flex shrink-0 items-center rounded-md border border-transparent data-[active=true]:border-brand-200 data-[active=true]:bg-brand-50" data-active={selected}>
            <button type="button" role="tab" aria-selected={selected} aria-controls="job-task-tab-panel" onClick={() => setActiveHeadingId(tab.id)} className="flex h-9 max-w-56 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-semibold text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:text-brand-100">
              <span className="truncate">{tab.name}</span><span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] text-brand-600" aria-label={`${openCount} open tasks`}>{openCount}</span>
            </button>
            {selected && persisted && canManageJobTaskHeadings ? <button type="button" aria-label={`Manage ${tab.name} tab`} aria-haspopup="menu" aria-expanded={headingMenuOpen} onClick={() => setHeadingMenuOpen((open) => !open)} className="mr-1 grid h-7 w-7 place-items-center rounded text-brand-500 hover:bg-white hover:text-brand-800"><EllipsisVertical size={15} /></button> : null}
          </div>;
        })}
      </div> : null}
      {headingMenuOpen && activeHeading && jobTaskHeadings ? <div role="menu" aria-label={`Manage ${activeHeading.name} tab`} className="flex flex-wrap justify-end gap-1 border-b border-brand-100 bg-brand-50/60 px-3 py-2"><button type="button" role="menuitem" onClick={() => openHeadingDialog('rename', activeHeading)} className="rounded px-3 py-2 text-xs hover:bg-white">Rename tab</button><button type="button" role="menuitem" disabled={jobTaskHeadings[0]?.id === activeHeading.id} onClick={() => { moveHeading(activeHeading.id, -1); setHeadingMenuOpen(false); }} className="flex items-center gap-2 rounded px-3 py-2 text-xs hover:bg-white disabled:opacity-40"><ChevronLeft size={13} />Move left</button><button type="button" role="menuitem" disabled={jobTaskHeadings.at(-1)?.id === activeHeading.id} onClick={() => { moveHeading(activeHeading.id, 1); setHeadingMenuOpen(false); }} className="flex items-center gap-2 rounded px-3 py-2 text-xs hover:bg-white disabled:opacity-40"><ChevronRight size={13} />Move right</button><button type="button" role="menuitem" onClick={() => openHeadingDialog('delete', activeHeading)} className="rounded px-3 py-2 text-xs text-accent-700 hover:bg-accent-50">Delete tab</button></div> : null}

      {!jobTaskHeadings ? <div className="flex gap-1 overflow-x-auto border-b border-brand-100 px-3 py-2 dark:border-brand-600" aria-label="Task filters">
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
      </div> : null}

      {adding ? (
        <div className="border-b border-brand-100 bg-brand-50/60 p-4 dark:border-brand-600 dark:bg-brand-800/30">
          {parentTask ? <p className="mb-2 text-xs font-semibold text-brand-600 dark:text-brand-200">Subtask of {parentTask.title}</p> : null}
          <div className={`grid gap-2 ${jobTaskHeadings ? 'sm:grid-cols-[minmax(0,1fr)_10rem_8rem_11rem_11rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_10rem_8rem_11rem_auto]'}`}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs doing?" aria-label="Task title" />
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" />
            <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} aria-label="Priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select>
            <Select value={taskTabId} onChange={(event) => setTaskTabId(event.target.value)} aria-label="Task Tab / Category"><option value="">No category</option>{customTaskTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</Select>
            {jobTaskHeadings ? <Select value={headingId} onChange={(event) => setHeadingId(event.target.value)} aria-label="Task tab"><option value="">General</option>{jobTaskHeadings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}
            <Button onClick={() => void submit()} disabled={!title.trim() || submitting}>{submitting ? 'Saving...' : editingTask ? 'Save' : parentTask ? 'Add subtask' : 'Add'}</Button>
          </div>
        </div>
      ) : null}

      {jobTaskHeadings ? (
        <div id="job-task-tab-panel" role="tabpanel">
          {(() => {
            const sectionTasks = allTasks.filter((task) => !task.parentTaskId && (activeHeadingId === 'general' ? !task.headingId || !jobTaskHeadings.some((section) => section.id === task.headingId) : task.headingId === activeHeadingId));
            const openTasks = sectionTasks.filter((task) => task.status === 'open');
            const completedTasks = sectionTasks.filter((task) => task.status === 'completed');
            return <>{openTasks.length ? renderJobTaskList(openTasks) : <p className="px-4 py-3 text-sm text-brand-400">No open tasks in this tab.</p>}{completedTasks.length ? <div className="border-t border-brand-100"><button type="button" aria-expanded={completedTasksExpanded} onClick={() => setCompletedTasksExpanded((expanded) => !expanded)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-brand-600 hover:bg-brand-50"><span>Completed tasks ({completedTasks.length})</span><ChevronDown size={16} className={`transition-transform ${completedTasksExpanded ? 'rotate-180' : ''}`} /></button>{completedTasksExpanded ? renderJobTaskList(completedTasks) : null}</div> : null}</>;
          })()}
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
      <Modal open={headingDialog === 'create' || headingDialog === 'rename'} onClose={() => setHeadingDialog(null)} title={headingDialog === 'rename' ? 'Rename Task Tab' : 'Add Task Tab'} footer={<><Button variant="secondary" onClick={() => setHeadingDialog(null)}>Cancel</Button><Button onClick={() => void saveHeading()}>{headingDialog === 'rename' ? 'Save' : 'Add Tab'}</Button></>}><Input autoFocus label="Tab Name" maxLength={80} value={headingName} onChange={(event) => { setHeadingName(event.target.value); setHeadingError(''); }} error={headingError} /></Modal>
      <Modal open={headingDialog === 'delete'} onClose={() => setHeadingDialog(null)} title={`Delete "${selectedHeading?.name ?? ''}" tab?`} footer={<><Button variant="secondary" onClick={() => setHeadingDialog(null)}>Cancel</Button><Button variant="danger" onClick={() => void deleteHeading()}>{allTasks.some((task) => task.headingId === selectedHeading?.id) ? deleteHeadingTasks ? 'Delete Tasks and Tab' : 'Move Tasks and Delete Tab' : 'Delete Tab'}</Button></>}>{allTasks.some((task) => task.headingId === selectedHeading?.id) ? <div className="space-y-3"><p className="text-sm text-brand-500">This tab contains {allTasks.filter((task) => task.headingId === selectedHeading?.id).length} tasks. Choose what should happen to them.</p><label className="flex items-start gap-2 text-sm text-brand-700"><input type="radio" checked={!deleteHeadingTasks} onChange={() => setDeleteHeadingTasks(false)} />Move tasks to another tab</label>{!deleteHeadingTasks ? <Select label="Move tasks to" value={moveHeadingTasksTo} onChange={(event) => setMoveHeadingTasksTo(event.target.value)}><option value="general">General</option>{jobTaskHeadings?.filter((item) => item.id !== selectedHeading?.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}<label className="flex items-start gap-2 text-sm text-accent-700"><input type="radio" checked={deleteHeadingTasks} onChange={() => setDeleteHeadingTasks(true)} />Delete the tasks in this tab</label></div> : <p className="text-sm text-brand-500">This empty tab will be deleted. General always remains available.</p>}{headingError ? <p className="mt-2 text-sm text-accent-700">{headingError}</p> : null}</Modal>
    </Card>
  );
}
