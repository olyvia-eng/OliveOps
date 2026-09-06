import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Modal } from '../ui';
import { emitAppToast } from '../../toast';
import {
  addJobSops,
  listAvailableJobSops,
  listJobSops,
  removeJobSop,
  type AvailableJobSop,
  type JobSop,
} from '../../pages/jobs/jobSopApi';

interface Props {
  jobId: string;
  canManage: boolean;
}

export default function JobSopsCard({ jobId, canManage }: Props) {
  const [sops, setSops] = useState<JobSop[]>([]);
  const [available, setAvailable] = useState<AvailableJobSop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState('');

  const load = useCallback(async () => {
    try {
      const payload = await listJobSops(jobId);
      setSops(payload.sops);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Job SOPs could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  const openAdd = async () => {
    setModalOpen(true);
    setSearch('');
    setSelectedIds([]);
    try {
      const payload = await listAvailableJobSops(jobId);
      setAvailable(payload.sops);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Available SOPs could not be loaded.');
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return available.filter((sop) => !sop.associated && (!term || `${sop.title} ${sop.category} ${sop.shortDescription}`.toLocaleLowerCase().includes(term)));
  }, [available, search]);

  const addSelected = async () => {
    if (selectedIds.length === 0) return;
    setSaving(true);
    try {
      await addJobSops(jobId, selectedIds);
      await load();
      setModalOpen(false);
      emitAppToast({ tone: 'success', message: selectedIds.length === 1 ? 'SOP added to Job.' : `${selectedIds.length} SOPs added to Job.` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SOPs could not be added.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (sopId: string) => {
    setRemovingId(sopId);
    try {
      await removeJobSop(jobId, sopId);
      setSops((current) => current.filter((sop) => sop.sopId !== sopId));
      emitAppToast({ tone: 'success', message: 'SOP removed from Job.' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SOP could not be removed.');
    } finally {
      setRemovingId('');
    }
  };

  return <>
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold text-gray-900">SOPs for this Job</h2><p className="text-sm text-gray-500">Procedures that apply to this job.</p></div>
        {canManage ? <Button size="sm" variant="secondary" onClick={() => void openAdd()}><Plus size={14} /> Add SOP</Button> : null}
      </div>
      {error ? <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="mt-4 text-sm text-gray-500">Loading Job SOPs...</p> : sops.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No SOPs have been added to this Job" description="Add published procedures that the team should follow on this Job." />
      ) : <ul className="mt-4 divide-y divide-gray-100 border-y border-gray-100">
        {sops.map((sop) => <li key={sop.sopId} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-gray-900">{sop.title}</p><Badge label={`v${sop.version}`} className="bg-gray-100 text-gray-600" /></div><p className="mt-0.5 text-sm text-gray-500">{sop.category || 'Uncategorized'}{sop.shortDescription ? ` · ${sop.shortDescription}` : ''}</p></div>
          <div className="flex items-center gap-1">
            <Link className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50" to={`/jobs/${jobId}/sops/${sop.sopId}`}>View <ExternalLink size={14} /></Link>
            {canManage ? <button type="button" title={`Remove ${sop.title} from Job`} aria-label={`Remove ${sop.title} from Job`} disabled={removingId === sop.sopId} onClick={() => void remove(sop.sopId)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"><Trash2 size={15} /></button> : null}
          </div>
        </li>)}
      </ul>}
    </Card>

    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add SOPs to Job" footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button disabled={saving || selectedIds.length === 0} onClick={() => void addSelected()}>{saving ? 'Adding...' : `Add ${selectedIds.length || ''} SOP${selectedIds.length === 1 ? '' : 's'}`}</Button></>}>
      <Input label="Search SOPs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, category, or description" />
      <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
        {filtered.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">No published SOPs match this search.</p> : filtered.map((sop) => {
          const selected = selectedIds.includes(sop.sopId);
          return <label key={sop.sopId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={selected} onChange={() => setSelectedIds((current) => selected ? current.filter((id) => id !== sop.sopId) : [...current, sop.sopId])} />
            <span className="min-w-0"><span className="block font-medium text-gray-900">{sop.title}</span><span className="block text-sm text-gray-500">{sop.category || 'Uncategorized'} · v{sop.currentVersion}</span>{sop.shortDescription ? <span className="mt-1 block text-sm text-gray-600">{sop.shortDescription}</span> : null}</span>
          </label>;
        })}
      </div>
    </Modal>
  </>;
}