import { useMemo, useState } from 'react';
import { ChevronRight, Search, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, PageHeader } from '../../components/ui';
import { useStore } from '../../store';
import type { JobStatus } from '../../types';
import { formatDate, statusColor } from '../../utils';
import { resolveWorkType } from '../../utils/workTypeModel.js';

const STATUSES: JobStatus[] = ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'];
const serviceSummary = (job: ReturnType<typeof useStore.getState>['jobs'][number]) => {
  const services = job.services ?? [];
  const active = services.filter((service) => service.status === 'active');
  const recurring = active.find((service) => service.scheduleType === 'recurring');
  if (!recurring) return `${active.length} active · ${services.length} total`;
  const interval = recurring.frequency?.interval ?? 1;
  const unit = recurring.frequency?.unit ?? 'week';
  return `${active.length} active · Every ${interval === 1 ? '' : `${interval} `}${unit}${interval === 1 ? '' : 's'}`;
};

export default function ServiceJobsPage() {
  const { jobs, customers } = useStore();
  const navigate = useNavigate();
  const serviceJobs = jobs.filter((job) => resolveWorkType(job) === 'service');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const filtered = useMemo(() => serviceJobs.filter((job) => {
    const query = search.trim().toLowerCase();
    const customer = customers.find((item) => item.id === job.customerId);
    return (!query || job.title.toLowerCase().includes(query) || customer?.name.toLowerCase().includes(query))
      && (status === 'all' || job.status === status);
  }), [customers, search, serviceJobs, status]);

  return <div>
    <PageHeader title="Service Jobs" subtitle="Active agreements, upcoming service coverage, and operational status." />
    <div className="mb-6 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-gray-400" size={16} /><input className="h-10 w-full rounded-xl border border-brand-100 bg-white pl-9 pr-3 text-sm dark:border-brand-600 dark:bg-brand-700" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service jobs" /></div><select className="h-10 rounded-xl border border-brand-100 bg-white px-3 text-sm dark:border-brand-600 dark:bg-brand-700" value={status} onChange={(event) => setStatus(event.target.value as JobStatus | 'all')}><option value="all">All statuses</option>{STATUSES.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select></div>
    {filtered.length === 0 ? <EmptyState icon={<Wrench />} title={serviceJobs.length ? 'No Service Jobs found' : 'No Service Jobs yet'} description="Accept and convert a Service Estimate to create a Service Job." action={<Button onClick={() => navigate('/estimates/services')}>Open Service Estimates</Button>} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-brand-100 text-left text-brand-400"><th className="pb-2 font-medium">Service Job</th><th className="pb-2 font-medium">Customer</th><th className="pb-2 font-medium">Coverage</th><th className="pb-2 font-medium">Term</th><th className="pb-2 font-medium">Status</th><th className="pb-2" /></tr></thead><tbody className="divide-y divide-brand-100">{filtered.map((job) => {
      const customer = customers.find((item) => item.id === job.customerId);
      return <tr key={job.id} className="cursor-pointer hover:bg-accent-50/60" onClick={() => navigate(`/jobs/${job.id}`)}><td className="py-3 font-semibold"><Link to={`/jobs/${job.id}`} onClick={(event) => event.stopPropagation()}>{job.title}</Link><p className="mt-0.5 text-xs font-normal text-brand-400">{job.jobNumber ?? 'No job number'}</p></td><td className="py-3 text-brand-600">{customer?.name ?? 'Unknown client'}</td><td className="py-3 text-brand-600">{serviceSummary(job)}</td><td className="py-3 text-brand-600">{formatDate(job.startDate)}{job.endDate ? ` - ${formatDate(job.endDate)}` : ''}</td><td className="py-3"><Badge label={job.status} className={statusColor[job.status]} /></td><td className="py-3 text-right"><Button variant="ghost" size="sm" title="Open Service Job" onClick={() => navigate(`/jobs/${job.id}`)}><ChevronRight /></Button></td></tr>;
    })}</tbody></table></div>}
  </div>;
}