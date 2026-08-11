import { requireSession } from '../../_lib/session.js';
import {
  deleteGoogleUserData,
  getGoogleConnection,
} from '../../_lib/googleCalendarRepo.js';
import { decryptSecret } from '../../_lib/secretEncryption.js';
import { revokeGoogleCredential } from '../../_lib/googleCalendarService.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  const connection = await getGoogleConnection({ businessId: session.businessId, userId: session.id });
  if (connection?.encryptedRefreshToken) {
    try {
      const refreshToken = decryptSecret(connection.encryptedRefreshToken, {
        businessId: session.businessId,
        userId: session.id,
      });
      await revokeGoogleCredential(refreshToken);
    } catch {
      // Local credential removal must continue when Google is unavailable.
    }
  }
  await deleteGoogleUserData({ businessId: session.businessId, userId: session.id });
  return res.status(200).json({ ok: true });
}