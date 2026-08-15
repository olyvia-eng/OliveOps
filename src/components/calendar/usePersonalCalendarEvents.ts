import { useEffect, useState } from 'react';
import type { ExternalCalendarEvent } from '../../types';

export interface PersonalCalendarRange {
  start: Date;
  end: Date;
}

export default function usePersonalCalendarEvents(range: PersonalCalendarRange | null) {
  const [events, setEvents] = useState<ExternalCalendarEvent[]>([]);
  const startIso = range?.start.toISOString() ?? '';
  const endIso = range?.end.toISOString() ?? '';

  useEffect(() => {
    if (!startIso || !endIso) return;
    const controller = new AbortController();
    setEvents([]);
    const params = new URLSearchParams({ from: startIso, to: endIso });
    void fetch(`/api/integrations/calendars/events?${params}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; events?: ExternalCalendarEvent[] } }))
      .then(({ response, payload }) => {
        if (response.ok && payload.ok && Array.isArray(payload.events)) setEvents(payload.events);
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setEvents([]);
      });
    return () => controller.abort();
  }, [endIso, startIso]);

  return events;
}
