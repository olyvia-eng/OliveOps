import { useEffect, useState } from 'react';
import { Building2, ImageUp, Trash2, WalletCards } from 'lucide-react';
import { Button, Card, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { emitAppToast } from '../../toast';
import { resolveAttachmentUrl, uploadFileToStorage } from '../../utils/fileUpload';

const commonTimezones = ['America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/Winnipeg', 'America/Edmonton', 'America/Vancouver', 'America/Whitehorse', 'UTC'];
type PaymentMethod = { type: string; enabled: boolean; displayName: string; instructions: string };
type BusinessPayload = {
  id: string; name: string; timezone: string; logoFileId?: string; logoDataUrl?: string;
  legalName?: string; phone?: string; email?: string; website?: string; businessAddress?: string; taxLabel?: string; proposalTerms?: string;
  defaultPaymentTermsDays?: number; defaultInvoiceNotes?: string; paymentInstructions?: string; paymentMethods?: PaymentMethod[];
};

export default function CompanySettingsPage() {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [businessId, setBusinessId] = useState('');
  const [logoFileId, setLogoFileId] = useState('');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
  const [proposalFields, setProposalFields] = useState({ legalName: '', phone: '', email: '', website: '', businessAddress: '', taxLabel: '', proposalTerms: '' });
  const [invoiceFields, setInvoiceFields] = useState({ defaultPaymentTermsDays: 30, defaultInvoiceNotes: '', paymentInstructions: '', paymentMethods: [] as PaymentMethod[] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const hydrate = (business: BusinessPayload) => {
    setBusinessId(business.id);
    setName(business.name);
    setTimezone(business.timezone);
    setLogoFileId(business.logoFileId ?? '');
    setLogoPreviewUrl(business.logoDataUrl ?? '');
    if (business.logoFileId) void resolveAttachmentUrl({ fileId: business.logoFileId }).then(setLogoPreviewUrl);
    setProposalFields({ legalName: business.legalName ?? '', phone: business.phone ?? '', email: business.email ?? '', website: business.website ?? '', businessAddress: business.businessAddress ?? '', taxLabel: business.taxLabel ?? '', proposalTerms: business.proposalTerms ?? '' });
    setInvoiceFields({ defaultPaymentTermsDays: business.defaultPaymentTermsDays ?? 30, defaultInvoiceNotes: business.defaultInvoiceNotes ?? '', paymentInstructions: business.paymentInstructions ?? '', paymentMethods: business.paymentMethods ?? [] });
  };

  useEffect(() => {
    void fetch('/api/business', { credentials: 'include' }).then(async (response) => {
      const payload = await response.json() as { ok?: boolean; business?: BusinessPayload; error?: string };
      if (!response.ok || !payload.ok || !payload.business) throw new Error(payload.error ?? 'Company settings could not be loaded.');
      hydrate(payload.business);
    }).catch((error: unknown) => emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company settings could not be loaded.' })).finally(() => setLoading(false));
  }, []);

  const uploadLogo = async (file?: File) => {
    if (!file || !businessId) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 200 * 1024) return emitAppToast({ tone: 'error', message: 'Choose a PNG or JPEG logo no larger than 200 KB.' });
    setUploadingLogo(true);
    try {
      const uploaded = await uploadFileToStorage({ file, entityType: 'business-profile', entityId: businessId, category: 'logo' });
      setLogoFileId(uploaded.fileId);
      setLogoPreviewUrl(URL.createObjectURL(file));
    } catch (error) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Company logo could not be uploaded.' });
    } finally { setUploadingLogo(false); }
  };

  const updatePaymentMethod = (type: string, changes: Partial<PaymentMethod>) => setInvoiceFields((current) => ({
    ...current,
    paymentMethods: current.paymentMethods.map((method) => method.type === type ? { ...method, ...changes } : method),
  }));

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/business', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ timezone, logoFileId, ...proposalFields, ...invoiceFields }) });
      const payload = await response.json() as { ok?: boolean; business?: BusinessPayload; error?: string };
      if (!response.ok || !payload.ok || !payload.business) throw new Error(payload.error ?? 'Customer Document settings could not be saved.');
      hydrate(payload.business);
      emitAppToast({ tone: 'success', message: 'Customer Document settings updated.' });
    } catch (error: unknown) {
      emitAppToast({ tone: 'error', message: error instanceof Error ? error.message : 'Customer Document settings could not be saved.' });
    } finally { setSaving(false); }
  };

  return <div>
    <PageHeader title="Customer Documents" subtitle="Control the identity and defaults customers see on Proposals and Invoices." />
    <div className="max-w-4xl space-y-5">
      <Card className="p-5">
        <div className="mb-5 flex items-center gap-3"><Building2 className="text-brand-700" /><div><p className="font-semibold text-brand-900 dark:text-brand-50">Company</p><p className="text-sm text-brand-500">Operational timezone and customer-facing identity.</p></div></div>
        <Select label="Business timezone" disabled={loading} value={timezone} onChange={(event) => setTimezone(event.target.value)}>{!commonTimezones.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}{commonTimezones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}</Select>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold text-brand-900 dark:text-brand-50">Branding</h2>
        <p className="mt-1 text-sm text-brand-500">Used across all customer-facing OliveOps documents and emails.</p>
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-brand-100 p-4"><div className="flex h-20 w-32 items-center justify-center overflow-hidden rounded border border-brand-100 bg-white">{logoPreviewUrl ? <img src={logoPreviewUrl} alt={`${name || 'Company'} logo`} className="max-h-full max-w-full object-contain" /> : <span className="px-3 text-center text-xs text-brand-400">Company name will be used</span>}</div><div className="flex gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white"><ImageUp size={15} />{uploadingLogo ? 'Uploading...' : logoFileId ? 'Replace logo' : 'Upload logo'}<input className="sr-only" type="file" accept="image/png,image/jpeg" disabled={loading || uploadingLogo} onChange={(event) => void uploadLogo(event.target.files?.[0])} /></label>{logoPreviewUrl ? <Button variant="secondary" onClick={() => { setLogoFileId(''); setLogoPreviewUrl(''); }}><Trash2 size={15} /> Remove</Button> : null}</div></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><Input label="Customer-facing company name" value={proposalFields.legalName} onChange={(event) => setProposalFields((current) => ({ ...current, legalName: event.target.value }))} /><Input label="Phone" value={proposalFields.phone} onChange={(event) => setProposalFields((current) => ({ ...current, phone: event.target.value }))} /><Input label="Email" type="email" value={proposalFields.email} onChange={(event) => setProposalFields((current) => ({ ...current, email: event.target.value }))} /><Input label="Website" value={proposalFields.website} onChange={(event) => setProposalFields((current) => ({ ...current, website: event.target.value }))} /><div className="sm:col-span-2"><TextArea label="Business address" rows={2} value={proposalFields.businessAddress} onChange={(event) => setProposalFields((current) => ({ ...current, businessAddress: event.target.value }))} /></div></div>
      </Card>
      <Card className="p-5"><h2 className="font-semibold text-brand-900 dark:text-brand-50">Proposals</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><Input label="Proposal tax label" value={proposalFields.taxLabel} onChange={(event) => setProposalFields((current) => ({ ...current, taxLabel: event.target.value }))} /><div className="sm:col-span-2"><TextArea label="Default proposal terms & conditions" rows={6} value={proposalFields.proposalTerms} onChange={(event) => setProposalFields((current) => ({ ...current, proposalTerms: event.target.value }))} /></div></div></Card>
      <Card className="p-5">
        <div className="flex items-center gap-3"><WalletCards className="text-brand-700" /><div><h2 className="font-semibold text-brand-900 dark:text-brand-50">Invoices & Payments</h2><p className="text-sm text-brand-500">Tell customers how to pay you directly. OliveOps does not process payments.</p></div></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><Input label="Default payment terms (days)" type="number" min={0} max={365} value={invoiceFields.defaultPaymentTermsDays} onChange={(event) => setInvoiceFields((current) => ({ ...current, defaultPaymentTermsDays: Number(event.target.value) }))} /><div className="sm:col-span-2"><TextArea label="General payment instructions" rows={3} value={invoiceFields.paymentInstructions} onChange={(event) => setInvoiceFields((current) => ({ ...current, paymentInstructions: event.target.value }))} /></div><div className="sm:col-span-2"><TextArea label="Default invoice notes" rows={3} value={invoiceFields.defaultInvoiceNotes} onChange={(event) => setInvoiceFields((current) => ({ ...current, defaultInvoiceNotes: event.target.value }))} /></div></div>
        <div className="mt-6 border-t border-brand-100 pt-5"><h3 className="text-sm font-semibold">Accepted payment methods</h3><div className="mt-3 divide-y divide-brand-100">{invoiceFields.paymentMethods.map((method) => <div key={method.type} className="grid gap-3 py-4 sm:grid-cols-[auto_1fr_2fr] sm:items-start"><label className="flex items-center gap-2 pt-2 text-sm font-semibold"><input type="checkbox" checked={method.enabled} onChange={(event) => updatePaymentMethod(method.type, { enabled: event.target.checked })} /> Accept</label><Input label="Display name" value={method.displayName} onChange={(event) => updatePaymentMethod(method.type, { displayName: event.target.value })} /><TextArea label="Customer instructions (optional)" rows={2} value={method.instructions} onChange={(event) => updatePaymentMethod(method.type, { instructions: event.target.value })} /></div>)}</div></div>
      </Card>
      <Button onClick={() => void save()} disabled={loading || saving || uploadingLogo}>{saving ? 'Saving...' : 'Save Customer Documents'}</Button>
    </div>
  </div>;
}
