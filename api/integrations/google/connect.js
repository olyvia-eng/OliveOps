import { requireSession } from '../../_lib/session.js';
import {
  createOAuthStateValue,
  hashOAuthState,
  putOAuthState,
} from '../../_lib/googleCalendarRepo.js';
import { buildGoogleAuthorizationUrl } from '../../_lib/googleCalendarService.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const state = createOAuthStateValue();
    await putOAuthState({
      businessId: session.businessId,
      userId: session.id,
      stateHash: hashOAuthState(state),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', buildGoogleAuthorizationUrl({ state }));
    return res.status(302).end();
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not start Google Calendar connection' });
  }
}