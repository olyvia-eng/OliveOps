import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Select, StatCard } from '../../components/ui';
import { emitAppToast } from '../../toast';
import type { TrainingAssignment, TrainingDefinition } from '../../types/training';
import { calculateFixedMenuPosition } from '../../utils/fixedMenuPosition.js';
import { recurrenceLabel, trainingRequest, type TrainingListPayload } from './trainingApi';

export default function TrainingLibraryPage() {
  const navigate = useNavigate();
  const [definitions, setDefinitions] = useState<TrainingDefinition[]>([]);
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [menuTrainingId, setMenuTrainingId] = useState<string | null>(null);
  const [statusConfirmation, setStatusConfirmation] = useState<TrainingDefinition | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [duplicateSavingId, setDuplicateSavingId] = useState<string | null>(null);
  const statusRequestInFlight = useRef(false);
  const duplicateRequestInFlight = useRef(false);

  const load = useCallback(() => trainingRequest<TrainingListPayload>('list').then((payload) => { setDefinitions(payload.definitions); setAssignments(payload.assignments); setError(''); }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Training could not be loaded.')).finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => definitions.filter((item) => (!query.trim() || `${item.title} ${item.shortDescription}`.toLowerCase().includes(query.trim().toLowerCase())) && (status === 'all' || (status === 'active' ? item.active : status === 'inactive' ? !item.active : item.status === status))), [definitions, query, status]);
  const activeAssignments = assignments.filter((item) => !item.revokedAt);
  const duplicate = async (training: TrainingDefinition) => {
    if (duplicateRequestInFlight.current) return;
    duplicateRequestInFlight.current = true;
    setDuplicateSavingId(training.id);
    setError('');
    try {
      const payload = await trainingRequest<{ ok: true; definition: TrainingDefinition }>('create', { method: 'POST', body: { requestId: crypto.randomUUID(), training: { ...training, title: `${training.title} Copy`, attachmentFileId: null } } });
      emitAppToast({ tone: 'success', message: 'Training duplicated as a new draft.' });
      navigate(`/training/${payload.definition.id}/edit`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Training could not be duplicated.';
      setError(message);
      emitAppToast({ tone: 'error', message });
    } finally {
      duplicateRequestInFlight.current = false;
      setDuplicateSavingId(null);
    }
  };
  const setActive = async () => {
    if (!statusConfirmation || statusRequestInFlight.current) return;
    statusRequestInFlight.current = true;
    setStatusSaving(true);
    setError('');
    const nextActive = !statusConfirmation.active;
    try {
      await trainingRequest('set-active', { method: 'POST', body: { trainingId: statusConfirmation.id, active: nextActive } });
      setStatusConfirmation(null);
      await load();
      emitAppToast({ tone: 'success', message: nextActive ? 'Training reactivated.' : 'Training deactivated.' });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `Training could not be ${nextActive ? 'reactivated' : 'deactivated'}.`;
      setError(message);
      emitAppToast({ tone: 'error', message });
    } finally {
      statusRequestInFlight.current = false;
      setStatusSaving(false);
    }
  };
  const menuTraining = definitions.find((item) => item.id === menuTrainingId) ?? null;

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
      {error ? <p className="border-b border-red-100 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
      {loading ? <p className="p-5 text-sm text-gray-500">Loading training...</p> : visible.length === 0 ? <div className="p-6"><EmptyState title="No training modules" description="Create a reusable module, publish a version, and assign it to employees." /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b bg-gray-50 text-left text-gray-500"><th className="px-4 py-3">Title</th><th className="px-4 py-3">Recurrence</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Current / Due / Overdue</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">{visible.map((training) => {
        const scoped = activeAssignments.filter((item) => item.trainingId === training.id);
        return <tr key={training.id} className="hover:bg-gray-50"><td className="px-4 py-3"><button className="font-semibold text-brand-700" onClick={() => navigate(`/training/${training.id}`)}>{training.title}</button><div className="mt-1"><Badge label={training.status === 'draft' ? 'Draft' : training.active ? 'Active' : 'Inactive'} className={training.status === 'draft' ? 'bg-amber-50 text-amber-700' : training.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'} /></div></td><td className="px-4 py-3">{recurrenceLabel(training)}</td><td className="px-4 py-3">v{training.currentVersion || '—'}</td><td className="px-4 py-3">{scoped.length}</td><td className="px-4 py-3">{scoped.filter((item) => item.presentationStatus === 'current').length} / {scoped.filter((item) => item.presentationStatus === 'due_soon').length} / {scoped.filter((item) => item.presentationStatus === 'overdue').length}</td><td className="px-4 py-3">{new Date(training.updatedAt).toLocaleDateString()}</td><td className="px-4 py-3 text-right"><button id={`training-actions-trigger-${training.id}`} type="button" aria-label={`Actions for ${training.title}`} aria-haspopup="menu" aria-expanded={menuTrainingId === training.id} onClick={() => setMenuTrainingId((current) => current === training.id ? null : training.id)} className="h-9 w-9 rounded-md text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><Ellipsis className="mx-auto" size={17} /></button></td></tr>;
      })}</tbody></table></div>}
    </Card>
    {menuTraining ? <TrainingActionsMenu training={menuTraining} duplicateSaving={duplicateSavingId === menuTraining.id} onClose={() => setMenuTrainingId(null)} onNavigate={(target) => navigate(target)} onDuplicate={() => void duplicate(menuTraining)} onChangeActive={() => setStatusConfirmation(menuTraining)} /> : null}
    <Modal open={Boolean(statusConfirmation)} onClose={() => { if (!statusSaving) setStatusConfirmation(null); }} title={statusConfirmation?.active ? 'Deactivate Training?' : 'Reactivate Training?'} footer={<><Button variant="secondary" disabled={statusSaving} onClick={() => setStatusConfirmation(null)}>Cancel</Button><Button variant={statusConfirmation?.active ? 'danger' : 'primary'} disabled={statusSaving} onClick={() => void setActive()}>{statusSaving ? 'Saving...' : statusConfirmation?.active ? 'Deactivate Training' : 'Reactivate Training'}</Button></>}>
      {statusConfirmation?.active ? <div className="space-y-3 text-sm text-gray-600"><p>This Training will no longer be available for new assignments.</p><p>Current incomplete assignments remain active and accessible. They are not revoked or changed.</p><p>Existing completion history and immutable version records remain unchanged.</p></div> : <div className="space-y-3 text-sm text-gray-600"><p>This Training will become available for new assignments using its current published version.</p><p>Existing assignments, completion history, and immutable version records will not be changed.</p></div>}
    </Modal>
  </div>;
}

function TrainingActionsMenu({ training, duplicateSaving, onClose, onNavigate, onDuplicate, onChangeActive }: { training: TrainingDefinition; duplicateSaving: boolean; onClose: () => void; onNavigate: (target: string) => void; onDuplicate: () => void; onChangeActive: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: 8, top: 8, visibility: 'hidden' });

  useLayoutEffect(() => {
    const trigger = document.getElementById(`training-actions-trigger-${training.id}`) as HTMLButtonElement | null;
    const menuElement = menuRef.current;
    if (!trigger || !menuElement) return;
    triggerRef.current = trigger;
    trigger.setAttribute('aria-controls', `training-actions-${training.id}`);
    const position = calculateFixedMenuPosition(trigger.getBoundingClientRect(), { width: 224, height: menuElement.getBoundingClientRect().height }, { width: window.innerWidth, height: window.innerHeight });
    setStyle({ ...position, visibility: 'visible' });
    menuElement.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => trigger.removeAttribute('aria-controls');
  }, [training.id, training.title]);

  useEffect(() => {
    const closeAndRestoreFocus = () => { const trigger = triggerRef.current; onClose(); window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true })); };
    const closeOnOutsidePointer = (event: PointerEvent) => { const target = event.target as Node; if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeAndRestoreFocus(); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAndRestoreFocus(); };
    const closeOnViewportChange = () => onClose();
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);
    return () => { document.removeEventListener('pointerdown', closeOnOutsidePointer); document.removeEventListener('keydown', closeOnEscape); window.removeEventListener('scroll', closeOnViewportChange, true); window.removeEventListener('resize', closeOnViewportChange); };
  }, [onClose]);

  const select = (action: () => void) => { onClose(); action(); };
  const navigate = (suffix = '') => select(() => onNavigate(`/training/${training.id}${suffix}`));
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (currentIndex + 1) % items.length : (currentIndex <= 0 ? items.length : currentIndex) - 1;
    items[nextIndex]?.focus();
  };
  const itemClass = 'w-full rounded-md px-3 py-2 text-left text-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';
  const isDraft = training.status === 'draft';

  return createPortal(<div ref={menuRef} id={`training-actions-${training.id}`} role="menu" aria-label={`Actions for ${training.title}`} className="fixed z-[80] w-56 overflow-y-auto rounded-lg border border-brand-100 bg-white p-1 text-left shadow-xl" style={style} onKeyDown={handleKeyDown}>
    {isDraft ? <>
      <button type="button" role="menuitem" className={itemClass} onClick={() => navigate('/edit')}>Edit draft</button>
      <button type="button" role="menuitem" className={itemClass} onClick={() => navigate()}>Preview</button>
      <button type="button" role="menuitem" className={itemClass} onClick={() => navigate('/edit')}>Publish</button>
    </> : <>
      <button type="button" role="menuitem" className={itemClass} onClick={() => navigate()}>View Training</button>
      {training.active && training.currentVersion > 0 ? <button type="button" role="menuitem" className={itemClass} onClick={() => navigate('?tab=assignments&assign=1')}>Assign to employees</button> : null}
      <button type="button" role="menuitem" className={itemClass} onClick={() => navigate('?tab=assignments')}>View assignments</button>
      <button type="button" role="menuitem" className={itemClass} onClick={() => navigate('?tab=history')}>View completion history</button>
      {training.active ? <button type="button" role="menuitem" className={itemClass} onClick={() => navigate('/edit')}>Create new version</button> : null}
      <button type="button" role="menuitem" className={itemClass} onClick={() => navigate('?tab=versions')}>View version history</button>
    </>}
    <button type="button" role="menuitem" disabled={duplicateSaving} className={itemClass} onClick={() => select(onDuplicate)}>{duplicateSaving ? 'Duplicating...' : 'Duplicate'}</button>
    {!isDraft ? <div className="mt-1 border-t border-gray-200 pt-1"><button type="button" role="menuitem" className={`${itemClass} ${training.active ? 'text-red-700 hover:bg-red-50' : 'text-brand-700'}`} onClick={() => select(onChangeActive)}>{training.active ? 'Deactivate Training' : 'Reactivate Training'}</button></div> : null}
  </div>, document.body);
}
