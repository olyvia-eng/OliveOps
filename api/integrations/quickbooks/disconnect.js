import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness } from '../../_lib/authRepo.js';
import { requireSession } from '../../_lib/session.js';
import { deleteQuickBooksConnection, getQuickBooksConnection } from '../../_lib/quickBooksRepo.js';
import { decryptQuickBooksRefreshToken, revokeQuickBooksToken } from '../../_lib/quickBooksService.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  try {
    const connection = await getQuickBooksConnection({ businessId: session.businessId });
    if (!connection) return res.status(200).json({ ok: true });
    try {
      const token = decryptQuickBooksRefreshToken({ businessId: session.businessId, connection });
      await revokeQuickBooksToken({ token });
    } catch {
      // Local credential removal must proceed even when Intuit is unavailable.
    }
    await deleteQuickBooksConnection({ businessId: session.businessId });
    await createAuditEventForBusiness({
      businessId: session.businessId,
      auditEvent: {
        id: randomUUID(),
        action: 'quickbooks_disconnected',
        actorUserId: session.id,
        actorName: session.name,
        actorEmail: session.email,
        affectedEntryCount: 1,
        createdAt: new Date().toISOString(),
        metadata: { realmId: connection.realmId, companyName: connection.companyName, environment: 'sandbox' },
      },
    });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not disconnect QuickBooks.' });
  }
}