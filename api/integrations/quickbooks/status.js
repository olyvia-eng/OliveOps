import { requireSession } from '../../_lib/session.js';
import { getQuickBooksConnection, toSafeQuickBooksConnection } from '../../_lib/quickBooksRepo.js';
import { methodNotAllowed, noStoreCacheControl } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  noStoreCacheControl(res);
  try {
    const connection = await getQuickBooksConnection({ businessId: session.businessId });
    return res.status(200).json({ ok: true, integration: toSafeQuickBooksConnection(connection) });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not load QuickBooks connection.' });
  }
}