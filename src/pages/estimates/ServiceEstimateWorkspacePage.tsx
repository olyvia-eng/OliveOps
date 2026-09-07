import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { Estimate, EstimateService, EstimateStatus } from '../../types';
import { statusColor } from '../../utils';
import { calculateSuggestedServiceVisits, normalizeEstimateServices } from '../../utils/workTypeModel.js';

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'converted'];
const newService = (): EstimateService => ({ id: crypto.randomUUID(), name: '', description: '', sortOrder: 0, scheduleType: 'recurring', billingType: 'contract', frequency: { interval: 1, unit: 'week' } });

export default function ServiceEstimateWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { estimates, customers, budgets, budgetDivisions, updateEstimate, convertEstimateToJob } = useStore();
  const estimate = estimates.find((item) => item.id === id);
  const [form, setForm] = useState<Estimate | null>(estimate ?? null);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  useEffect(() => setForm(estimate ?? null), [estimate]);

  if (!estimate || !form) return <EmptyState title="Service Estimate not found" description="It may have been removed or you may not have access." action={<Button onClick={() => navigate('/estimates/services')}><ArrowLeft /> Service Estimates</Button>} />;
  const services = form.services ?? [];
  const divisions = budgetDivisions.filter((division) => division.budgetId === form.pricingBudgetId && division.status === 'active').sort((left, right) => left.name.localeCompare(right.name));
  const setField = <K extends keyof Estimate>(key: K, value: Estimate[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const updateService = (serviceId: string, patch: Partial<EstimateService>) => setField('services', services.map((service) => service.id === serviceId ? { ...service, ...patch } : service));

  const save = async () => {
    if (!form.title.trim() || !form.customerId || !form.pricingBudgetId || saving) return;
    setSaving(true);
    const normalizedServices = normalizeEstimateServices(form.services);
    const saved = await updateEstimate(estimate.id, { ...form, workType: 'service', title: form.title.trim(), description: form.description ?? '', notes: form.notes ?? '', services: normalizedServices });
    setSaving(false);
    if (saved) emitAppToast({ tone: 'success', message: 'Service Estimate saved.' });
  };

  const convert = async () => {
    if (converting) return;
    setConverting(true);
    const result = await convertEstimateToJob(estimate.id, {});
    setConverting(false);
    if (!result.ok) return emitAppToast({ tone: 'error', message: result.error ?? 'Service Estimate could not be converted.' });
    if (result.jobId) navigate(`/jobs/${result.jobId}`);
  };

  return <div>
    <button type="button" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600" onClick={() => navigate('/estimates/services')}><ArrowLeft size={16} /> Service Estimates</button>
    <PageHeader title={estimate.title} subtitle={estimate.proposalNumber ? `Service Estimate ${estimate.proposalNumber}` : 'Service Estimate'} action={<div className="flex gap-2"><Badge label={form.status} className={statusColor[form.status]} /><Button onClick={() => void save()} disabled={saving}><Save /> {saving ? 'Saving...' : 'Save'}</Button></div>} />
    <div className="space-y-6">
      <Card className="p-5"><h2 className="mb-4 font-semibold text-brand-900 dark:text-brand-50">Agreement</h2><div className="grid gap-4 sm:grid-cols-2"><Input label="Title" required value={form.title} onChange={(event) => setField('title', event.target.value)} /><Select label="Customer" required value={form.customerId} onChange={(event) => setField('customerId', event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</Select><Select label="Pricing Budget" required value={form.pricingBudgetId} onChange={(event) => { setField('pricingBudgetId', event.target.value); setField('services', services.map((service) => ({ ...service, divisionId: undefined }))); }}>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}</Select><Select label="Status" value={form.status} onChange={(event) => setField('status', event.target.value as EstimateStatus)}>{STATUSES.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</Select><Input label="Service start" type="date" value={form.serviceStartDate ?? ''} onChange={(event) => setField('serviceStartDate', event.target.value || undefined)} /><Input label="Service end" type="date" value={form.serviceEndDate ?? ''} onChange={(event) => setField('serviceEndDate', event.target.value || undefined)} /></div><div className="mt-4"><TextArea label="Agreement notes" value={form.notes ?? ''} onChange={(event) => setField('notes', event.target.value)} /></div></Card>
      <section><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold text-brand-900 dark:text-brand-50">Services</h2><p className="text-sm text-brand-400">Define commitments only. This does not generate Visits.</p></div><Button variant="secondary" onClick={() => setField('services', [...services, { ...newService(), sortOrder: services.length }])}><Plus /> Add Service</Button></div>
        {services.length === 0 ? <EmptyState title="No services defined" description="Add the first service included in this agreement." action={<Button onClick={() => setField('services', [{ ...newService(), sortOrder: 0 }])}><Plus /> Add Service</Button>} /> : <div className="space-y-3">{services.map((service, index) => {
          const suggestedVisits = calculateSuggestedServiceVisits(service);
          return <Card key={service.id} className="p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Service {index + 1}</h3><Button variant="ghost" size="sm" title="Remove Service" onClick={() => setField('services', services.filter((item) => item.id !== service.id))}><Trash2 /></Button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Input label="Service name" required value={service.name} onChange={(event) => updateService(service.id, { name: event.target.value })} /><Select label="Division" value={service.divisionId ?? ''} onChange={(event) => updateService(service.id, { divisionId: event.target.value || undefined })}><option value="">No division</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</Select><Select label="Schedule" value={service.scheduleType} onChange={(event) => updateService(service.id, { scheduleType: event.target.value as EstimateService['scheduleType'] })}><option value="recurring">Recurring</option><option value="one_time">One time</option><option value="as_needed">As needed</option></Select><Select label="Billing" value={service.billingType} onChange={(event) => updateService(service.id, { billingType: event.target.value as EstimateService['billingType'] })}><option value="contract">Contract</option><option value="per_visit">Per visit</option><option value="time_and_material">Time and material</option></Select><Input label={service.scheduleType === 'one_time' ? 'Expected visit' : 'Start date'} type="date" value={service.startDate ?? ''} onChange={(event) => updateService(service.id, { startDate: event.target.value || undefined })} />{service.scheduleType !== 'one_time' ? <Input label="End date" type="date" value={service.endDate ?? ''} onChange={(event) => updateService(service.id, { endDate: event.target.value || undefined })} /> : null}{service.scheduleType === 'recurring' ? <><Input label="Every" type="number" min={1} value={service.frequency?.interval ?? 1} onChange={(event) => updateService(service.id, { frequency: { interval: Number(event.target.value), unit: service.frequency?.unit ?? 'week' } })} /><Select label="Frequency unit" value={service.frequency?.unit ?? 'week'} onChange={(event) => updateService(service.id, { frequency: { interval: service.frequency?.interval ?? 1, unit: event.target.value as 'day' | 'week' | 'month' } })}><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option></Select></> : null}<Input label="Estimated visits" type="number" min={0} value={service.estimatedVisits ?? suggestedVisits ?? ''} onChange={(event) => updateService(service.id, { estimatedVisits: event.target.value === '' ? undefined : Number(event.target.value) })} /></div><div className="mt-4"><TextArea label="Scope" value={service.description} onChange={(event) => updateService(service.id, { description: event.target.value })} /></div>{suggestedVisits !== undefined ? <p className="mt-3 text-xs text-brand-400">Schedule suggests {suggestedVisits} visit{suggestedVisits === 1 ? '' : 's'}.</p> : null}</Card>;
        })}</div>}
      </section>
      {form.status === 'accepted' ? <div className="flex justify-end"><Button onClick={() => void convert()} disabled={converting || services.length === 0}><RefreshCw /> {converting ? 'Converting...' : 'Convert to Service Job'}</Button></div> : null}
    </div>
  </div>;
}