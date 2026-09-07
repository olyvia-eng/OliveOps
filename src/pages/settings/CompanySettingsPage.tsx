import { useEffect, useState } from 'react';
import { Building2, ImageUp, Trash2 } from 'lucide-react';
import { Button, Card, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { emitAppToast } from '../../toast';
import { resolveAttachmentUrl, uploadFileToStorage } from '../../utils/fileUpload';

const commonTimezones = ['America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/Winnipeg', 'America/Edmonton', 'America/Vancouver', 'America/Whitehorse', 'UTC'];

export default function CompanySettingsPage() {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [proposalFields, setProposalFields] = useState({ legalName: '', phone: '', email: '', website: '', businessAddress: '', taxLabel: '', proposalTerms: '' });
  const [businessId, setBusinessId] = useState('');
  const [logoFileId, setLogoFileId] = useState('');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    void fetch('/api/business', { credentials: 'include' }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Company settings could not be loaded.');
      setBusinessId(payload.business.id);
      setName(payload.business.name);
      setTimezone(payload.business.timezone);
      setLogoFileId(payload.business.logoFileId ?? '');
      setLogoPreviewUrl(payload.business.logoDataUrl ?? '');
      if (payload.business.logoFileId) void resolveAttachmentUrl({ fileId: payload.business.logoFileId }).then(setLogoPreviewUrl);
      setProposalFields({
        legalName: payload.business.legalName ?? '', phone: payload.business.phone ?? '', email: payload.business.email ?? '', website: payload.business.website ?? '',
        businessAddress: payload.business.businessAddress ?? '', taxLabel: payload.business.taxLabel ?? '', proposalTerms: payload.business.proposalTerms ?? '',
      });
    }).catch((error: unknown) => emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company settings could not be loaded.' })).finally(() => setLoading(false));
  }, []);

  const uploadLogo = async (file?: File) => {
    if (!file || !businessId) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 200 * 1024) {
      emitAppToast({ tone: 'error', message: 'Choose a PNG or JPEG logo no larger than 200 KB.' });
      return;
    }
    setUploadingLogo(true);
    try {
      const uploaded = await uploadFileToStorage({ file, entityType: 'business-profile', entityId: businessId, category: 'logo' });
      setLogoFileId(uploaded.fileId);
      setLogoPreviewUrl(URL.createObjectURL(file));
    } catch (error) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company logo could not be uploaded.' });
    } finally {
      setUploadingLogo(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/business', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ timezone, logoFileId, ...proposalFields }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Company settings could not be saved.');
      setTimezone(payload.business.timezone);
      setLogoFileId(payload.business.logoFileId ?? '');
      setProposalFields({ legalName: payload.business.legalName ?? '', phone: payload.business.phone ?? '', email: payload.business.email ?? '', website: payload.business.website ?? '', businessAddress: payload.business.businessAddress ?? '', taxLabel: payload.business.taxLabel ?? '', proposalTerms: payload.business.proposalTerms ?? '' });
      emitAppToast({ tone: 'success', message: 'Company settings updated.' });
    } catch (error: unknown) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company settings could not be saved.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Company Settings" subtitle="Manage company details used in operations and customer proposals." />
      <Card className="max-w-2xl p-5">
        <div className="mb-5 flex items-center gap-3"><Building2 className="text-brand-700" /><div><p className="font-semibold text-brand-900 dark:text-brand-50">{name || 'Company'}</p><p className="text-sm text-brand-500 dark:text-brand-200">Dates are stored in UTC and grouped using this timezone.</p></div></div>
        <Select label="Business timezone" disabled={loading} value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {!commonTimezones.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}
          {commonTimezones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
        </Select>
        <div className="mt-6 border-t border-brand-100 pt-5"><h2 className="font-semibold text-brand-900 dark:text-brand-50">Proposal identity</h2><div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-brand-100 p-4"><div className="flex h-20 w-32 items-center justify-center overflow-hidden rounded border border-brand-100 bg-white">{logoPreviewUrl ? <img src={logoPreviewUrl} alt={`${name || 'Company'} logo`} className="max-h-full max-w-full object-contain" /> : <span className="px-3 text-center text-xs text-brand-400">Company name will be used</span>}</div><div className="flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white"><ImageUp size={15} />{uploadingLogo ? 'Uploading...' : logoFileId ? 'Replace logo' : 'Upload logo'}<input className="sr-only" type="file" accept="image/png,image/jpeg" disabled={loading || uploadingLogo} onChange={(event) => void uploadLogo(event.target.files?.[0])} /></label>{logoPreviewUrl ? <Button variant="secondary" disabled={loading || uploadingLogo} onClick={() => { setLogoFileId(''); setLogoPreviewUrl(''); }}><Trash2 size={15} /> Remove</Button> : null}</div><p className="w-full text-xs text-brand-400">PNG or JPEG, up to 200 KB. The logo is stored privately and embedded into sent Proposal versions.</p></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><Input label="Legal name" disabled={loading} value={proposalFields.legalName} onChange={(event) => setProposalFields((current) => ({ ...current, legalName: event.target.value }))} /><Input label="Phone" disabled={loading} value={proposalFields.phone} onChange={(event) => setProposalFields((current) => ({ ...current, phone: event.target.value }))} /><Input label="Email" type="email" disabled={loading} value={proposalFields.email} onChange={(event) => setProposalFields((current) => ({ ...current, email: event.target.value }))} /><Input label="Website" disabled={loading} value={proposalFields.website} onChange={(event) => setProposalFields((current) => ({ ...current, website: event.target.value }))} /><div className="sm:col-span-2"><TextArea label="Business address" rows={2} disabled={loading} value={proposalFields.businessAddress} onChange={(event) => setProposalFields((current) => ({ ...current, businessAddress: event.target.value }))} /></div><Input label="Proposal tax label (optional)" disabled={loading} value={proposalFields.taxLabel} onChange={(event) => setProposalFields((current) => ({ ...current, taxLabel: event.target.value }))} /><div className="sm:col-span-2"><TextArea label="Proposal Terms and Conditions" rows={6} disabled={loading} value={proposalFields.proposalTerms} onChange={(event) => setProposalFields((current) => ({ ...current, proposalTerms: event.target.value }))} /></div></div></div>
        <div className="mt-4"><Button onClick={() => void save()} disabled={loading || saving || uploadingLogo}>{saving ? 'Saving...' : 'Save company settings'}</Button></div>
      </Card>
    </div>
  );
}