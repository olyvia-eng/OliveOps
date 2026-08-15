import { useEffect, useState } from 'react';
import { CalendarDays, Link2Off } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, PageHeader, Select } from '../../components/ui';
import type { GoogleCalendarIntegration, GoogleCalendarListItem, MicrosoftCalendarIntegration, MicrosoftCalendarListItem } from '../../types';
import { emitAppToast } from '../../toast';

const googleDefault: GoogleCalendarIntegration = { connected: false, preferences: { showGoogleEvents: true, syncOliveOpsJobs: false, scope: 'all_company_jobs', employeeIds: [], divisionIds: [] } };
const microsoftDefault: MicrosoftCalendarIntegration = { connected: false, preferences: { showOutlookEvents: true, syncOliveOpsJobs: false, scope: 'all_company_jobs', employeeIds: [], divisionIds: [] } };

async function json<T>(response: Response) {
  try { return await response.json() as T; } catch { return null; }
}

export default function PersonalCalendarSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [google, setGoogle] = useState(googleDefault);
  const [microsoft, setMicrosoft] = useState(microsoftDefault);
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [microsoftCalendars, setMicrosoftCalendars] = useState<MicrosoftCalendarListItem[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [googleResponse, microsoftResponse] = await Promise.all([
      fetch('/api/integrations/google/settings', { credentials: 'include' }),
      fetch('/api/integrations/microsoft/settings', { credentials: 'include' }),
    ]);
    const googlePayload = await json<{ ok?: boolean; integration?: GoogleCalendarIntegration }>(googleResponse);
    const microsoftPayload = await json<{ ok?: boolean; integration?: MicrosoftCalendarIntegration }>(microsoftResponse);
    if (googleResponse.ok && googlePayload?.integration) setGoogle(googlePayload.integration);
    if (microsoftResponse.ok && microsoftPayload?.integration) setMicrosoft(microsoftPayload.integration);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const provider = searchParams.has('google') ? 'google' : searchParams.has('microsoft') ? 'microsoft' : null;
    if (!provider) return;
    const result = searchParams.get(provider);
    emitAppToast({ tone: result === 'connected' ? 'success' : 'error', message: result === 'connected' ? `${provider === 'google' ? 'Google' : 'Outlook'} Calendar connected.` : 'Calendar connection was not completed.' });
    searchParams.delete(provider);
    setSearchParams(searchParams, { replace: true });
    void load();
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (!google.connected) return;
    void fetch('/api/integrations/google/calendars', { credentials: 'include' }).then(async (response) => {
      const payload = await json<{ calendars?: GoogleCalendarListItem[] }>(response);
      if (response.ok && payload?.calendars) setGoogleCalendars(payload.calendars);
    });
  }, [google.connected]);
  useEffect(() => {
    if (!microsoft.connected) return;
    void fetch('/api/integrations/microsoft/calendars', { credentials: 'include' }).then(async (response) => {
      const payload = await json<{ calendars?: MicrosoftCalendarListItem[] }>(response);
      if (response.ok && payload?.calendars) setMicrosoftCalendars(payload.calendars);
    });
  }, [microsoft.connected]);

  const patch = async (provider: 'google' | 'microsoft', visible: boolean) => {
    setSaving(true);
    const response = await fetch(`/api/integrations/${provider}/settings`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(provider === 'google' ? { showGoogleEvents: visible, syncOliveOpsJobs: false } : { showOutlookEvents: visible, syncOliveOpsJobs: false }),
    });
    const payload = await json<{ integration?: GoogleCalendarIntegration | MicrosoftCalendarIntegration; error?: string }>(response);
    if (!response.ok || !payload?.integration) emitAppToast({ tone: 'error', message: payload?.error ?? 'Could not save calendar preference.' });
    else if (provider === 'google') setGoogle(payload.integration as GoogleCalendarIntegration);
    else setMicrosoft(payload.integration as MicrosoftCalendarIntegration);
    setSaving(false);
  };

  const choose = async (provider: 'google' | 'microsoft', calendarId: string) => {
    setSaving(true);
    const response = await fetch(`/api/integrations/${provider}/calendars`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarId }) });
    if (response.ok) await load();
    else emitAppToast({ tone: 'error', message: 'Could not select that calendar.' });
    setSaving(false);
  };

  const disconnect = async (provider: 'google' | 'microsoft') => {
    setSaving(true);
    const response = await fetch(`/api/integrations/${provider}/disconnect`, { method: 'POST', credentials: 'include' });
    if (response.ok) {
      if (provider === 'google') setGoogle(googleDefault); else setMicrosoft(microsoftDefault);
    }
    setSaving(false);
  };

  const providers = [
    { id: 'google' as const, name: 'Google Calendar', connected: google.connected, email: google.googleAccountEmail, selectedId: google.selectedCalendarId, visible: google.preferences.showGoogleEvents, calendars: googleCalendars.filter((item) => ['owner', 'writer'].includes(item.accessRole)) },
    { id: 'microsoft' as const, name: 'Outlook Calendar', connected: microsoft.connected, email: microsoft.microsoftAccountEmail, selectedId: microsoft.selectedCalendarId, visible: microsoft.preferences.showOutlookEvents, calendars: microsoftCalendars.filter((item) => item.canEdit) },
  ];

  return (
    <div>
      <PageHeader title="Personal Calendar" subtitle="Connect your own calendar. Events remain private to your OliveOps account." />
      <div className="space-y-5">
        {providers.map((provider) => (
          <Card key={provider.id} className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-brand-100 p-5 dark:border-brand-600">
              <div className="flex items-start gap-3"><CalendarDays className="text-brand-700" /><div><h2 className="font-semibold text-brand-900 dark:text-brand-50">{provider.name}</h2><div className="mt-1 flex items-center gap-2"><Badge label={provider.connected ? 'Connected' : 'Not connected'} className={provider.connected ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'} />{provider.email ? <span className="text-sm text-brand-500">{provider.email}</span> : null}</div></div></div>
              {provider.connected ? <Button variant="secondary" disabled={saving} onClick={() => void disconnect(provider.id)}><Link2Off size={16} /> Disconnect</Button> : <Button onClick={() => window.location.assign(`/api/integrations/${provider.id}/connect`)}>Connect</Button>}
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Select value={provider.selectedId ?? ''} disabled={!provider.connected || saving} onChange={(event) => void choose(provider.id, event.target.value)}><option value="">Select calendar</option>{provider.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</Select>
              <label className="flex items-center gap-3 rounded-lg border border-brand-100 p-3 text-sm font-medium"><input type="checkbox" checked={provider.visible} disabled={!provider.connected || saving} onChange={(event) => void patch(provider.id, event.target.checked)} /> Show events in My Calendar</label>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
