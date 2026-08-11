import { requireSession } from '../../_lib/session.js';
import {
  createQuickBooksOAuthStateValue,
  getQuickBooksConnection,
  hashQuickBooksOAuthState,
  putQuickBooksOAuthState,
} from '../../_lib/quickBooksRepo.js';
import { buildQuickBooksAuthorizationUrl } from '../../_lib/quickBooksService.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  try {
    const existing = await getQuickBooksConnection({ businessId: session.businessId });
    if (existing?.status === 'connected') {
      return res.status(409).json({ ok: false, error: 'Disconnect the current QuickBooks company before connecting another.' });
    }
    const state = createQuickBooksOAuthStateValue();
    await putQuickBooksOAuthState({
      businessId: session.businessId,
      userId: session.id,
      stateHash: hashQuickBooksOAuthState(state),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', buildQuickBooksAuthorizationUrl({ state }));
    return res.status(302).end();
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not start QuickBooks connection.' });
  }
}