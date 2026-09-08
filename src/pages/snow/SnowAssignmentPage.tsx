import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ChevronRight, LocateFixed, MapPin, Navigation, RefreshCw, Snowflake, Upload, WifiOff } from 'lucide-react';
import { Badge, Button, Card, Select } from '../../components/ui';
import type { SnowEvent, SnowRoute, SnowServiceType } from '../../types';
import { uploadFileToStorage } from '../../utils/fileUpload';
import { snowNavigationUrl } from '../../utils/snowOperationsModel.js';
import { captureSnowPosition, flushSnowCommandQueue, runSnowFieldCommand, snowApi, snowSubmissionId, type SnowStopWithOccurrences } from '../../utils/snowOperationsApi';

interface AssignmentPayload { ok: boolean; event: SnowEvent | null; route: SnowRoute | null; stops: SnowStopWithOccurrences[]; progress?: { total: number; completed: number; needsAttention: number; currentStopId: string | null } }

const statusLabel: Record<string, string> = { pending: 'Ready', en_route: 'En route', arrived: 'On site', servicing: 'Service active', completed: 'Complete', skipped: 'Skipped', needs_attention: 'Needs attention' };

export default function SnowAssignmentPage() {
  const [assignment, setAssignment] = useState<AssignmentPayload | null>(null);
  const [serviceTypes, setServiceTypes] = useState<SnowServiceType[]>([]);
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const photoStage = useRef<'before-photo' | 'after-photo'>('before-photo');

  const load = async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const [routePayload, typePayload] = await Promise.all([
        snowApi<AssignmentPayload>('GET', 'my-active-route'),
        snowApi<{ serviceTypes: SnowServiceType[] }>('GET', 'service-types'),
      ]);
      setAssignment(routePayload); setServiceTypes(typePayload.serviceTypes.filter((item) => item.active)); setMessage('');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not load tonight’s assignment.'); }
    finally { if (!quiet) setBusy(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const online = () => { setOffline(false); void flushSnowCommandQueue().then(() => load(true)); };
    const offlineHandler = () => setOffline(true);
    window.addEventListener('online', online); window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineHandler); };
  }, []);

  const stops = useMemo(() => assignment?.stops ?? [], [assignment?.stops]);
  const currentStop = useMemo(() => stops.find((stop) => ['en_route', 'arrived', 'servicing', 'needs_attention'].includes(stop.status)) ?? stops.find((stop) => stop.status === 'pending') ?? null, [stops]);
  const activeOccurrence = currentStop?.occurrences?.find((item) => item.status !== 'completed') ?? currentStop?.occurrences?.at(-1) ?? null;
  const query = useMemo(() => assignment?.event && assignment.route && currentStop ? { eventId: assignment.event.id, routeId: assignment.route.id, stopId: currentStop.id, ...(activeOccurrence ? { occurrenceId: activeOccurrence.id } : {}) } : null, [assignment?.event, assignment?.route, currentStop, activeOccurrence]);

  const command = async (action: string, extra: Record<string, unknown> = {}, includeLocation = true) => {
    if (!query) return;
    setBusy(true); setMessage('');
    const submissionId = snowSubmissionId(action);
    try {
      const location = includeLocation ? await captureSnowPosition() : {};
      await runSnowFieldCommand(action, query, { clientSubmissionId: submissionId, ...location, ...extra });
      await load(true);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not save this update.'); }
    finally { setBusy(false); }
  };

  const startRoute = async () => {
    if (!assignment?.event || !assignment.route) return;
    setBusy(true);
    try { await runSnowFieldCommand('start-route', { eventId: assignment.event.id, routeId: assignment.route.id }, { clientSubmissionId: snowSubmissionId('start-route') }); await load(true); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not start Route.'); }
    finally { setBusy(false); }
  };

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !assignment?.event || !assignment.route || !currentStop || !activeOccurrence) return;
    setBusy(true); setMessage('');
    try {
      const upload = await uploadFileToStorage({ file, entityType: 'snow-occurrence', entityId: activeOccurrence.id, category: photoStage.current, snowEventId: assignment.event.id, snowRouteId: assignment.route.id, routeStopId: currentStop.id });
      await command(photoStage.current, { fileId: upload.fileId });
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Photo could not be uploaded.'); setBusy(false); }
  };

  useEffect(() => {
    if (activeOccurrence?.status !== 'active' || !query) return;
    let sequence = 0;
    const sendBreadcrumb = async () => {
      const location = await captureSnowPosition();
      if (!location.gps) return;
      sequence += 1;
      const body = { clientSubmissionId: snowSubmissionId('breadcrumbs'), points: [{ ...location.gps, deviceCapturedAt: location.deviceCapturedAt, sequence }] };
      try { await runSnowFieldCommand('breadcrumbs', query, body); } catch { /* queue helper owns reconnect behavior */ }
    };
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void sendBreadcrumb(); }, 45_000);
    return () => window.clearInterval(timer);
  }, [activeOccurrence?.status, query]);

  const openPhoto = (stage: 'before-photo' | 'after-photo') => { photoStage.current = stage; fileInput.current?.click(); };
  const navigationUrl = snowNavigationUrl(currentStop?.address || '', navigator.userAgent);

  if (!assignment?.route) return <main className="min-h-screen bg-brand-50 px-4 py-8"><div className="mx-auto max-w-xl"><Snowflake className="mb-4 h-10 w-10 text-brand-500" /><h1 className="text-2xl font-semibold text-brand-900">Tonight’s Assignment</h1><p className="mt-2 text-brand-500">No active Snow Route is assigned to you.</p><Button className="mt-6" variant="secondary" onClick={() => void load()} disabled={busy}><RefreshCw /> Check again</Button>{message && <p className="mt-4 text-sm text-red-700">{message}</p>}</div></main>;

  return <main className="min-h-screen bg-brand-50 pb-12">
    <header className="bg-brand-900 px-4 py-5 text-white"><div className="mx-auto flex max-w-xl items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-brand-200">Tonight’s Assignment</p><h1 className="mt-1 text-2xl font-semibold">{assignment.route.name}</h1><p className="mt-1 text-sm text-brand-200">{assignment.event?.title}</p></div><Badge label={assignment.route.status} className="bg-white/15 text-white" /></div></header>
    <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
      {offline && <div className="flex items-center gap-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><WifiOff className="h-4 w-4" /> Offline updates are saved for reconnect.</div>}
      {message && <div role="status" className="border border-brand-200 bg-white p-3 text-sm text-brand-800">{message}</div>}
      <div className="flex items-center justify-between text-sm text-brand-600"><span>{assignment.progress?.completed || 0} of {assignment.progress?.total || stops.length} stops complete</span><Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}><RefreshCw /> Refresh</Button></div>

      {assignment.route.status === 'not_started' ? <Button className="h-14 w-full text-base" onClick={() => void startRoute()} disabled={busy}><Navigation /> Start Route</Button> : currentStop ? <>
        <Card className="overflow-hidden rounded-lg">
          <div className="border-b border-brand-100 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-brand-400">Stop {currentStop.sortOrder + 1}</p><h2 className="mt-1 text-xl font-semibold text-brand-900">{currentStop.propertyLabel || currentStop.customerNameSnapshot}</h2><p className="mt-2 flex items-start gap-2 text-sm text-brand-500"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{currentStop.address}</p></div><Badge label={statusLabel[currentStop.status] || currentStop.status} className={currentStop.status === 'needs_attention' ? 'bg-amber-100 text-amber-800' : 'bg-brand-100 text-brand-800'} /></div>{currentStop.siteNotes && <p className="mt-4 border-l-2 border-amber-400 pl-3 text-sm text-brand-700">{currentStop.siteNotes}</p>}</div>
          <div className="space-y-3 p-5">
            {navigationUrl && <a href={navigationUrl} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 border border-brand-200 bg-white text-sm font-semibold text-brand-800"><Navigation className="h-4 w-4" /> Navigate</a>}
            {currentStop.status === 'pending' && <Button className="h-14 w-full text-base" onClick={() => void command('en-route')} disabled={busy}><Navigation /> En Route</Button>}
            {currentStop.status === 'en_route' && <Button className="h-14 w-full text-base" onClick={() => void command('arrival')} disabled={busy}><LocateFixed /> Arrived</Button>}
            {currentStop.status === 'arrived' && !activeOccurrence && <><Select label="Service performed" value={serviceTypeId} onChange={(event) => setServiceTypeId(event.target.value)}><option value="">Select service</option>{serviceTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Button className="h-14 w-full text-base" onClick={() => void command('select-service', { serviceTypeId }, false)} disabled={busy || !serviceTypeId}>Continue <ChevronRight /></Button></>}
            {activeOccurrence?.status === 'not_started' && <Button className="h-14 w-full text-base" onClick={() => openPhoto('before-photo')} disabled={busy}><Camera /> Add Before Photo</Button>}
            {activeOccurrence?.status === 'before_evidence_complete' && <Button className="h-14 w-full text-base" onClick={() => void command('start-service')} disabled={busy}><Snowflake /> Start Service</Button>}
            {activeOccurrence?.status === 'active' && <><div className="flex items-center justify-center gap-2 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Service in progress · foreground GPS active</div><Button className="h-14 w-full text-base" onClick={() => void command('finish-service')} disabled={busy}><CheckCircle2 /> Finish Service</Button></>}
            {activeOccurrence?.status === 'awaiting_after_evidence' && !activeOccurrence.afterPhotoFileIds.length && <Button className="h-14 w-full text-base" onClick={() => openPhoto('after-photo')} disabled={busy}><Upload /> Add After Photo</Button>}
            {activeOccurrence?.status === 'awaiting_after_evidence' && activeOccurrence.afterPhotoFileIds.length > 0 && <Button className="h-14 w-full text-base" onClick={() => void command('complete-service')} disabled={busy}><CheckCircle2 /> Complete Stop</Button>}
            {currentStop.status === 'needs_attention' && <div className="flex items-center gap-2 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4" /> Contact dispatch before continuing.</div>}
          </div>
        </Card>
        <Button className="w-full" variant="ghost" onClick={() => void command('flag-stop', { reason: 'Employee requested assistance' })} disabled={busy || ['completed', 'skipped'].includes(currentStop.status)}><AlertTriangle /> Flag for attention</Button>
      </> : <div className="py-12 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /><h2 className="mt-3 text-xl font-semibold text-brand-900">All stops handled</h2><Button className="mt-5" onClick={() => assignment.event && assignment.route && void runSnowFieldCommand('complete-route', { eventId: assignment.event.id, routeId: assignment.route.id }, { clientSubmissionId: snowSubmissionId('complete-route') }).then(() => load())}>Complete Route</Button></div>}
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => void uploadPhoto(event)} />
    </div>
  </main>;
}
