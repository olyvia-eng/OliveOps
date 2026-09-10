import { requireSession } from './_lib/session.js';

const ALLOWED_SOURCES = new Set(['react-boundary', 'unhandled-rejection', 'vite-preload-error']);

function parseJsonBody(req) {
  if (typeof req.body !== 'string') return req.body ?? {};
  try {
    return JSON.parse(req.body);
  } catch {
    return null;
  }
}

function safeString(value, maxLength, fallback) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function sanitizeRoute(value) {
  const route = safeString(value, 300, '/');
  return route.startsWith('/') ? route.split(/[?#]/, 1)[0] || '/' : '/';
}

function sanitizeErrorMessage(value) {
  return safeString(value, 500, 'Unknown client error')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1')
    .replace(/bearer\s+[a-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|code|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[redacted-email]');
}

export function createClientDiagnosticsHandler(overrides = {}) {
  const requireSessionFn = overrides.requireSession ?? requireSession;
  const writeDiagnostic = overrides.writeDiagnostic ?? ((diagnostic) => {
    console.error('[OliveOps client diagnostic]', JSON.stringify(diagnostic));
  });

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const session = await requireSessionFn(req, res, ['owner', 'admin', 'foreman', 'crew_member']);
    if (!session) return;

    const body = parseJsonBody(req);
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid diagnostic payload.' });
    }

    const diagnostic = {
      source: ALLOWED_SOURCES.has(body.source) ? body.source : 'react-boundary',
      route: sanitizeRoute(body.route),
      errorName: safeString(body.errorName, 100, 'UnknownError'),
      errorMessage: sanitizeErrorMessage(body.errorMessage),
      chunkLoadFailure: body.chunkLoadFailure === true,
      appVersion: safeString(body.appVersion, 120, 'unknown'),
      occurredAt: safeString(body.occurredAt, 40, new Date().toISOString()),
    };

    writeDiagnostic(diagnostic);
    return res.status(202).json({ ok: true });
  };
}

export default createClientDiagnosticsHandler();