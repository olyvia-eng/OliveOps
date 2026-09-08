import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Camera, CheckCircle2, GripVertical, Plus, RefreshCw, Snowflake, Truck } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, PageHeader, Select, StatCard } from '../../components/ui';
import { useStore } from '../../store';
import type { SnowEvent, SnowEvidenceEvent, SnowServiceOccurrence, SnowServiceType } from '../../types';
import { snowApi, type SnowEventDetailResponse, type SnowRouteDetail } from '../../utils/snowOperationsApi';
import { emitAppToast } from '../../toast';
import { resolveAttachmentUrl } from '../../utils/fileUpload';

const statusTone: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', active: 'bg-emerald-100 text-emerald-800', completed: 'bg-brand-100 text-brand-800',
  cancelled: 'bg-red-100 text-red-700', not_started: 'bg-gray-100 text-gray-700', needs_attention: 'bg-amber-100 text-amber-800',
};

function localDateTime(value: string) {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not set';
}

export default function SnowOperationsPage() {
  const { employees, equipmentAssets, jobs } = useStore();
  const [events, setEvents] = useState<SnowEvent[]>([]);
  const [serviceTypes, setServiceTypes] = useState<SnowServiceType[]>([]);
  const [eventId, setEventId] = useState('');
  const [detail, setDetail] = useState<SnowEventDetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [eventForm, setEventForm] = useState({ title: '', startAt: '', notes: '' });
  const [newServiceType, setNewServiceType] = useState('');
  const [routeForm, setRouteForm] = useState({ name: '', assignedForemanId: '', crewIds: [] as string[], equipmentIds: [] as string[], startingLocation: '' });
  const [stopJobByRoute, setStopJobByRoute] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<{ stopLabel: string; occurrences: SnowServiceOccurrence[]; evidence: SnowEvidenceEvent[]; attention: string[]; photoUrls: Record<string, string> } | null>(null);
  const [draggedStopId, setDraggedStopId] = useState('');

  const foremen = employees.filter((employee) => employee.active && employee.role === 'foreman');
  const crew = employees.filter((employee) => employee.active && employee.role !== 'admin');
  const serviceJobs = jobs.filter((job) => job.workType === 'service');

  const loadEvents = async () => {
    const [eventPayload, typePayload] = await Promise.all([
      snowApi<{ ok: boolean; events: SnowEvent[] }>('GET', 'events'),
      snowApi<{ ok: boolean; serviceTypes: SnowServiceType[] }>('GET', 'service-types'),
    ]);
    setEvents(eventPayload.events);
    setServiceTypes(typePayload.serviceTypes);
    setEventId((current) => current || eventPayload.events.find((item) => item.status === 'active')?.id || eventPayload.events[0]?.id || '');
  };

  const loadDetail = async (selectedEventId = eventId, quiet = false) => {
    if (!selectedEventId) { setDetail(null); return; }
    if (!quiet) setBusy(true);
    try { setDetail(await snowApi<SnowEventDetailResponse>('GET', 'detail', { eventId: selectedEventId })); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load Snow Operations.'); }
    finally { if (!quiet) setBusy(false); }
  };

  useEffect(() => { void loadEvents().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load Snow Operations.')); }, []);
  useEffect(() => { void loadDetail(); }, [eventId]);
  useEffect(() => {
    if (!eventId) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadDetail(eventId, true); }, 45_000);
    return () => window.clearInterval(timer);
  }, [eventId]);

  const mutate = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('');
    try { await work(); await loadEvents(); await loadDetail(eventId, true); emitAppToast({ tone: 'success', message }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Snow Operations update failed.'); }
    finally { setBusy(false); }
  };

  const createEvent = () => mutate(async () => {
    const payload = await snowApi<{ event: SnowEvent }>('POST', 'event', {}, { title: eventForm.title, startAt: new Date(eventForm.startAt).toISOString(), notes: eventForm.notes });
    setEventId(payload.event.id); setEventForm({ title: '', startAt: '', notes: '' });
  }, 'Snow Event created.');

  const createRoute = () => mutate(async () => {
    await snowApi('POST', 'route', { eventId }, { name: routeForm.name, assignedForemanId: routeForm.assignedForemanId, assignedCrewEmployeeIds: routeForm.crewIds, assignedEquipmentIds: routeForm.equipmentIds, startingLocation: routeForm.startingLocation });
    setRouteForm({ name: '', assignedForemanId: '', crewIds: [], equipmentIds: [], startingLocation: '' });
  }, 'Route added.');

  const addStop = (routeId: string) => mutate(async () => {
    await snowApi('POST', 'stop', { eventId, routeId }, { serviceJobId: stopJobByRoute[routeId], plannedServiceTypeIds: serviceTypes.filter((item) => item.active).map((item) => item.id) });
    setStopJobByRoute((current) => ({ ...current, [routeId]: '' }));
  }, 'Stop added.');

  const reorder = (route: SnowRouteDetail, stopId: string, offset: number) => {
    const ordered = route.stops.map((stop) => stop.id);
    const from = ordered.indexOf(stopId); const to = Math.max(0, Math.min(ordered.length - 1, from + offset));
    if (from === to) return;
    const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved);
    void mutate(() => snowApi('PATCH', 'reorder-stops', { eventId, routeId: route.id }, { stopIds: ordered }), 'Stop order updated.');
  };

  const dropOn = (route: SnowRouteDetail, targetId: string) => {
    if (!draggedStopId || draggedStopId === targetId) return;
    const ordered = route.stops.map((stop) => stop.id);
    const from = ordered.indexOf(draggedStopId); const to = ordered.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved);
    setDraggedStopId('');
    void mutate(() => snowApi('PATCH', 'reorder-stops', { eventId, routeId: route.id }, { stopIds: ordered }), 'Stop order updated.');
  };

  const openProof = async (routeId: string, stopId: string, stopLabel: string) => {
    try {
      const payload = await snowApi<{ occurrences: SnowServiceOccurrence[]; evidence: SnowEvidenceEvent[]; attention: string[] }>('GET', 'proof', { eventId, routeId, stopId });
      const fileIds = payload.occurrences.flatMap((occurrence) => [...occurrence.beforePhotoFileIds, ...occurrence.afterPhotoFileIds]);
      const resolved = await Promise.all(fileIds.map(async (fileId) => [fileId, await resolveAttachmentUrl({ fileId })] as const));
      setProof({ stopLabel, occurrences: payload.occurrences, evidence: payload.evidence, attention: payload.attention, photoUrls: Object.fromEntries(resolved) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load Proof of Service.'); }
  };

  const metrics = useMemo(() => {
    const stops = detail?.routes.flatMap((route) => route.stops) ?? [];
    return { routes: detail?.routes.length ?? 0, complete: stops.filter((stop) => stop.status === 'completed').length, total: stops.length, attention: stops.filter((stop) => stop.status === 'needs_attention').length };
  }, [detail]);

  return (
    <div className="space-y-6">
      <PageHeader title="Snow Operations" subtitle="Is tonight's storm on track?" action={<Button variant="secondary" onClick={() => void loadDetail()} disabled={busy}><RefreshCw /> Refresh</Button>} />
      {error && <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Routes" value={metrics.routes} icon={<Truck />} />
        <StatCard label="Stops Complete" value={`${metrics.complete}/${metrics.total}`} icon={<CheckCircle2 />} />
        <StatCard label="Needs Attention" value={metrics.attention} color={metrics.attention ? 'text-amber-700' : 'text-emerald-700'} icon={<AlertTriangle />} />
        <StatCard label="Event" value={detail?.event.status.replace('_', ' ') || 'None'} icon={<Snowflake />} />
      </div>

      <section className="border-y border-brand-100 bg-white px-4 py-4 sm:px-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-end">
          <Select label="Snow Event" value={eventId} onChange={(event) => setEventId(event.target.value)}>
            <option value="">Select an event</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.title} · {event.status}</option>)}
          </Select>
          {detail?.event.status === 'draft' && <Button onClick={() => void mutate(() => snowApi('PATCH', 'event-status', { eventId }, { status: 'active' }), 'Snow Event activated.')} disabled={busy}>Activate Event</Button>}
          {detail?.event.status === 'active' && <Button variant="secondary" onClick={() => void mutate(() => snowApi('PATCH', 'event-status', { eventId }, { status: 'completed' }), 'Snow Event completed.')} disabled={busy}>Complete Event</Button>}
        </div>
        {detail?.event && <p className="mt-2 text-sm text-brand-400">{localDateTime(detail.event.startAt)}{detail.event.notes ? ` · ${detail.event.notes}` : ''}</p>}
      </section>

      <section className="grid gap-3 border-y border-brand-100 bg-white px-4 py-5 md:grid-cols-3">
          <Input label="Event name" value={eventForm.title} onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })} placeholder="December overnight storm" />
          <Input label="Starts" type="datetime-local" value={eventForm.startAt} onChange={(event) => setEventForm({ ...eventForm, startAt: event.target.value })} />
          <div className="flex items-end"><Button onClick={() => void createEvent()} disabled={busy || !eventForm.title || !eventForm.startAt}><Plus /> Create Event</Button></div>
      </section>

      <section className="border-y border-brand-100 bg-white px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-56 flex-1"><Input label="Snow service types" value={newServiceType} onChange={(event) => setNewServiceType(event.target.value)} placeholder="Add service type" /></div><Button variant="secondary" onClick={() => void mutate(async () => { await snowApi('POST', 'service-type', {}, { name: newServiceType, sortOrder: serviceTypes.length }); setNewServiceType(''); }, 'Service Type added.')} disabled={!newServiceType.trim()}><Plus /> Add</Button></div>
        <div className="mt-3 flex flex-wrap gap-2">{serviceTypes.map((type) => <button key={type.id} type="button" onClick={() => void mutate(() => snowApi('PATCH', 'service-type', {}, { id: type.id, active: !type.active }), type.active ? 'Service Type deactivated.' : 'Service Type activated.')} className={`border px-3 py-1.5 text-xs font-semibold ${type.active ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-gray-200 bg-gray-50 text-gray-400 line-through'}`}>{type.name}</button>)}</div>
      </section>

      {detail && (
        <>
          <section className="space-y-3 border-y border-brand-100 bg-brand-50/40 px-4 py-5 sm:px-5">
            <h2 className="text-base font-semibold text-brand-900">Add route</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input label="Route name" value={routeForm.name} onChange={(event) => setRouteForm({ ...routeForm, name: event.target.value })} placeholder="North route" />
              <Select label="Assigned Foreman" value={routeForm.assignedForemanId} onChange={(event) => setRouteForm({ ...routeForm, assignedForemanId: event.target.value })}><option value="">Select Foreman</option>{foremen.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select>
              <Input label="Starting location" value={routeForm.startingLocation} onChange={(event) => setRouteForm({ ...routeForm, startingLocation: event.target.value })} placeholder="Yard or first site" />
              <div className="flex items-end"><Button onClick={() => void createRoute()} disabled={busy || !routeForm.assignedForemanId}><Plus /> Add Route</Button></div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-brand-700">
              {crew.filter((employee) => employee.id !== routeForm.assignedForemanId).map((employee) => <label key={employee.id} className="flex items-center gap-2"><input type="checkbox" checked={routeForm.crewIds.includes(employee.id)} onChange={() => setRouteForm({ ...routeForm, crewIds: routeForm.crewIds.includes(employee.id) ? routeForm.crewIds.filter((id) => id !== employee.id) : [...routeForm.crewIds, employee.id] })} />{employee.name}</label>)}
              {equipmentAssets.map((asset) => <label key={asset.id} className="flex items-center gap-2"><input type="checkbox" checked={routeForm.equipmentIds.includes(asset.id)} onChange={() => setRouteForm({ ...routeForm, equipmentIds: routeForm.equipmentIds.includes(asset.id) ? routeForm.equipmentIds.filter((id) => id !== asset.id) : [...routeForm.equipmentIds, asset.id] })} />{asset.name}</label>)}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            {detail.routes.map((route) => {
              const foreman = employees.find((employee) => employee.id === route.assignedForemanId);
              return <Card key={route.id} className="overflow-hidden">
                <div className="flex items-start justify-between border-b border-brand-100 px-5 py-4">
                  <div><h2 className="font-semibold text-brand-900">{route.name}</h2><p className="mt-1 text-sm text-brand-400"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: foreman?.schedulingColor || '#64748b' }} />{foreman?.name || 'Foreman unavailable'} · {route.progress.completed}/{route.progress.total} complete</p></div>
                  <Badge label={route.status} className={statusTone[route.status] || 'bg-brand-100 text-brand-800'} />
                </div>
                <div className="divide-y divide-brand-100">
                  {route.stops.map((stop, index) => <div key={stop.id} draggable onDragStart={() => setDraggedStopId(stop.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(route, stop.id)} className="flex items-center gap-3 px-4 py-3">
                    <GripVertical className="h-4 w-4 cursor-grab text-brand-300" aria-hidden />
                    <span className="w-6 text-sm font-semibold text-brand-400">{index + 1}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-brand-900">{stop.propertyLabel || stop.customerNameSnapshot}</p><p className="truncate text-xs text-brand-400">{stop.address}</p></div>
                    <Badge label={stop.status} className={statusTone[stop.status] || 'bg-brand-50 text-brand-700'} />
                    <div className="flex"><button title="Move stop up" aria-label="Move stop up" onClick={() => reorder(route, stop.id, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4" /></button><button title="Move stop down" aria-label="Move stop down" onClick={() => reorder(route, stop.id, 1)} disabled={index === route.stops.length - 1}><ArrowDown className="h-4 w-4" /></button></div>
                    <Button size="sm" variant="ghost" onClick={() => void openProof(route.id, stop.id, stop.propertyLabel || stop.customerNameSnapshot)}><Camera /> Proof</Button>
                  </div>)}
                  {!route.stops.length && <p className="px-5 py-6 text-sm text-brand-400">No stops assigned.</p>}
                </div>
                <div className="flex gap-2 border-t border-brand-100 bg-brand-50/40 p-4">
                  <Select aria-label={`Add stop to ${route.name}`} value={stopJobByRoute[route.id] || ''} onChange={(event) => setStopJobByRoute((current) => ({ ...current, [route.id]: event.target.value }))} className="flex-1"><option value="">Select Service Job property</option>{serviceJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</Select>
                  <Button size="sm" onClick={() => void addStop(route.id)} disabled={!stopJobByRoute[route.id]}><Plus /> Stop</Button>
                </div>
              </Card>;
            })}
          </div>
        </>
      )}

      <Modal open={Boolean(proof)} onClose={() => setProof(null)} title={`Proof of Service · ${proof?.stopLabel || ''}`}>
        <div className="space-y-4">
          {proof?.attention.length ? <div className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{proof.attention.join(' · ')}</div> : null}
          {proof?.occurrences.map((occurrence) => <div key={occurrence.id} className="border-b border-brand-100 pb-3"><div className="flex justify-between"><strong>{occurrence.serviceTypeName}</strong><Badge label={occurrence.status} className={statusTone[occurrence.status] || 'bg-brand-50 text-brand-700'} /></div><p className="mt-1 text-sm text-brand-400">Started {localDateTime(occurrence.startedAt || '')} · Completed {localDateTime(occurrence.completedAt || '')}</p><div className="mt-3 grid grid-cols-2 gap-3">{[...occurrence.beforePhotoFileIds.map((id) => ({ id, label: 'Before' })), ...occurrence.afterPhotoFileIds.map((id) => ({ id, label: 'After' }))].map((photo) => proof.photoUrls[photo.id] ? <figure key={photo.id}><img src={proof.photoUrls[photo.id]} alt={`${photo.label} service evidence`} className="aspect-video w-full object-cover" /><figcaption className="mt-1 text-xs font-semibold text-brand-500">{photo.label}</figcaption></figure> : null)}</div></div>)}
          <h3 className="font-semibold text-brand-900">Evidence timeline</h3>
          {proof?.evidence.sort((a, b) => a.serverRecordedAt.localeCompare(b.serverRecordedAt)).map((item) => <div key={item.id} className="flex justify-between text-sm"><span>{item.eventType.replace(/_/g, ' ')}</span><span className="text-brand-400">{localDateTime(item.serverRecordedAt)} · GPS {item.gps.status}</span></div>)}
          {!proof?.occurrences.length && <p className="text-sm text-brand-400">No service evidence has been recorded.</p>}
        </div>
      </Modal>
    </div>
  );
}
