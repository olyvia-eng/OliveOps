import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TimeEntry } from '../types';

interface TimeEntryPageOptions {
  surface: 'reports' | 'job';
  defaultPageSize: number;
  filters: Record<string, string | boolean | undefined>;
  enabled?: boolean;
}

interface TimeEntryPagePayload {
  ok: boolean;
  items?: TimeEntry[];
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
}

async function readPayload(response: Response): Promise<TimeEntryPagePayload> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return { ok: false, error: 'The server returned an invalid response.' };
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || typeof (payload as { ok?: unknown }).ok !== 'boolean') {
    return { ok: false, error: 'The server returned an invalid response.' };
  }
  return payload as TimeEntryPagePayload;
}

export function useTimeEntryPage({ surface, defaultPageSize, filters, enabled = true }: TimeEntryPageOptions) {
  const [items, setItems] = useState<TimeEntry[]>([]);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const requestSequence = useRef(0);
  const activeRequest = useRef<{ key: string; controller: AbortController } | null>(null);
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams({ surface });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
    }
    return params.toString();
  }, [filters, surface]);

  useEffect(() => {
    setCursorHistory([null]);
    setPageIndex(0);
    setNextCursor(null);
  }, [filterQuery, pageSize]);

  useEffect(() => {
    if (!enabled) {
      activeRequest.current?.controller.abort();
      setLoading(false);
      return;
    }
    const cursor = cursorHistory[pageIndex] ?? null;
    const requestKey = `${filterQuery}&limit=${pageSize}&cursor=${cursor ?? ''}`;
    if (activeRequest.current?.key === requestKey && !activeRequest.current.controller.signal.aborted) return;

    activeRequest.current?.controller.abort();
    const controller = new AbortController();
    activeRequest.current = { key: requestKey, controller };
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    setNextCursor(null);

    const params = new URLSearchParams(filterQuery);
    params.set('limit', String(pageSize));
    if (cursor) params.set('cursor', cursor);
    void fetch(`/api/time-entries?${params.toString()}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await readPayload(response) }))
      .then(({ response, payload }) => {
        if (sequence !== requestSequence.current || controller.signal.aborted) return;
        if (!response.ok || !payload.ok || !Array.isArray(payload.items)) {
          setError(payload.error ?? 'Could not load Time Entries. Retry this page.');
          return;
        }
        setItems(payload.items);
        setNextCursor(payload.hasMore ? payload.nextCursor ?? null : null);
        setLoadedVersion((value) => value + 1);
      })
      .catch((reason: unknown) => {
        if (sequence !== requestSequence.current || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Could not load Time Entries. Retry this page.');
      })
      .finally(() => {
        if (sequence === requestSequence.current && !controller.signal.aborted) {
          activeRequest.current = null;
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [cursorHistory, enabled, filterQuery, pageIndex, pageSize, refreshVersion]);

  const next = useCallback(() => {
    if (!nextCursor || loading) return;
    setCursorHistory((history) => [...history.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex(pageIndex + 1);
    setNavigationVersion((value) => value + 1);
  }, [loading, nextCursor, pageIndex]);
  const previous = useCallback(() => {
    if (pageIndex === 0 || loading) return;
    setPageIndex(pageIndex - 1);
    setNavigationVersion((value) => value + 1);
  }, [loading, pageIndex]);
  const setPageSize = useCallback((value: number) => setPageSizeState(value), []);
  const refresh = useCallback(() => {
    setCursorHistory([null]);
    setPageIndex(0);
    setNextCursor(null);
    setRefreshVersion((value) => value + 1);
  }, []);
  const removeAfterDelete = useCallback((timeEntryId: string) => {
    setItems((current) => current.filter((entry) => entry.id !== timeEntryId));
    if (items.length === 1 && pageIndex > 0) {
      setPageIndex((current) => current - 1);
      setNavigationVersion((value) => value + 1);
      return;
    }
    setRefreshVersion((value) => value + 1);
  }, [items.length, pageIndex]);

  return {
    items,
    pageSize,
    pageIndex,
    hasNext: Boolean(nextCursor),
    hasPrevious: pageIndex > 0,
    loading,
    error,
    loadedVersion,
    navigationVersion,
    showingStart: items.length > 0 ? pageIndex * pageSize + 1 : 0,
    showingEnd: pageIndex * pageSize + items.length,
    next,
    previous,
    setPageSize,
    refresh,
    removeAfterDelete,
  };
}