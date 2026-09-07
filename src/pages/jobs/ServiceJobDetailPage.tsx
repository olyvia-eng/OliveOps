import { useEffect, useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { Job, JobStatus } from '../../types';
import { formatCurrency, formatDate, statusColor } from '../../utils';

const STATUSES: JobStatus[] = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];

export default function ServiceJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { jobs, customers, budgetDivisions, updateJob } = useStore();
  const job = jobs.find((item) => item.id === id);
  const [form, setForm] = useState<Job | null>(job ?? null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(job ?? null), [job]);
  if (!job || !form) return <EmptyState title="Service Job not found" description="It may have been removed or you may not have access." action={<Button onClick={() => navigate('/jobs/services')}><ArrowLeft /> Service Jobs</Button>} />;
  const customer = customers.find((item) => item.id === form.customerId);
  const setField = <K extends keyof Job>(key: K, value: Job[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    const saved = await updateJob(job.id, { ...form, workType: 'service', title: form.title.trim(), description: form.description ?? '', notes: form.notes ?? '' });
    setSaving(false);
    if (saved) emitAppToast({ tone: 'success', message: 'Service Job saved.' });
  };

  return <div>
    <button type="button" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600" onClick={() => navigate('/jobs/services')}><ArrowLeft size={16} /> Service Jobs</button>
    <PageHeader title={job.title} subtitle={`${job.jobNumber ?? 'Service Job'}${customer ? ` · ${customer.name}` : ''}`} action={<div className="flex items-center gap-2"><Badge label={form.status} className={statusColor[form.status]} /><Button onClick={() => void save()} disabled={saving}><Save /> {saving ? 'Saving...' : 'Save'}</Button></div>} />
    <div className="space-y-6"><Card className="p-5"><h2 className="mb-4 font-semibold">Agreement</h2><div className="grid gap-4 sm:grid-cols-2"><Input label="Title" required value={form.title} onChange={(event) => setField('title', event.target.value)} /><Select label="Status" value={form.status} onChange={(event) => setField('status', event.target.value as JobStatus)}>{STATUSES.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</Select><Input label="Start date" type="date" value={form.startDate} onChange={(event) => setField('startDate', event.target.value)} /><Input label="End date" type="date" value={form.endDate ?? ''} onChange={(event) => setField('endDate', event.target.value || undefined)} /></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><TextArea label="Description" value={form.description} onChange={(event) => setField('description', event.target.value)} /><TextArea label="Internal notes" value={form.notes} onChange={(event) => setField('notes', event.target.value)} /></div></Card>
      {form.originalEstimateSnapshot ? <Card className="p-5"><h2 className="font-semibold">Accepted pricing</h2><div className="mt-4 grid gap-4 sm:grid-cols-4"><div><p className="text-xs text-brand-400">Contracted</p><p className="font-semibold">{formatCurrency(form.originalEstimateSnapshot.contractedRevenue ?? 0)}</p></div><div><p className="text-xs text-brand-400">Projected per visit</p><p className="font-semibold">{formatCurrency(form.originalEstimateSnapshot.projectedPerVisitRevenue ?? 0)}</p></div><div><p className="text-xs text-brand-400">Projected T&M</p><p className="font-semibold">{formatCurrency(form.originalEstimateSnapshot.projectedTimeAndMaterialRevenue ?? 0)}</p></div><div><p className="text-xs text-brand-400">Estimated cost</p><p className="font-semibold">{formatCurrency(form.originalEstimateSnapshot.estimatedCost ?? 0)}</p></div></div></Card> : null}
      <section><div className="mb-3"><h2 className="font-semibold">Included Services</h2><p className="text-sm text-brand-400">These commitments and prices were copied from the accepted Estimate. No Visits have been generated.</p></div><div className="space-y-3">{(form.services ?? []).map((service) => {
        const division = budgetDivisions.find((item) => item.id === service.divisionId);
        return <Card key={service.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-brand-900 dark:text-brand-50">{service.name}</h3>{service.description ? <p className="mt-1 text-sm text-brand-500">{service.description}</p> : null}</div><div className="flex gap-2"><Badge label={service.scheduleType} className="bg-brand-100 text-brand-700" /><Badge label={service.billingType} className="bg-accent-50 text-accent-700" /></div></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-brand-400">Division</dt><dd className="font-medium">{division?.name ?? 'Not assigned'}</dd></div><div><dt className="text-brand-400">Service window</dt><dd className="font-medium">{service.startDate ? formatDate(service.startDate) : 'As needed'}{service.endDate ? ` - ${formatDate(service.endDate)}` : ''}</dd></div><div><dt className="text-brand-400">Estimated visits</dt><dd className="font-medium">{service.estimatedVisits ?? 'Not set'}</dd></div></dl></Card>;
      })}{(form.services ?? []).length === 0 ? <EmptyState title="No services recorded" description="This Service Job has no included service definitions." /> : null}</div></section>
    </div>
  </div>;
}