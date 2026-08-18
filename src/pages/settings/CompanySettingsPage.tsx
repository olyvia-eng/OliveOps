import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { Button, Card, PageHeader, Select } from '../../components/ui';
import { emitAppToast } from '../../toast';

const commonTimezones = ['America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/Winnipeg', 'America/Edmonton', 'America/Vancouver', 'America/Whitehorse', 'UTC'];

export default function CompanySettingsPage() {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/business', { credentials: 'include' }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Company settings could not be loaded.');
      setName(payload.business.name);
      setTimezone(payload.business.timezone);
    }).catch((error: unknown) => emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company settings could not be loaded.' })).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/business', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ timezone }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Company settings could not be saved.');
      setTimezone(payload.business.timezone);
      emitAppToast({ tone: 'success', message: 'Company timezone updated.' });
    } catch (error: unknown) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company settings could not be saved.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Company Settings" subtitle="Set the local calendar used for recurring Forms and reporting." />
      <Card className="max-w-2xl p-5">
        <div className="mb-5 flex items-center gap-3"><Building2 className="text-brand-700" /><div><p className="font-semibold text-brand-900 dark:text-brand-50">{name || 'Company'}</p><p className="text-sm text-brand-500 dark:text-brand-200">Dates are stored in UTC and grouped using this timezone.</p></div></div>
        <Select label="Business timezone" disabled={loading} value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {!commonTimezones.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}
          {commonTimezones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
        </Select>
        <div className="mt-4"><Button onClick={() => void save()} disabled={loading || saving}>{saving ? 'Saving...' : 'Save timezone'}</Button></div>
      </Card>
    </div>
  );
}