const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\w-]+ failed/i,
  /chunkloaderror/i,
  /loading css chunk [\w-]+ failed/i,
  /unable to preload css/i,
  /failed to load module script/i,
  /expected a javascript(?:-or-wasm)? module script/i,
];

const RECOVERY_MARKER_PREFIX = 'oliveops.chunk-recovery';
const RECOVERY_MARKER_TTL_MS = 60 * 60 * 1000;

function sanitizeErrorMessage(value) {
  return value
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1')
    .replace(/bearer\s+[a-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|code|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[redacted-email]')
    .slice(0, 500);
}

function sanitizeRoute(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  return value.split(/[?#]/, 1)[0].slice(0, 300) || '/';
}

function errorParts(error) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown client error',
    };
  }
  if (typeof error === 'string') return { name: 'Error', message: error };
  return { name: 'UnknownError', message: 'Unknown client error' };
}

export function isChunkLoadError(error) {
  const { name, message } = errorParts(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(`${name}: ${message}`));
}

export function getAppVersion() {
  const env = import.meta.env ?? {};
  return env.VITE_APP_VERSION
    || env.VITE_VERCEL_GIT_COMMIT_SHA
    || env.VERCEL_GIT_COMMIT_SHA
    || 'unknown';
}

export function buildClientErrorDiagnostic({ error, route, source }) {
  const { name, message } = errorParts(error);
  return {
    source,
    route: sanitizeRoute(route),
    errorName: name.slice(0, 100),
    errorMessage: sanitizeErrorMessage(message),
    chunkLoadFailure: isChunkLoadError(error),
    appVersion: getAppVersion(),
    occurredAt: new Date().toISOString(),
  };
}

function recoveryMarkerKey(route, appVersion) {
  return `${RECOVERY_MARKER_PREFIX}:${appVersion}:${route}`;
}

export function claimChunkRecovery({ storage, route, appVersion = getAppVersion(), now = Date.now() }) {
  if (!storage) return false;
  const key = recoveryMarkerKey(route, appVersion);

  try {
    const previousAttempt = Number(storage.getItem(key));
    if (Number.isFinite(previousAttempt) && previousAttempt > 0 && now - previousAttempt < RECOVERY_MARKER_TTL_MS) {
      return false;
    }
    storage.setItem(key, String(now));
    return true;
  } catch {
    return false;
  }
}

export function reportClientError(diagnostic, error) {
  console.error('[OliveOps client error]', diagnostic, import.meta.env?.DEV ? error : undefined);
  if (typeof fetch === 'function') {
    void fetch('/api/client-diagnostics', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(diagnostic),
    }).catch(() => undefined);
  }
}

export function handleClientError({ error, route, source, storage, reload, report = reportClientError, forceChunkLoadFailure = false }) {
  const diagnostic = buildClientErrorDiagnostic({ error, route, source });
  if (forceChunkLoadFailure) diagnostic.chunkLoadFailure = true;
  report(diagnostic, error);

  const recoveryStarted = diagnostic.chunkLoadFailure
    && claimChunkRecovery({ storage, route: diagnostic.route, appVersion: diagnostic.appVersion });
  if (recoveryStarted) reload();

  return { diagnostic, recoveryStarted };
}

export function getSessionStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}