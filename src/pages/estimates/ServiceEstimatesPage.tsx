import { useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { Estimate, EstimateStatus } from '../../types';
import { formatCurrency, formatDate, statusColor } from '../../utils';
import { calculateServiceEstimateTotals } from '../../utils/servicePricingModel.js';
import { resolveWorkType } from '../../utils/workTypeModel.js';

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'converted'];

const defaultValidUntil = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
};

const nextProposalNumber = (estimates: Estimate[]) => {
  const prefix = `SVC-${new Date().getFullYear()}-`;
  const used = new Set(estimates.map((estimate) => estimate.proposalNumber ?? '').filter((number) => number.startsWith(prefix)).map((number) => Number(number.slice(prefix.length))));
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return `${prefix}${String(sequence).padStart(4, '0')}`;
};

export default function ServiceEstimatesPage() {
  const { estimates, customers, budgets, addEstimate } = useStore();
  const navigate = useNavigate();
  const serviceEstimates = estimates.filter((estimate) => resolveWorkType(estimate) === 'service');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EstimateStatus | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customerId: '', pricingBudgetId: '', title: '', serviceStartDate: '', serviceEndDate: '' });
  const filtered = useMemo(() => serviceEstimates.filter((estimate) => {
    const customer = customers.find((item) => item.id === estimate.customerId);
    const query = search.trim().toLowerCase();
    return (!query || estimate.title.toLowerCase().includes(query) || customer?.name.toLowerCase().includes(query))
      && (status === 'all' || estimate.status === status);
  }), [customers, search, serviceEstimates, status]);

  const openCreate = () => {
    if (customers.length === 0) {
      emitAppToast({ tone: 'error', message: 'Add a client before creating a Service Estimate.' });
      navigate('/crm');
      return;
    }
    setForm({ customerId: '', pricingBudgetId: '', title: '', serviceStartDate: '', serviceEndDate: '' });
    setCreating(true);
  };

  const createEstimate = async () => {
    if (!form.customerId || !form.pricingBudgetId || !form.title.trim() || saving) return;
    if (form.serviceStartDate && form.serviceEndDate && form.serviceEndDate < form.serviceStartDate) {
      emitAppToast({ tone: 'error', message: 'End date cannot precede start date.' });
      return;
    }
    setSaving(true);
    const id = await addEstimate({
      workType: 'service',
      customerId: form.customerId,
      pricingBudgetId: form.pricingBudgetId,
      proposalNumber: nextProposalNumber(estimates),
      title: form.title.trim(),
      description: '',
      services: [],
      lineItems: [],
      status: 'draft',
      taxRate: 13,
      notes: '',
      validUntil: defaultValidUntil(),
      serviceStartDate: form.serviceStartDate || undefined,
      serviceEndDate: form.serviceEndDate || undefined,
    });
    setSaving(false);
    if (!id) return;
    setCreating(false);
    navigate(`/estimates/${id}`);
  };

  return <div>
    <PageHeader title="Service Estimates" subtitle="Define recurring, one-time, and as-needed customer services." action={<Button onClick={openCreate}><Plus /> New Service Estimate</Button>} />
    <div className="mb-6 flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-3 text-gray-400" size={16} /><input className="h-10 w-full rounded-xl border border-brand-100 bg-white pl-9 pr-3 text-sm dark:border-brand-600 dark:bg-brand-700" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service estimates" /></div>
      <select className="h-10 rounded-xl border border-brand-100 bg-white px-3 text-sm dark:border-brand-600 dark:bg-brand-700" value={status} onChange={(event) => setStatus(event.target.value as EstimateStatus | 'all')}><option value="all">All statuses</option>{STATUSES.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select>
    </div>
    {filtered.length === 0 ? <EmptyState icon={<Wrench />} title={serviceEstimates.length ? 'No Service Estimates found' : 'Create your first Service Estimate'} description="Define the service agreement now. Visits will be planned in a later phase." action={<Button onClick={openCreate}><Plus /> New Service Estimate</Button>} /> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-brand-100 text-left text-brand-400"><th className="pb-2 font-medium">Estimate</th><th className="pb-2 font-medium">Customer</th><th className="pb-2 font-medium">Services</th><th className="pb-2 font-medium">Value</th><th className="pb-2 font-medium">Term</th><th className="pb-2 font-medium">Status</th><th className="pb-2" /></tr></thead><tbody className="divide-y divide-brand-100">{filtered.map((estimate) => {
        const customer = customers.find((item) => item.id === estimate.customerId);
        const totals = calculateServiceEstimateTotals(estimate.services, estimate.taxRate);
        return <tr key={estimate.id} className="cursor-pointer hover:bg-accent-50/60" onClick={() => navigate(`/estimates/${estimate.id}`)}><td className="py-3 font-semibold"><Link to={`/estimates/${estimate.id}`} onClick={(event) => event.stopPropagation()}>{estimate.title}</Link><p className="mt-0.5 text-xs font-normal text-brand-400">{estimate.proposalNumber}</p></td><td className="py-3 text-brand-600">{customer?.name ?? 'Unknown client'}</td><td className="py-3 text-brand-600">{estimate.services?.length ?? 0}</td><td className="py-3 font-medium">{formatCurrency(totals.estimatedRevenue)}<p className="text-xs font-normal text-brand-400">{formatCurrency(totals.contractedRevenue)} contracted</p></td><td className="py-3 text-brand-600">{estimate.serviceStartDate ? formatDate(estimate.serviceStartDate) : 'Open'}{estimate.serviceEndDate ? ` - ${formatDate(estimate.serviceEndDate)}` : ''}</td><td className="py-3"><Badge label={estimate.status} className={statusColor[estimate.status]} /></td><td className="py-3 text-right"><Button variant="ghost" size="sm" title="Open Service Estimate" onClick={() => navigate(`/estimates/${estimate.id}`)}><ChevronRight /></Button></td></tr>;
      })}</tbody></table></div>}
    <Modal open={creating} onClose={() => setCreating(false)} title="New Service Estimate" footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={saving || !form.customerId || !form.pricingBudgetId || !form.title.trim()} onClick={() => void createEstimate()}>{saving ? 'Creating...' : 'Create Estimate'}</Button></>}>
      <div className="space-y-4"><Select label="Customer" required value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))}><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</Select><Select label="Pricing Budget" required value={form.pricingBudgetId} onChange={(event) => setForm((current) => ({ ...current, pricingBudgetId: event.target.value }))}><option value="">Select budget</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}</Select><Input label="Agreement title" required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Seasonal grounds maintenance" /><div className="grid gap-3 sm:grid-cols-2"><Input label="Service start" type="date" value={form.serviceStartDate} onChange={(event) => setForm((current) => ({ ...current, serviceStartDate: event.target.value }))} /><Input label="Service end" type="date" value={form.serviceEndDate} onChange={(event) => setForm((current) => ({ ...current, serviceEndDate: event.target.value }))} /></div></div>
    </Modal>
  </div>;
}