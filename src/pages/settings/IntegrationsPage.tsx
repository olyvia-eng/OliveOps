import { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, Link2Off } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, PageHeader, Select } from '../../components/ui';
import { emitAppToast } from '../../toast';
import type { GoogleCalendarIntegration, GoogleCalendarListItem } from '../../types';

const emptyIntegration: GoogleCalendarIntegration = {
  connected: false,
  preferences: {
    showGoogleEvents: true,
    syncOliveOpsJobs: false,
    scope: 'all_company_jobs',
    employeeIds: [],
    divisionIds: [],
  },
};

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export default function IntegrationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [integration, setIntegration] = useState<GoogleCalendarIntegration>(emptyIntegration);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadIntegration = async () => {
    const response = await fetch('/api/integrations/google/settings', { credentials: 'include' });
    const payload = await readJson<{ ok: boolean; integration?: GoogleCalendarIntegration }>(response);
    if (response.ok && payload?.ok && payload.integration) setIntegration(payload.integration);
  };

  const loadCalendars = async () => {
    const response = await fetch('/api/integrations/google/calendars', { credentials: 'include' });
    const payload = await readJson<{ ok: boolean; calendars?: GoogleCalendarListItem[] }>(response);
    if (response.ok && payload?.ok && Array.isArray(payload.calendars)) setCalendars(payload.calendars);
  };

  useEffect(() => {
    const load = async () => {
      try {
        await loadIntegration();
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (integration.connected) void loadCalendars();
  }, [integration.connected]);

  useEffect(() => {
    const result = searchParams.get('google');
    if (!result) return;
    const messages: Record<string, { tone: 'success' | 'error'; message: string }> = {
      connected: { tone: 'success', message: 'Google Calendar connected.' },
      denied: { tone: 'error', message: 'Google Calendar access was not granted.' },
      invalid_state: { tone: 'error', message: 'The Google connection request expired. Please try again.' },
      missing_code: { tone: 'error', message: 'Google did not return an authorization code.' },
      no_calendars: { tone: 'error', message: 'No Google calendars were available for this account.' },
      connection_failed: { tone: 'error', message: 'Google Calendar could not be connected.' },
    };
    const notification = messages[result];
    if (notification) emitAppToast(notification);
    searchParams.delete('google');
    setSearchParams(searchParams, { replace: true });
    if (result === 'connected') void loadIntegration();
  }, [searchParams, setSearchParams]);

  const savePreferences = async (next: GoogleCalendarIntegration['preferences']) => {
    setSaving(true);
    try {
      const response = await fetch('/api/integrations/google/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showGoogleEvents: next.showGoogleEvents,
          syncOliveOpsJobs: next.syncOliveOpsJobs,
        }),
      });
      const payload = await readJson<{ ok: boolean; integration?: GoogleCalendarIntegration; error?: string }>(response);
      if (!response.ok || !payload?.ok || !payload.integration) {
        emitAppToast({ tone: 'error', message: payload?.error ?? 'Could not save integration settings.' });
        return;
      }
      setIntegration(payload.integration);
    } finally {
      setSaving(false);
    }
  };

  const selectCalendar = async (calendarId: string) => {
    setSaving(true);
    try {
      const response = await fetch('/api/integrations/google/calendars', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId }),
      });
      const payload = await readJson<{ ok: boolean; calendar?: GoogleCalendarListItem; error?: string }>(response);
      if (!response.ok || !payload?.ok || !payload.calendar) {
        emitAppToast({ tone: 'error', message: payload?.error ?? 'Could not select that calendar.' });
        return;
      }
      setIntegration((current) => ({
        ...current,
        selectedCalendarId: payload.calendar?.id,
        selectedCalendarSummary: payload.calendar?.summary,
      }));
      emitAppToast({ tone: 'success', message: 'Google Calendar selection updated.' });
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/integrations/google/disconnect', { method: 'POST', credentials: 'include' });
      if (!response.ok) {
        emitAppToast({ tone: 'error', message: 'Could not disconnect Google Calendar.' });
        return;
      }
      setIntegration(emptyIntegration);
      setCalendars([]);
      emitAppToast({ tone: 'success', message: 'Google Calendar disconnected.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect the services that keep your company schedule aligned." />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-brand-100 p-5 dark:border-brand-600 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-800 dark:text-brand-200">
              <CalendarDays size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-brand-900 dark:text-brand-50">Google Calendar</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  label={integration.connected ? 'Connected' : 'Not Connected'}
                  className={integration.connected ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'}
                />
                {integration.googleAccountEmail ? <span className="text-sm text-brand-500 dark:text-brand-200">{integration.googleAccountEmail}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {integration.connected ? (
              <Button variant="secondary" disabled={saving} onClick={() => void disconnect()}><Link2Off size={16} /> Disconnect</Button>
            ) : (
              <Button disabled={loading} onClick={() => { window.location.assign('/api/integrations/google/connect'); }}><CalendarDays size={16} /> Connect Google Calendar</Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Calendar</h3>
            <p className="mt-1 text-sm text-brand-500 dark:text-brand-200">Choose where OliveOps-owned schedule events are synchronized.</p>
            <div className="mt-3 max-w-md">
              <Select
                value={integration.selectedCalendarId ?? ''}
                disabled={!integration.connected || saving}
                onChange={(event) => void selectCalendar(event.target.value)}
              >
                {!integration.connected ? <option value="">Connect Google Calendar first</option> : null}
                {calendars.filter((calendar) => ['owner', 'writer'].includes(calendar.accessRole)).map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? ' (Primary)' : ''}</option>
                ))}
              </Select>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Sync preferences</h3>
            <div className="mt-3 space-y-3">
              {[
                { key: 'showGoogleEvents' as const, label: 'Show Google Calendar events in OliveOps' },
                { key: 'syncOliveOpsJobs' as const, label: 'Add OliveOps scheduled jobs to Google Calendar' },
              ].map((option) => (
                <label key={option.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-brand-100 p-3 dark:border-brand-600">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-brand-700"
                    checked={integration.preferences[option.key]}
                    disabled={!integration.connected || saving}
                    onChange={(event) => void savePreferences({ ...integration.preferences, [option.key]: event.target.checked })}
                  />
                  <span className="text-sm font-medium text-brand-800 dark:text-brand-100">{option.label}</span>
                </label>
              ))}
            </div>
          </section>
        </div>

        {integration.connected ? (
          <div className="flex items-center gap-2 border-t border-brand-100 px-5 py-3 text-xs text-brand-500 dark:border-brand-600 dark:text-brand-200">
            <CheckCircle2 size={14} /> Connected securely. Google credentials remain server-side.
          </div>
        ) : null}
      </Card>
    </div>
  );
}