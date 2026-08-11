import { requireEnv } from '../../_lib/env.js';

export function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

export function redirectToQuickBooksIntegrations(res, result) {
  const redirectUri = new URL(requireEnv('QUICKBOOKS_REDIRECT_URI'));
  const destination = new URL('/settings/integrations', redirectUri.origin);
  destination.searchParams.set('quickbooks', result);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', destination.toString());
  return res.status(302).end();
}