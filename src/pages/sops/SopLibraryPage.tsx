import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Copy, Plus, RotateCcw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, PageHeader, Select } from '../../components/ui';
import type { SopDefinition } from '../../types/sop';
import { archiveSop, duplicateSop, listSops, reactivateSop } from './sopApi';

const statusLabel = (sop: SopDefinition) => sop.status === 'draft' ? 'Draft' : sop.active ? 'Published' : 'Archived';
const statusClass = (sop: SopDefinition) => sop.status === 'draft'
  ? 'bg-amber-50 text-amber-700'
  : sop.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600';

export default function SopLibraryPage() {
  const navigate = useNavigate();
  const [definitions, setDefinitions] = useState<SopDefinition[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await listSops();
      setDefinitions(payload.definitions);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SOPs could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => [...new Set(definitions.map((sop) => sop.category).filter(Boolean))].sort(), [definitions]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return definitions.filter((sop) => {
      const matchesQuery = !normalizedQuery || `${sop.title} ${sop.category} ${sop.shortDescription}`.toLowerCase().includes(normalizedQuery);
      const matchesCategory = category === 'all' || sop.category === category;
      const matchesStatus = status === 'all'
        || (status === 'active' && sop.active && sop.status === 'published')
        || (status === 'archived' && !sop.active)
        || sop.status === status;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [category, definitions, query, status]);

  const runAction = async (sop: SopDefinition, action: 'duplicate' | 'archive' | 'reactivate') => {
    setBusyId(sop.id);
    setError('');
    try {
      if (action === 'duplicate') {
        const payload = await duplicateSop(sop.id);
        navigate(`/sops/${payload.definition.id}/edit`);
        return;
      }
      if (action === 'archive') await archiveSop(sop.id);
      else await reactivateSop(sop.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `SOP could not be ${action}d.`);
    } finally {
      setBusyId('');
    }
  };

  return <div className="space-y-5">
    <PageHeader title="Standard Operating Procedures" subtitle="Which procedure needs to be created, updated, or published?" action={<Button onClick={() => navigate('/sops/new')}><Plus size={16} /> New SOP</Button>} />
    <Card className="overflow-hidden">
      <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-[minmax(0,1fr)_220px_180px]">
        <label className="relative"><Search className="absolute left-3 top-2.5 text-gray-400" size={16} /><input aria-label="Search SOPs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search procedures..." className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm" /></label>
        <Select aria-label="Filter SOP category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</Select>
        <Select aria-label="Filter SOP status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></Select>
      </div>
      {error ? <p role="alert" className="border-b border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="p-5 text-sm text-gray-500">Loading SOPs...</p> : visible.length === 0 ? <div className="p-6"><EmptyState title="No SOPs found" description="Create a procedure or adjust the filters to see more results." /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead><tr className="border-b bg-gray-50 text-left text-gray-500"><th className="px-4 py-3">Title</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y">{visible.map((sop) => <tr key={sop.id} className="hover:bg-gray-50"><td className="px-4 py-3"><button type="button" className="text-left font-semibold text-brand-700 hover:underline" onClick={() => navigate(`/sops/${sop.id}`)}>{sop.title}</button><p className="mt-1 max-w-xl truncate text-xs text-gray-500">{sop.shortDescription || 'No description'}</p></td><td className="px-4 py-3">{sop.category || 'Uncategorized'}</td><td className="px-4 py-3"><Badge label={statusLabel(sop)} className={statusClass(sop)} /></td><td className="px-4 py-3">{sop.currentVersion ? `v${sop.currentVersion}` : '—'}</td><td className="px-4 py-3">{new Date(sop.updatedAt).toLocaleDateString()}</td><td className="px-4 py-3"><div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => navigate(`/sops/${sop.id}`)}>Open</Button><Button size="sm" variant="ghost" title="Duplicate SOP" aria-label={`Duplicate ${sop.title}`} disabled={busyId === sop.id} onClick={() => void runAction(sop, 'duplicate')}><Copy size={14} /></Button>{sop.active ? <Button size="sm" variant="ghost" title="Archive SOP" aria-label={`Archive ${sop.title}`} disabled={busyId === sop.id} onClick={() => void runAction(sop, 'archive')}><Archive size={14} /></Button> : sop.currentVersion > 0 ? <Button size="sm" variant="ghost" title="Reactivate SOP" aria-label={`Reactivate ${sop.title}`} disabled={busyId === sop.id} onClick={() => void runAction(sop, 'reactivate')}><RotateCcw size={14} /></Button> : null}</div></td></tr>)}</tbody></table></div>}
    </Card>
  </div>;
}