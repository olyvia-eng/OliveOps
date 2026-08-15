import { useEffect, useState } from 'react';

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

const allowedWidgetIds = (canViewFinancials: boolean): HomeWidgetId[] => canViewFinancials
  ? [...PERSONAL_HOME_WIDGET_IDS, ...FINANCE_HOME_WIDGET_IDS]
  : [...PERSONAL_HOME_WIDGET_IDS];

const normalizeWidgetIds = (value: unknown, canViewFinancials: boolean): HomeWidgetId[] => {
  const allowed = new Set<HomeWidgetId>(allowedWidgetIds(canViewFinancials));
  const source: unknown[] = Array.isArray(value) ? value : [...PERSONAL_HOME_WIDGET_IDS];
  return source.filter((id, index): id is HomeWidgetId => typeof id === 'string' && allowed.has(id as HomeWidgetId) && source.indexOf(id) === index);
};

export default function useHomeDashboardPreferences(canViewFinancials: boolean) {
  const [widgetIds, setWidgetIds] = useState<HomeWidgetId[]>(() => [...PERSONAL_HOME_WIDGET_IDS]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/home-dashboard-preferences', { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; preferences?: { widgetIds?: unknown } } }))
      .then(({ response, payload }) => {
        if (response.ok && payload.ok) setWidgetIds(normalizeWidgetIds(payload.preferences?.widgetIds, canViewFinancials));
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setWidgetIds([...PERSONAL_HOME_WIDGET_IDS]);
      })
      .finally(() => setHydrated(true));
    return () => controller.abort();
  }, [canViewFinancials]);

  const saveWidgetIds = (nextValue: HomeWidgetId[]) => {
    const next = normalizeWidgetIds(nextValue, canViewFinancials);
    setWidgetIds(next);
    void fetch('/api/home-dashboard-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ widgetIds: next }),
    });
  };

  return {
    widgetIds,
    hydrated,
    availableWidgetIds: allowedWidgetIds(canViewFinancials),
    saveWidgetIds,
    resetWidgetIds: () => saveWidgetIds([...PERSONAL_HOME_WIDGET_IDS]),
  };
}
