import { useEffect, useState } from 'react';
import type { HomeTaskFilter } from './homeDashboardModel.js';
import type { TaskTab } from '../../types';

export const PERSONAL_HOME_WIDGET_IDS = [
  'due-today',
  'overdue',
  'jobs-week',
  'hours-today',
  'calendar',
  'mini-calendar',
  'tasks',
  'upcoming',
  'activity',
  'quick-actions',
] as const;

export const FINANCE_HOME_WIDGET_IDS = [
  'finance-outstanding-invoices',
  'finance-overdue-invoices',
  'finance-budget-profit',
] as const;

export type HomeWidgetId = typeof PERSONAL_HOME_WIDGET_IDS[number] | typeof FINANCE_HOME_WIDGET_IDS[number];

export const DEFAULT_TASK_FILTER_LABELS: Record<HomeTaskFilter, string> = {
  all: 'Open',
  today: 'Today',
  overdue: 'Overdue',
  week: 'This week',
  completed: 'Completed',
};

export const DEFAULT_TASK_FILTER_ORDER: HomeTaskFilter[] = ['all', 'today', 'overdue', 'week', 'completed'];

const allowedWidgetIds = (canViewFinancials: boolean): HomeWidgetId[] => canViewFinancials
  ? [...PERSONAL_HOME_WIDGET_IDS, ...FINANCE_HOME_WIDGET_IDS]
  : [...PERSONAL_HOME_WIDGET_IDS];

const normalizeWidgetIds = (value: unknown, canViewFinancials: boolean): HomeWidgetId[] => {
  const allowed = new Set<HomeWidgetId>(allowedWidgetIds(canViewFinancials));
  const source: unknown[] = Array.isArray(value) ? value : [...PERSONAL_HOME_WIDGET_IDS];
  return source.filter((id, index): id is HomeWidgetId => typeof id === 'string' && allowed.has(id as HomeWidgetId) && source.indexOf(id) === index);
};

const normalizeCustomTaskTabs = (value: unknown): TaskTab[] => Array.isArray(value) ? value.filter((tab): tab is TaskTab => (
  Boolean(tab) && typeof tab.id === 'string' && typeof tab.name === 'string' && typeof tab.sortOrder === 'number' && typeof tab.createdAt === 'string'
)) : [];

const normalizeTaskFilterOrder = (value: unknown, customTaskTabs: TaskTab[]): string[] => {
  const requested = Array.isArray(value) ? value : [];
  const defaults = [...DEFAULT_TASK_FILTER_ORDER, ...customTaskTabs.map((tab) => tab.id)];
  const allowed = new Set(defaults);
  return [...requested, ...defaults].filter((id, index, values): id is string => (
    typeof id === 'string' && allowed.has(id) && values.indexOf(id) === index
  ));
};

