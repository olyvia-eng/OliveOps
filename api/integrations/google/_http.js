import { requireEnv } from '../../_lib/env.js';

export function redirectToIntegrations(res, result) {
  const redirectUri = new URL(requireEnv('GOOGLE_REDIRECT_URI'));
  const destination = new URL('/settings/integrations', redirectUri.origin);
  destination.searchParams.set('google', result);
  res.setHeader('Location', destination.toString());
  return res.status(302).end();
}

export function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

export function parseDateRange(query) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!from || !to || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return null;
  if (toMs - fromMs > 370 * 24 * 60 * 60 * 1000) return null;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}