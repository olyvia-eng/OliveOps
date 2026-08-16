import { useEffect, useState } from 'react';
import type { HomeTaskFilter } from './homeDashboardModel.js';

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

const normalizeTaskFilterOrder = (value: unknown): HomeTaskFilter[] => {
  const requested = Array.isArray(value) ? value : [];
  const allowed = new Set<HomeTaskFilter>(DEFAULT_TASK_FILTER_ORDER);
  return [...requested, ...DEFAULT_TASK_FILTER_ORDER].filter((id, index, values): id is HomeTaskFilter => (
    typeof id === 'string' && allowed.has(id as HomeTaskFilter) && values.indexOf(id) === index
  ));
};

export default function useHomeDashboardPreferences(canViewFinancials: boolean) {
  const [widgetIds, setWidgetIds] = useState<HomeWidgetId[]>(() => [...PERSONAL_HOME_WIDGET_IDS]);
  const [taskFilterLabels, setTaskFilterLabels] = useState<Record<HomeTaskFilter, string>>(DEFAULT_TASK_FILTER_LABELS);
  const [taskFilterOrder, setTaskFilterOrder] = useState<HomeTaskFilter[]>(DEFAULT_TASK_FILTER_ORDER);
  const [dismissedTodayTaskIds, setDismissedTodayTaskIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/home-dashboard-preferences', { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; preferences?: { widgetIds?: unknown; taskFilterLabels?: Partial<Record<HomeTaskFilter, string>>; taskFilterOrder?: unknown; dismissedTodayTaskIds?: unknown } } }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) return;
        setWidgetIds(normalizeWidgetIds(payload.preferences?.widgetIds, canViewFinancials));
        setTaskFilterLabels({ ...DEFAULT_TASK_FILTER_LABELS, ...payload.preferences?.taskFilterLabels, today: 'Today' });
        setTaskFilterOrder(normalizeTaskFilterOrder(payload.preferences?.taskFilterOrder));
        setDismissedTodayTaskIds(Array.isArray(payload.preferences?.dismissedTodayTaskIds) ? payload.preferences.dismissedTodayTaskIds.filter((id): id is string => typeof id === 'string') : []);
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setWidgetIds([...PERSONAL_HOME_WIDGET_IDS]);
      })
      .finally(() => setHydrated(true));
    return () => controller.abort();
  }, [canViewFinancials]);

  const savePreferences = (nextWidgetIds: HomeWidgetId[], nextLabels: Record<HomeTaskFilter, string>, nextOrder: HomeTaskFilter[], nextDismissedIds: string[]) => {
    void fetch('/api/home-dashboard-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ widgetIds: nextWidgetIds, taskFilterLabels: nextLabels, taskFilterOrder: nextOrder, dismissedTodayTaskIds: nextDismissedIds }),
    });
  };

  const saveWidgetIds = (nextValue: HomeWidgetId[]) => {
    const next = normalizeWidgetIds(nextValue, canViewFinancials);
    setWidgetIds(next);
    savePreferences(next, taskFilterLabels, taskFilterOrder, dismissedTodayTaskIds);
  };

  const saveTaskFilterLabel = (filter: HomeTaskFilter, value: string) => {
    if (filter === 'today') return;
    const label = value.trim().slice(0, 30) || DEFAULT_TASK_FILTER_LABELS[filter];
    const next = { ...taskFilterLabels, [filter]: label };
    setTaskFilterLabels(next);
    savePreferences(widgetIds, next, taskFilterOrder, dismissedTodayTaskIds);
  };

  const saveTaskFilterOrder = (value: HomeTaskFilter[]) => {
    const next = normalizeTaskFilterOrder(value);
    setTaskFilterOrder(next);
    savePreferences(widgetIds, taskFilterLabels, next, dismissedTodayTaskIds);
  };

  const dismissTodayTask = (taskId: string) => {
    const next = Array.from(new Set([...dismissedTodayTaskIds, taskId])).slice(-200);
    setDismissedTodayTaskIds(next);
    savePreferences(widgetIds, taskFilterLabels, taskFilterOrder, next);
  };

  const restoreTodayTask = (taskId: string) => {
    const next = dismissedTodayTaskIds.filter((id) => id !== taskId);
    setDismissedTodayTaskIds(next);
    savePreferences(widgetIds, taskFilterLabels, taskFilterOrder, next);
  };

  return {
    widgetIds,
    hydrated,
    availableWidgetIds: allowedWidgetIds(canViewFinancials),
    taskFilterLabels,
    taskFilterOrder,
    dismissedTodayTaskIds,
    saveWidgetIds,
    saveTaskFilterLabel,
    saveTaskFilterOrder,
    dismissTodayTask,
    restoreTodayTask,
    resetWidgetIds: () => saveWidgetIds([...PERSONAL_HOME_WIDGET_IDS]),
  };
}
