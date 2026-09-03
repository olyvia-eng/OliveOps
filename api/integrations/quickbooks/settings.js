import { requireSession } from '../../_lib/session.js';
import { getQuickBooksConnection, toSafeQuickBooksConnection, updateQuickBooksConfiguration } from '../../_lib/quickBooksRepo.js';
import { getValidQuickBooksAccessToken, listQuickBooksItems, listQuickBooksTaxCodes } from '../../_lib/quickBooksService.js';
import { methodNotAllowed } from './_http.js';

const CATEGORIES = ['contract_service', 'material', 'equipment', 'labour', 'subcontractor'];

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
    if (!requestedMappings || typeof requestedMappings !== 'object') {
      return res.status(400).json({ ok: false, error: 'Category mappings are required.' });
    }
    const itemById = new Map(items.map((item) => [item.id, item]));
    const taxCodeById = new Map(taxCodes.map((taxCode) => [taxCode.id, taxCode]));
    const categoryMappings = {};
    for (const category of CATEGORIES) {
      const itemId = requestedMappings[category];
      if (!itemId) continue;
      const item = itemById.get(String(itemId));
      if (!item?.active) return res.status(400).json({ ok: false, error: `Selected ${category} Product/Service is unavailable.` });
      categoryMappings[category] = item;
    }
    const taxableTaxCode = taxCodeById.get(String(taxableTaxCodeId ?? ''));
    if (!taxableTaxCode?.active || !taxableTaxCode.taxable) {
      return res.status(400).json({ ok: false, error: 'Select an active taxable QuickBooks tax code.' });
    }
    const nonTaxableCodes = taxCodes.filter((taxCode) => taxCode.active && !taxCode.taxable);
    if (nonTaxableCodes.length !== 1) {
      return res.status(409).json({ ok: false, error: 'QuickBooks must provide one unambiguous non-taxable tax code.' });
    }
    const configuration = { categoryMappings, taxableTaxCode, nonTaxableTaxCode: nonTaxableCodes[0] };
    await updateQuickBooksConfiguration({ businessId: session.businessId, realmId: connection.realmId, configuration });
    return res.status(200).json({ ok: true, configuration });
  } catch (error) {
    return res.status(error?.status === 409 ? 409 : 502).json({ ok: false, error: 'QuickBooks configuration could not be loaded or saved.' });
  }
}