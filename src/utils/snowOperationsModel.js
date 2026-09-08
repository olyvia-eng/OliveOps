export const SNOW_BREADCRUMB_INTERVAL_MS = 45_000;
export const SNOW_BREADCRUMB_BATCH_LIMIT = 100;
export const DEFAULT_SNOW_SERVICE_TYPES = ['Plowing', 'Salting', 'Snow Hauling', 'Sidewalks', 'Loader Work', 'De-icing', 'Other'];

export const SNOW_EVENT_TRANSITIONS = {
  draft: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const SNOW_ROUTE_TRANSITIONS = {
  not_started: ['active'],
  active: ['completed'],
  completed: [],
};

export const SNOW_STOP_TRANSITIONS = {
  pending: ['en_route', 'skipped', 'needs_attention'],
  en_route: ['arrived', 'skipped', 'needs_attention'],
  arrived: ['servicing', 'skipped', 'needs_attention'],
  servicing: ['completed', 'needs_attention'],
  needs_attention: ['en_route', 'arrived', 'servicing', 'completed', 'skipped'],
  completed: [],
  skipped: [],
};

export const SNOW_OCCURRENCE_TRANSITIONS = {
  not_started: ['before_evidence_complete'],
  before_evidence_complete: ['active'],
  active: ['awaiting_after_evidence'],
  awaiting_after_evidence: ['completed'],
  completed: [],
};

export function canTransitionSnowState(transitions, current, next) {
  return current === next || Boolean(transitions[current]?.includes(next));
}

export function normalizeGpsEvidence(input = {}) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const accuracyMeters = Number(input.accuracyMeters);
  const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(accuracyMeters) && accuracyMeters >= 0;
  if (hasCoordinates) {
    return {
      status: accuracyMeters > 100 ? 'low_accuracy' : 'captured',
      latitude,
      longitude,
      accuracyMeters,
    };
  }
  const reason = typeof input.unavailableReason === 'string' ? input.unavailableReason.trim().slice(0, 240) : '';
  return { status: 'unavailable', unavailableReason: reason || 'Location unavailable' };
}

export function normalizeBreadcrumbBatch(points = []) {
  if (!Array.isArray(points) || points.length === 0 || points.length > SNOW_BREADCRUMB_BATCH_LIMIT) return null;
  const seen = new Set();
  const normalized = [];
  for (const point of points) {
    const gps = normalizeGpsEvidence(point);
    const capturedAt = typeof point.deviceCapturedAt === 'string' && Number.isFinite(Date.parse(point.deviceCapturedAt)) ? point.deviceCapturedAt : '';
    const sequence = Number(point.sequence);
    if (gps.status === 'unavailable' || !capturedAt || !Number.isInteger(sequence) || sequence < 0 || seen.has(sequence)) return null;
    seen.add(sequence);
    normalized.push({ ...gps, deviceCapturedAt: capturedAt, sequence });
  }
  return normalized.sort((left, right) => left.sequence - right.sequence);
}

export function snowRouteProgress(stops = []) {
  const completed = stops.filter((stop) => stop.status === 'completed').length;
  const needsAttention = stops.filter((stop) => stop.status === 'needs_attention' || stop.status === 'skipped').length;
  const current = stops
    .filter((stop) => ['en_route', 'arrived', 'servicing', 'needs_attention'].includes(stop.status))
    .sort((left, right) => left.sortOrder - right.sortOrder)[0]
    ?? stops.filter((stop) => stop.status === 'pending').sort((left, right) => left.sortOrder - right.sortOrder)[0]
    ?? null;
  return { total: stops.length, completed, needsAttention, currentStopId: current?.id ?? null };
}

export function nextSnowStop(stops = [], currentStopId) {
  const ordered = [...stops].sort((left, right) => left.sortOrder - right.sortOrder);
  const currentIndex = ordered.findIndex((stop) => stop.id === currentStopId);
  return ordered.slice(Math.max(0, currentIndex + 1)).find((stop) => stop.status === 'pending') ?? null;
}

export function deriveSnowStopAttention({ stop, occurrences = [], evidence = [] }) {
  const reasons = [];
  if (stop.status === 'skipped') reasons.push('Stop skipped');
  if (stop.manualAttentionReason) reasons.push(stop.manualAttentionReason);
  if (evidence.some((item) => item.gps?.status === 'unavailable')) reasons.push('GPS unavailable');
  for (const occurrence of occurrences) {
    const photos = evidence.filter((item) => item.occurrenceId === occurrence.id && item.eventType === 'PHOTO_RECORDED');
    if (occurrence.status !== 'not_started' && !photos.some((item) => item.stage === 'BEFORE')) reasons.push(`Missing before photo: ${occurrence.serviceTypeName}`);
    if (occurrence.status === 'completed' && !photos.some((item) => item.stage === 'AFTER')) reasons.push(`Missing after photo: ${occurrence.serviceTypeName}`);
  }
  return [...new Set(reasons)];
}

export function snowNavigationUrl(address, userAgent = '') {
  const destination = encodeURIComponent(String(address ?? '').trim());
  if (!destination) return '';
  return /iPad|iPhone|iPod/i.test(userAgent)
    ? `https://maps.apple.com/?daddr=${destination}`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}
