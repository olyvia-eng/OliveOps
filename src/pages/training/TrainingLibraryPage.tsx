import { useEffect, useMemo, useState } from 'react';
import { Copy, Ellipsis, Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, PageHeader, Select, StatCard } from '../../components/ui';
import type { TrainingAssignment, TrainingDefinition } from '../../types/training';
import { recurrenceLabel, trainingRequest, type TrainingListPayload } from './trainingApi';

export default function TrainingLibraryPage() {
  const navigate = useNavigate();
  const [definitions, setDefinitions] = useState<TrainingDefinition[]>([]);
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => trainingRequest<TrainingListPayload>('list').then((payload) => { setDefinitions(payload.definitions); setAssignments(payload.assignments); setError(''); }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Training could not be loaded.')).finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => definitions.filter((item) => (!query.trim() || `${item.title} ${item.shortDescription}`.toLowerCase().includes(query.trim().toLowerCase())) && (status === 'all' || (status === 'active' ? item.active : status === 'inactive' ? !item.active : item.status === status))), [definitions, query, status]);
  const activeAssignments = assignments.filter((item) => !item.revokedAt);
  const duplicate = async (training: TrainingDefinition) => {
    const payload = await trainingRequest<{ ok: true; definition: TrainingDefinition }>('create', { method: 'POST', body: { requestId: crypto.randomUUID(), training: { ...training, title: `${training.title} Copy`, attachmentFileId: null } } });
    navigate(`/training/${payload.definition.id}/edit`);
  };
  const deactivate = async (training: TrainingDefinition) => {
    await trainingRequest('set-active', { method: 'POST', body: { trainingId: training.id, active: false } });
    await load();
  };

  return <div className="space-y-5">
    <PageHeader title="Training" subtitle="Which employee training needs attention, and what should be assigned next?" action={<Button onClick={() => navigate('/training/new')}><Plus size={16} /> New Training</Button>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active training modules" value={definitions.filter((item) => item.active && item.currentVersion > 0).length} />
      <StatCard label="Assigned" value={activeAssignments.length} />
      <StatCard label="Due soon" value={activeAssignments.filter((item) => item.presentationStatus === 'due_soon').length} />
      <StatCard label="Overdue" value={activeAssignments.filter((item) => item.presentationStatus === 'overdue').length} />
    </div>
    <Card className="overflow-hidden">
      <div className="grid gap-3 border-b border-gray-100 p-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <label className="relative"><Search className="absolute left-3 top-2.5 text-gray-400" size={16} /><input aria-label="Search training" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search training..." className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm" /></label>
        <Select aria-label="Filter training status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="draft">Draft</option><option value="inactive">Inactive</option><option value="all">All statuses</option></Select>
      </div>
      {loading ? <p className="p-5 text-sm text-gray-500">Loading training...</p> : error ? <p className="p-5 text-sm text-red-700">{error}</p> : visible.length === 0 ? <div className="p-6"><EmptyState title="No training modules" description="Create a reusable module, publish a version, and assign it to employees." /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b bg-gray-50 text-left text-gray-500"><th className="px-4 py-3">Title</th><th className="px-4 py-3">Recurrence</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Current / Due / Overdue</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y">{visible.map((training) => {
        const scoped = activeAssignments.filter((item) => item.trainingId === training.id);
        return <tr key={training.id} className="hover:bg-gray-50"><td className="px-4 py-3"><button className="font-semibold text-brand-700" onClick={() => navigate(`/training/${training.id}`)}>{training.title}</button><div className="mt-1"><Badge label={training.status === 'draft' ? 'Draft' : training.active ? 'Active' : 'Inactive'} className={training.status === 'draft' ? 'bg-amber-50 text-amber-700' : training.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'} /></div></td><td className="px-4 py-3">{recurrenceLabel(training)}</td><td className="px-4 py-3">v{training.currentVersion || '—'}</td><td className="px-4 py-3">{scoped.length}</td><td className="px-4 py-3">{scoped.filter((item) => item.presentationStatus === 'current').length} / {scoped.filter((item) => item.presentationStatus === 'due_soon').length} / {scoped.filter((item) => item.presentationStatus === 'overdue').length}</td><td className="px-4 py-3">{new Date(training.updatedAt).toLocaleDateString()}</td><td className="px-4 py-3"><div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => navigate(`/training/${training.id}`)}>Open</Button><Button size="sm" variant="ghost" title="Duplicate" onClick={() => void duplicate(training)}><Copy size={14} /></Button>{training.active ? <Button size="sm" variant="ghost" title="Deactivate" onClick={() => void deactivate(training)}><Ellipsis size={14} /></Button> : null}</div></td></tr>;
      })}</tbody></table></div>}
    </Card>
  </div>;
}