import { useEffect, useState } from 'react';
import { BookOpenCheck, CalendarDays, CheckCircle2, Link2Off, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, PageHeader, Select } from '../../components/ui';
import { emitAppToast } from '../../toast';
import { useStore } from '../../store';
import type {
  GoogleCalendarIntegration,
  GoogleCalendarListItem,
  LineItemCategory,
  MicrosoftCalendarIntegration,
  MicrosoftCalendarListItem,
  QuickBooksCustomerCandidate,
  QuickBooksIntegration,
  QuickBooksItemReference,
  QuickBooksTaxCodeReference,
} from '../../types';

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

const emptyQuickBooksIntegration: QuickBooksIntegration = { connected: false, environment: 'sandbox' };
const emptyMicrosoftIntegration: MicrosoftCalendarIntegration = {
  connected: false,
  preferences: {
    showOutlookEvents: true,
    syncOliveOpsJobs: false,
    scope: 'all_company_jobs',
    employeeIds: [],
    divisionIds: [],
  },
};
const quickBooksCategories: { value: LineItemCategory; label: string }[] = [
  { value: 'labour', label: 'Labour' },
  { value: 'material', label: 'Material' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'subcontractor', label: 'Subcontractor' },
];

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export default function IntegrationsPage() {
  const customers = useStore((state) => state.customers);
  const [searchParams, setSearchParams] = useSearchParams();
  const [integration, setIntegration] = useState<GoogleCalendarIntegration>(emptyIntegration);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [microsoft, setMicrosoft] = useState<MicrosoftCalendarIntegration>(emptyMicrosoftIntegration);
  const [microsoftCalendars, setMicrosoftCalendars] = useState<MicrosoftCalendarListItem[]>([]);
  const [microsoftSaving, setMicrosoftSaving] = useState(false);
  const [quickBooks, setQuickBooks] = useState<QuickBooksIntegration>(emptyQuickBooksIntegration);
  const [quickBooksItems, setQuickBooksItems] = useState<QuickBooksItemReference[]>([]);
  const [quickBooksTaxCodes, setQuickBooksTaxCodes] = useState<QuickBooksTaxCodeReference[]>([]);
  const [quickBooksMappings, setQuickBooksMappings] = useState<Partial<Record<LineItemCategory, string>>>({});
  const [taxableTaxCodeId, setTaxableTaxCodeId] = useState('');
  const [quickBooksSaving, setQuickBooksSaving] = useState(false);
  const [syncCustomerId, setSyncCustomerId] = useState('');
  const [customerCandidates, setCustomerCandidates] = useState<QuickBooksCustomerCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');

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

  const loadQuickBooks = async () => {
    const statusResponse = await fetch('/api/integrations/quickbooks/status', { credentials: 'include' });
    const statusPayload = await readJson<{ ok: boolean; integration?: QuickBooksIntegration }>(statusResponse);
    if (!statusResponse.ok || !statusPayload?.ok || !statusPayload.integration) return;
    setQuickBooks(statusPayload.integration);
    if (!statusPayload.integration.connected) return;

    const settingsResponse = await fetch('/api/integrations/quickbooks/settings', { credentials: 'include' });
    const settingsPayload = await readJson<{
      ok: boolean;
      integration?: QuickBooksIntegration;
      items?: QuickBooksItemReference[];
      taxCodes?: QuickBooksTaxCodeReference[];
    }>(settingsResponse);
    if (!settingsResponse.ok || !settingsPayload?.ok) return;
    const configured = settingsPayload.integration?.configuration;
    setQuickBooks(settingsPayload.integration ?? statusPayload.integration);
    setQuickBooksItems(settingsPayload.items ?? []);
    setQuickBooksTaxCodes(settingsPayload.taxCodes ?? []);
    setQuickBooksMappings(Object.fromEntries(
      quickBooksCategories.map(({ value }) => [value, configured?.categoryMappings[value]?.id ?? ''])
    ));
    setTaxableTaxCodeId(configured?.taxableTaxCode?.id ?? '');
  };

  const loadMicrosoft = async () => {
    const response = await fetch('/api/integrations/microsoft/settings', { credentials: 'include' });
    const payload = await readJson<{ ok: boolean; integration?: MicrosoftCalendarIntegration }>(response);
    if (response.ok && payload?.ok && payload.integration) setMicrosoft(payload.integration);
  };

  const loadMicrosoftCalendars = async () => {
    const response = await fetch('/api/integrations/microsoft/calendars', { credentials: 'include' });
    const payload = await readJson<{ ok: boolean; calendars?: MicrosoftCalendarListItem[] }>(response);
    if (response.ok && payload?.ok && Array.isArray(payload.calendars)) setMicrosoftCalendars(payload.calendars);
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
    void loadQuickBooks();
    void loadMicrosoft();
  }, []);

  useEffect(() => {
    if (integration.connected) void loadCalendars();
  }, [integration.connected]);

  useEffect(() => {
    if (microsoft.connected) void loadMicrosoftCalendars();
  }, [microsoft.connected]);

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

  useEffect(() => {
    const result = searchParams.get('quickbooks');
    if (!result) return;
    const messages: Record<string, { tone: 'success' | 'error'; message: string }> = {
      connected: { tone: 'success', message: 'QuickBooks sandbox company connected.' },
      denied: { tone: 'error', message: 'QuickBooks access was not granted.' },
      invalid_state: { tone: 'error', message: 'The QuickBooks connection request expired. Please try again.' },
      missing_code: { tone: 'error', message: 'QuickBooks did not return an authorization code.' },
      missing_realm: { tone: 'error', message: 'QuickBooks did not identify a company.' },
      already_connected: { tone: 'error', message: 'Disconnect the current QuickBooks company before connecting another.' },
      connection_failed: { tone: 'error', message: 'QuickBooks could not be connected.' },
    };
    const notification = messages[result];
    if (notification) emitAppToast(notification);
    searchParams.delete('quickbooks');
    setSearchParams(searchParams, { replace: true });
    if (result === 'connected') void loadQuickBooks();
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const result = searchParams.get('microsoft');
    if (!result) return;
    const messages: Record<string, { tone: 'success' | 'error'; message: string }> = {
      connected: { tone: 'success', message: 'Outlook Calendar connected.' },
      denied: { tone: 'error', message: 'Outlook Calendar access was not granted.' },
      invalid_state: { tone: 'error', message: 'The Microsoft connection request expired. Please try again.' },
      missing_code: { tone: 'error', message: 'Microsoft did not return an authorization code.' },
      no_calendars: { tone: 'error', message: 'No editable Outlook calendars were available for this account.' },
      connection_failed: { tone: 'error', message: 'Outlook Calendar could not be connected.' },
      reauthorization_required: { tone: 'error', message: 'Reconnect Outlook Calendar to continue.' },
    };
    const notification = messages[result];
    if (notification) emitAppToast(notification);
    searchParams.delete('microsoft');
    setSearchParams(searchParams, { replace: true });
    if (result === 'connected') void loadMicrosoft();
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

  const saveMicrosoftPreferences = async (next: MicrosoftCalendarIntegration['preferences']) => {
    setMicrosoftSaving(true);
    try {
      const response = await fetch('/api/integrations/microsoft/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showOutlookEvents: next.showOutlookEvents, syncOliveOpsJobs: next.syncOliveOpsJobs }),
      });
      const payload = await readJson<{ ok: boolean; integration?: MicrosoftCalendarIntegration; error?: string }>(response);
      if (!response.ok || !payload?.ok || !payload.integration) {
        emitAppToast({ tone: 'error', message: payload?.error ?? 'Could not save Outlook settings.' });
        return;
      }
      setMicrosoft(payload.integration);
    } finally {
      setMicrosoftSaving(false);
    }
  };

  const selectMicrosoftCalendar = async (calendarId: string) => {
    setMicrosoftSaving(true);
    try {
      const response = await fetch('/api/integrations/microsoft/calendars', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarId }),
      });
      const payload = await readJson<{ ok: boolean; calendar?: MicrosoftCalendarListItem; error?: string }>(response);
      if (!response.ok || !payload?.ok || !payload.calendar) {
        emitAppToast({ tone: 'error', message: payload?.error ?? 'Could not select that Outlook calendar.' });
        return;
      }
      setMicrosoft((current) => ({ ...current, selectedCalendarId: payload.calendar?.id, selectedCalendarSummary: payload.calendar?.summary }));
      emitAppToast({ tone: 'success', message: 'Outlook Calendar selection updated.' });
    } finally {
      setMicrosoftSaving(false);
    }
  };

  const disconnectMicrosoft = async () => {
    setMicrosoftSaving(true);
    try {
      const response = await fetch('/api/integrations/microsoft/disconnect', { method: 'POST', credentials: 'include' });
      if (!response.ok) {
        emitAppToast({ tone: 'error', message: 'Could not disconnect Outlook Calendar.' });
        return;
      }
      setMicrosoft(emptyMicrosoftIntegration);
      setMicrosoftCalendars([]);
      emitAppToast({ tone: 'success', message: 'Outlook Calendar disconnected. Existing Outlook events were retained.' });
    } finally {
      setMicrosoftSaving(false);
    }
  };

  const disconnectQuickBooks = async () => {
    setQuickBooksSaving(true);
    try {
      const response = await fetch('/api/integrations/quickbooks/disconnect', { method: 'POST', credentials: 'include' });
      if (!response.ok) {
        emitAppToast({ tone: 'error', message: 'Could not disconnect QuickBooks.' });
        return;
      }
      setQuickBooks(emptyQuickBooksIntegration);
      setQuickBooksItems([]);
      setQuickBooksTaxCodes([]);
      emitAppToast({ tone: 'success', message: 'QuickBooks disconnected.' });
    } finally {
      setQuickBooksSaving(false);
    }
  };

  const saveQuickBooksConfiguration = async () => {
    setQuickBooksSaving(true);
    try {
      const response = await fetch('/api/integrations/quickbooks/settings', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryMappings: quickBooksMappings, taxableTaxCodeId }),
      });
      const payload = await readJson<{ ok: boolean; error?: string }>(response);
      if (!response.ok || !payload?.ok) {
        emitAppToast({ tone: 'error', message: payload?.error ?? 'QuickBooks configuration could not be saved.' });
        return;
      }
      emitAppToast({ tone: 'success', message: 'QuickBooks accounting mappings saved.' });
      await loadQuickBooks();
    } finally {
      setQuickBooksSaving(false);
    }
  };

  const findQuickBooksCustomer = async () => {
    if (!syncCustomerId) return;
    setQuickBooksSaving(true);
    try {
      const response = await fetch(`/api/integrations/quickbooks/customers?customerId=${encodeURIComponent(syncCustomerId)}`, { credentials: 'include' });
      const payload = await readJson<{ ok: boolean; mapping?: unknown; candidates?: QuickBooksCustomerCandidate[]; error?: string }>(response);
      if (!response.ok || !payload?.ok) {
        emitAppToast({ tone: 'error', message: payload?.error ?? 'Could not check QuickBooks customers.' });
        return;
      }
      if (payload.mapping) {
        emitAppToast({ tone: 'success', message: 'This customer is already mapped to QuickBooks.' });
        setCustomerCandidates([]);
        return;
      }
      setCustomerCandidates(payload.candidates ?? []);
      setSelectedCandidateId(payload.candidates?.length === 1 ? payload.candidates[0].id : '');
    } finally {
      setQuickBooksSaving(false);
    }
  };

  const syncQuickBooksCustomer = async (action: 'map' | 'create') => {
    if (!syncCustomerId || (action === 'map' && !selectedCandidateId)) return;
    setQuickBooksSaving(true);
    try {
      const response = await fetch('/api/integrations/quickbooks/customers', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: syncCustomerId, action, quickBooksCustomerId: selectedCandidateId }),
      });
      const payload = await readJson<{ ok: boolean; error?: string }>(response);
      if (!response.ok || !payload?.ok) {
        emitAppToast({ tone: 'error', message: payload?.error ?? 'QuickBooks customer synchronization failed.' });
        return;
      }
      setCustomerCandidates([]);
      setSelectedCandidateId('');
      emitAppToast({ tone: 'success', message: action === 'create' ? 'Customer created in QuickBooks.' : 'Customer mapped to QuickBooks.' });
    } finally {
      setQuickBooksSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect the specialist systems that support your operation." />
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

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-brand-100 p-5 dark:border-brand-600 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-100 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
              <CalendarDays size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-brand-900 dark:text-brand-50">Outlook Calendar</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge label={microsoft.connected ? 'Connected' : 'Not Connected'} className={microsoft.connected ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'} />
                {microsoft.microsoftAccountEmail ? <span className="text-sm text-brand-500 dark:text-brand-200">{microsoft.microsoftAccountEmail}</span> : null}
              </div>
            </div>
          </div>
          {microsoft.connected ? (
            <Button variant="secondary" disabled={microsoftSaving} onClick={() => void disconnectMicrosoft()}><Link2Off size={16} /> Disconnect</Button>
          ) : (
            <Button disabled={microsoftSaving} onClick={() => { window.location.assign('/api/integrations/microsoft/connect'); }}><CalendarDays size={16} /> Connect Outlook Calendar</Button>
          )}
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Calendar</h3>
            <p className="mt-1 text-sm text-brand-500 dark:text-brand-200">Choose where OliveOps-owned schedule events are synchronized.</p>
            <div className="mt-3 max-w-md">
              <Select value={microsoft.selectedCalendarId ?? ''} disabled={!microsoft.connected || microsoftSaving} onChange={(event) => void selectMicrosoftCalendar(event.target.value)}>
                {!microsoft.connected ? <option value="">Connect Outlook Calendar first</option> : null}
                {microsoftCalendars.filter((calendar) => calendar.canEdit).map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? ' (Default)' : ''}</option>
                ))}
              </Select>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Sync preferences</h3>
            <div className="mt-3 space-y-3">
              {[
                { key: 'showOutlookEvents' as const, label: 'Show Outlook Calendar events in OliveOps' },
                { key: 'syncOliveOpsJobs' as const, label: 'Add OliveOps scheduled jobs to Outlook Calendar' },
              ].map((option) => (
                <label key={option.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-brand-100 p-3 dark:border-brand-600">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sky-700" checked={microsoft.preferences[option.key]} disabled={!microsoft.connected || microsoftSaving} onChange={(event) => void saveMicrosoftPreferences({ ...microsoft.preferences, [option.key]: event.target.checked })} />
                  <span className="text-sm font-medium text-brand-800 dark:text-brand-100">{option.label}</span>
                </label>
              ))}
            </div>
          </section>
        </div>

        {microsoft.connected ? (
          <div className="flex items-center gap-2 border-t border-brand-100 px-5 py-3 text-xs text-brand-500 dark:border-brand-600 dark:text-brand-200">
            <CheckCircle2 size={14} /> Connected securely. Microsoft credentials remain server-side.
          </div>
        ) : null}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-brand-100 p-5 dark:border-brand-600 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-800 dark:text-brand-200">
              <BookOpenCheck size={20} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-brand-900 dark:text-brand-50">QuickBooks Online</h2>
                <Badge label="SANDBOX" className="bg-amber-100 text-amber-800" />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge label={quickBooks.connected ? 'Connected' : 'Not Connected'} className={quickBooks.connected ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'} />
                {quickBooks.companyName ? <span className="text-sm text-brand-500 dark:text-brand-200">{quickBooks.companyName}</span> : null}
                {quickBooks.currency ? <span className="text-xs text-brand-500 dark:text-brand-200">{quickBooks.currency}</span> : null}
              </div>
            </div>
          </div>
          {quickBooks.connected ? (
            <Button variant="secondary" disabled={quickBooksSaving} onClick={() => void disconnectQuickBooks()}><Link2Off size={16} /> Disconnect</Button>
          ) : (
            <Button disabled={quickBooksSaving} onClick={() => { window.location.assign('/api/integrations/quickbooks/connect'); }}><BookOpenCheck size={16} /> Connect Sandbox</Button>
          )}
        </div>

        <div className="grid gap-8 p-5 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Invoice accounting mappings</h3>
            <p className="mt-1 text-sm text-brand-500 dark:text-brand-200">Choose the QuickBooks Product/Service used for each OliveOps invoice category.</p>
            <div className="mt-4 space-y-3">
              {quickBooksCategories.map((category) => (
                <Select
                  key={category.value}
                  label={category.label}
                  disabled={!quickBooks.connected || quickBooksSaving}
                  value={quickBooksMappings[category.value] ?? ''}
                  onChange={(event) => setQuickBooksMappings((current) => ({ ...current, [category.value]: event.target.value }))}
                >
                  <option value="">Not mapped</option>
                  {quickBooksItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.type})</option>)}
                </Select>
              ))}
              <Select label="Taxable Sales Tax Code" disabled={!quickBooks.connected || quickBooksSaving} value={taxableTaxCodeId} onChange={(event) => setTaxableTaxCodeId(event.target.value)}>
                <option value="">Select a tax code</option>
                {quickBooksTaxCodes.filter((taxCode) => taxCode.taxable).map((taxCode) => <option key={taxCode.id} value={taxCode.id}>{taxCode.name}</option>)}
              </Select>
              <Button disabled={!quickBooks.connected || quickBooksSaving || !taxableTaxCodeId} onClick={() => void saveQuickBooksConfiguration()}>Save Mappings</Button>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2"><Users size={16} /><h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50">Customer Sync</h3></div>
            <p className="mt-1 text-sm text-brand-500 dark:text-brand-200">Explicitly map an OliveOps customer or create it in QuickBooks.</p>
            <div className="mt-4 space-y-3">
              <Select label="OliveOps Customer" disabled={!quickBooks.connected || quickBooksSaving} value={syncCustomerId} onChange={(event) => { setSyncCustomerId(event.target.value); setCustomerCandidates([]); }}>
                <option value="">Select a customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company || customer.name}</option>)}
              </Select>
              <Button variant="secondary" disabled={!quickBooks.connected || !syncCustomerId || quickBooksSaving} onClick={() => void findQuickBooksCustomer()}>Check Exact Matches</Button>
              {customerCandidates.length > 0 ? (
                <Select label="Exact QuickBooks Match" value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)}>
                  <option value="">Select a match</option>
                  {customerCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}{candidate.email ? ` - ${candidate.email}` : ''}</option>)}
                </Select>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!selectedCandidateId || quickBooksSaving} onClick={() => void syncQuickBooksCustomer('map')}>Map Selected</Button>
                <Button variant="secondary" disabled={!syncCustomerId || quickBooksSaving} onClick={() => void syncQuickBooksCustomer('create')}>Create in QuickBooks</Button>
              </div>
            </div>
          </section>
        </div>

        <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">
          Sandbox only. QuickBooks remains the accounting system of record for balances, payments, and tax reporting.
        </div>
      </Card>
    </div>
  );
}