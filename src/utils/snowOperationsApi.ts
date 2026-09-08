import type { SnowEvent, SnowRoute, SnowRouteStop, SnowServiceOccurrence, SnowServiceType } from '../types';

export type SnowStopWithOccurrences = SnowRouteStop & { occurrences?: SnowServiceOccurrence[] };
export type SnowRouteDetail = SnowRoute & { stops: SnowStopWithOccurrences[]; progress: { total: number; completed: number; needsAttention: number; currentStopId: string | null } };

export interface SnowEventDetailResponse {
  ok: boolean;
  error?: string;
  event: SnowEvent;
  routes: SnowRouteDetail[];
}

const queueKey = 'oliveops.snow.pendingCommands';

export function snowSubmissionId(prefix: string) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

export async function snowApi<T>(method: string, action: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const params = new URLSearchParams({ action, ...query });
  const response = await fetch(`/api/snow-operations?${params}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || 'Snow Operations request failed.');
  return payload;
}

export async function captureSnowPosition(): Promise<{ gps?: { latitude: number; longitude: number; accuracyMeters: number }; gpsUnavailableReason?: string; deviceCapturedAt: string }> {
  const deviceCapturedAt = new Date().toISOString();
  if (!navigator.geolocation) return { gpsUnavailableReason: 'location_not_supported', deviceCapturedAt };
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ gps: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }, deviceCapturedAt: new Date(position.timestamp).toISOString() }),
    (error) => resolve({ gpsUnavailableReason: error.code === error.PERMISSION_DENIED ? 'permission_denied' : error.code === error.TIMEOUT ? 'timeout' : 'position_unavailable', deviceCapturedAt }),
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 },
  ));
}

interface QueuedSnowCommand { id: string; method: string; action: string; query: Record<string, string>; body: Record<string, unknown>; }

function readQueue(): QueuedSnowCommand[] {
  try { return JSON.parse(localStorage.getItem(queueKey) || '[]') as QueuedSnowCommand[]; } catch { return []; }
}

export function queueSnowCommand(command: QueuedSnowCommand) {
  const queued = readQueue();
  if (!queued.some((item) => item.id === command.id)) localStorage.setItem(queueKey, JSON.stringify([...queued, command]));
}

export async function flushSnowCommandQueue() {
  const queued = readQueue();
  const remaining: QueuedSnowCommand[] = [];
  for (const command of queued) {
    try { await snowApi(command.method, command.action, command.query, command.body); } catch { remaining.push(command); }
  }
  localStorage.setItem(queueKey, JSON.stringify(remaining));
  return { sent: queued.length - remaining.length, remaining: remaining.length };
}

export async function runSnowFieldCommand<T>(action: string, query: Record<string, string>, body: Record<string, unknown>): Promise<T> {
  try {
    return await snowApi<T>('POST', action, query, body);
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError) {
      queueSnowCommand({ id: String(body.clientSubmissionId), method: 'POST', action, query, body });
      throw new Error('Saved offline. This update will retry when the connection returns.');
    }
    throw error;
  }
}

export type SnowServiceTypesResponse = { ok: boolean; serviceTypes: SnowServiceType[] };
