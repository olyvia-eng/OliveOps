import { requireSession } from '../../_lib/session.js';
import { getQuickBooksConnection, toSafeQuickBooksConnection, updateQuickBooksConfiguration } from '../../_lib/quickBooksRepo.js';
import { getValidQuickBooksAccessToken, listQuickBooksItems, listQuickBooksTaxCodes } from '../../_lib/quickBooksService.js';
import { buildQuickBooksConfigurationSelection } from '../../_lib/quickBooksSync.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) return methodNotAllowed(res, ['GET', 'PATCH']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  try {
    const connection = await getQuickBooksConnection({ businessId: session.businessId });
    if (!connection) return res.status(409).json({ ok: false, error: 'Connect QuickBooks first.' });
    const accessToken = await getValidQuickBooksAccessToken({ businessId: session.businessId, connection });
    const [items, taxCodes] = await Promise.all([
      listQuickBooksItems({ accessToken, realmId: connection.realmId }),
      listQuickBooksTaxCodes({ accessToken, realmId: connection.realmId }),
    ]);

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        integration: toSafeQuickBooksConnection(connection),
        items,
        taxCodes,
      });
    }

    const requestedMappings = req.body?.categoryMappings;
    const taxableTaxCodeId = req.body?.taxableTaxCodeId;
    const nonTaxableTaxCodeId = req.body?.nonTaxableTaxCodeId;
    let configuration;
    try {
      configuration = buildQuickBooksConfigurationSelection({ requestedMappings, taxableTaxCodeId, nonTaxableTaxCodeId, items, taxCodes });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    await updateQuickBooksConfiguration({ businessId: session.businessId, realmId: connection.realmId, configuration });
    return res.status(200).json({ ok: true, configuration });
  } catch (error) {
    return res.status(error?.status === 409 ? 409 : 502).json({ ok: false, error: 'QuickBooks configuration could not be loaded or saved.' });
  }
}