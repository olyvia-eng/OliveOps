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
  /expected a javascript(?:-or-wasm)? module script.*mime type of ["']text\/html/i,
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
  if (error && typeof error === 'object') {
    if ('error' in error && error.error) return errorParts(error.error);
    if ('reason' in error && error.reason) return errorParts(error.reason);
    if ('payload' in error && error.payload) return errorParts(error.payload);
    if ('message' in error && typeof error.message === 'string') {
      return {
        name: typeof error.name === 'string' && error.name ? error.name : 'Error',
        message: error.message || 'Unknown client error',
      };
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown client error',
    };
  }
  if (typeof error === 'string') return { name: 'Error', message: error };
  return { name: 'UnknownError', message: 'Unknown client error' };
}

function extractFailedAssetUrl(error) {
  const { message } = errorParts(error);
  const match = message.match(/(?:https?:\/\/[^\s"'<>]+)?\/assets\/[^\s"'<>]+/i);
  if (!match) return null;
  const assetPath = match[0].replace(/^https?:\/\/[^/]+/i, '');
  return assetPath.replace(/[),.;]+$/, '').split(/[?#]/, 1)[0].slice(0, 500);
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
    failedAssetUrl: extractFailedAssetUrl(error),
    chunkLoadFailure: isChunkLoadError(error),
    automaticRecoveryAttempted: false,
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

export function clearChunkRecovery({ storage, route, appVersion = getAppVersion() }) {
  if (!storage) return false;
  try {
    const normalizedRoute = sanitizeRoute(route);
    const matchingSuffix = `:${normalizedRoute}`;
    const matchingKeys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${RECOVERY_MARKER_PREFIX}:`) && key.endsWith(matchingSuffix)) {
        matchingKeys.push(key);
      }
    }
    if (matchingKeys.length === 0) matchingKeys.push(recoveryMarkerKey(normalizedRoute, appVersion));
    for (const key of matchingKeys) storage.removeItem(key);
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

  const recoveryStarted = diagnostic.chunkLoadFailure
    && claimChunkRecovery({ storage, route: diagnostic.route, appVersion: diagnostic.appVersion });
  diagnostic.automaticRecoveryAttempted = recoveryStarted;
  report(diagnostic, error);
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

export function installGlobalErrorHandlers({ target, storage, reload, route, report = reportClientError }) {
  const handleError = (event) => {
    if (!event.error && (typeof event.message !== 'string' || !event.message)) return;
    handleClientError({
      error: event.error ?? event,
      route: route(),
      source: 'window-error',
      storage,
      reload,
      report,
    });
  };
  const handleUnhandledRejection = (event) => {
    handleClientError({
      error: event.reason,
      route: route(),
      source: 'unhandled-rejection',
      storage,
      reload,
      report,
    });
  };
  const handleVitePreloadError = (event) => {
    const result = handleClientError({
      error: event.payload ?? new Error('Vite preload error'),
      route: route(),
      source: 'vite-preload-error',
      storage,
      reload,
      report,
      forceChunkLoadFailure: true,
    });
    if (result.recoveryStarted) event.preventDefault();
  };

  target.addEventListener('error', handleError);
  target.addEventListener('unhandledrejection', handleUnhandledRejection);
  target.addEventListener('vite:preloadError', handleVitePreloadError);

  return () => {
    target.removeEventListener('error', handleError);
    target.removeEventListener('unhandledrejection', handleUnhandledRejection);
    target.removeEventListener('vite:preloadError', handleVitePreloadError);
  };
}