export default function useHomeDashboardPreferences(canViewFinancials: boolean) {
  const [widgetIds, setWidgetIds] = useState<HomeWidgetId[]>(() => [...PERSONAL_HOME_WIDGET_IDS]);
  const [taskFilterLabels, setTaskFilterLabels] = useState<Record<HomeTaskFilter, string>>(DEFAULT_TASK_FILTER_LABELS);
  const [customTaskTabs, setCustomTaskTabs] = useState<TaskTab[]>([]);
  const [taskFilterOrder, setTaskFilterOrder] = useState<string[]>(DEFAULT_TASK_FILTER_ORDER);
  const [dismissedTodayTaskIds, setDismissedTodayTaskIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/home-dashboard-preferences', { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; preferences?: { widgetIds?: unknown; taskFilterLabels?: Partial<Record<HomeTaskFilter, string>>; customTaskTabs?: unknown; taskFilterOrder?: unknown; dismissedTodayTaskIds?: unknown } } }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) return;
        setWidgetIds(normalizeWidgetIds(payload.preferences?.widgetIds, canViewFinancials));
        setTaskFilterLabels({ ...DEFAULT_TASK_FILTER_LABELS, ...payload.preferences?.taskFilterLabels, today: 'Today' });
        const nextCustomTabs = normalizeCustomTaskTabs(payload.preferences?.customTaskTabs);
        setCustomTaskTabs(nextCustomTabs);
        setTaskFilterOrder(normalizeTaskFilterOrder(payload.preferences?.taskFilterOrder, nextCustomTabs));
        setDismissedTodayTaskIds(Array.isArray(payload.preferences?.dismissedTodayTaskIds) ? payload.preferences.dismissedTodayTaskIds.filter((id): id is string => typeof id === 'string') : []);
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setWidgetIds([...PERSONAL_HOME_WIDGET_IDS]);
      })
      .finally(() => setHydrated(true));
    return () => controller.abort();
  }, [canViewFinancials]);

  const savePreferences = (nextWidgetIds: HomeWidgetId[], nextLabels: Record<HomeTaskFilter, string>, nextTabs: TaskTab[], nextOrder: string[], nextDismissedIds: string[], deletedTaskTabId?: string) => {
    void fetch('/api/home-dashboard-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ widgetIds: nextWidgetIds, taskFilterLabels: nextLabels, customTaskTabs: nextTabs, taskFilterOrder: nextOrder, dismissedTodayTaskIds: nextDismissedIds, deletedTaskTabId }),
    });
  };

  const saveWidgetIds = (nextValue: HomeWidgetId[]) => {
    const next = normalizeWidgetIds(nextValue, canViewFinancials);
    setWidgetIds(next);
    savePreferences(next, taskFilterLabels, customTaskTabs, taskFilterOrder, dismissedTodayTaskIds);
  };

  const saveTaskFilterLabel = (filter: HomeTaskFilter, value: string) => {
    if (filter === 'today') return;
    const label = value.trim().slice(0, 30) || DEFAULT_TASK_FILTER_LABELS[filter];
    const next = { ...taskFilterLabels, [filter]: label };
    setTaskFilterLabels(next);
    savePreferences(widgetIds, next, customTaskTabs, taskFilterOrder, dismissedTodayTaskIds);
  };

  const saveTaskFilterOrder = (value: string[]) => {
    const next = normalizeTaskFilterOrder(value, customTaskTabs);
    setTaskFilterOrder(next);
    savePreferences(widgetIds, taskFilterLabels, customTaskTabs, next, dismissedTodayTaskIds);
  };

  const createCustomTaskTab = (value: string) => {
    const name = value.trim().slice(0, 30);
    if (!name) return { ok: false, error: 'Enter a tab name.' };
    if (customTaskTabs.some((tab) => tab.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'A tab with this name already exists.' };
    const tab: TaskTab = { id: `task-tab-${crypto.randomUUID()}`, name, sortOrder: customTaskTabs.length, createdAt: new Date().toISOString() };
    const nextTabs = [...customTaskTabs, tab];
    const nextOrder = [...taskFilterOrder, tab.id];
    setCustomTaskTabs(nextTabs);
    setTaskFilterOrder(nextOrder);
    savePreferences(widgetIds, taskFilterLabels, nextTabs, nextOrder, dismissedTodayTaskIds);
    return { ok: true, tab };
  };

  const renameCustomTaskTab = (id: string, value: string) => {
    const name = value.trim().slice(0, 30);
    if (!name) return { ok: false, error: 'Enter a tab name.' };
    if (customTaskTabs.some((tab) => tab.id !== id && tab.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'A tab with this name already exists.' };
    const nextTabs = customTaskTabs.map((tab) => tab.id === id ? { ...tab, name } : tab);
    if (!nextTabs.some((tab) => tab.id === id)) return { ok: false, error: 'Task tab not found.' };
    setCustomTaskTabs(nextTabs);
    savePreferences(widgetIds, taskFilterLabels, nextTabs, taskFilterOrder, dismissedTodayTaskIds);
    return { ok: true };
  };

  const deleteCustomTaskTab = (id: string) => {
    const nextTabs = customTaskTabs.filter((tab) => tab.id !== id).map((tab, sortOrder) => ({ ...tab, sortOrder }));
    if (nextTabs.length === customTaskTabs.length) return false;
    const nextOrder = taskFilterOrder.filter((value) => value !== id);
    setCustomTaskTabs(nextTabs);
    setTaskFilterOrder(nextOrder);
    savePreferences(widgetIds, taskFilterLabels, nextTabs, nextOrder, dismissedTodayTaskIds, id);
    return true;
  };

  const dismissTodayTask = (taskId: string) => {
    const next = Array.from(new Set([...dismissedTodayTaskIds, taskId])).slice(-200);
    setDismissedTodayTaskIds(next);
    savePreferences(widgetIds, taskFilterLabels, customTaskTabs, taskFilterOrder, next);
  };

  const restoreTodayTask = (taskId: string) => {
    const next = dismissedTodayTaskIds.filter((id) => id !== taskId);
    setDismissedTodayTaskIds(next);
    savePreferences(widgetIds, taskFilterLabels, customTaskTabs, taskFilterOrder, next);
  };

  return {
    widgetIds,
    hydrated,
    availableWidgetIds: allowedWidgetIds(canViewFinancials),
    taskFilterLabels,
    customTaskTabs,
    taskFilterOrder,
    dismissedTodayTaskIds,
    saveWidgetIds,
    saveTaskFilterLabel,
    saveTaskFilterOrder,
    createCustomTaskTab,
    renameCustomTaskTab,
    deleteCustomTaskTab,
    dismissTodayTask,
    restoreTodayTask,
    resetWidgetIds: () => saveWidgetIds([...PERSONAL_HOME_WIDGET_IDS]),
  };
}
