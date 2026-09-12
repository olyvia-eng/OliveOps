import { requireEnv } from '../../_lib/env.js';

// Every QuickBooks endpoint response - success or error - can carry connection state, customer/
// invoice data, or other business-sensitive information, so none of it may be cached by the
// browser or an intermediary. Call this before the first res.status(...).json(...)/end() on every
// handler in this folder, rather than duplicating the header literal at each call site.
export function noStoreCacheControl(res) {
  res.setHeader('Cache-Control', 'no-store');
}

export function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

export function redirectToQuickBooksIntegrations(res, result) {
  const redirectUri = new URL(requireEnv('QUICKBOOKS_REDIRECT_URI'));
  const destination = new URL('/settings/integrations', redirectUri.origin);
  destination.searchParams.set('quickbooks', result);
  noStoreCacheControl(res);
  res.setHeader('Location', destination.toString());
  return res.status(302).end();
}