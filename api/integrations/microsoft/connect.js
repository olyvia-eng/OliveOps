import { requireSession } from '../../_lib/session.js';
import {
  createMicrosoftOAuthStateValue,
  hashMicrosoftOAuthState,
  putMicrosoftOAuthState,
} from '../../_lib/microsoftCalendarRepo.js';
import {
  buildMicrosoftAuthorizationUrl,
  createMicrosoftPkcePair,
  encryptMicrosoftCodeVerifier,
} from '../../_lib/microsoftCalendarService.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    const state = createMicrosoftOAuthStateValue();
    const { verifier, challenge } = createMicrosoftPkcePair();
    await putMicrosoftOAuthState({
      businessId: session.businessId,
      userId: session.id,
      stateHash: hashMicrosoftOAuthState(state),
      encryptedCodeVerifier: encryptMicrosoftCodeVerifier({ businessId: session.businessId, userId: session.id, verifier }),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', buildMicrosoftAuthorizationUrl({ state, codeChallenge: challenge }));
    return res.status(302).end();
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not start Outlook Calendar connection' });
  }
}