import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness, getInvoiceForBusiness } from '../../_lib/authRepo.js';
import { requireSession } from '../../_lib/session.js';
import {
  getQuickBooksConnection,
  getQuickBooksCustomerMapping,
  getQuickBooksInvoiceMapping,
  putQuickBooksInvoiceMapping,
} from '../../_lib/quickBooksRepo.js';
import {
  createQuickBooksInvoice,
  fetchQuickBooksInvoice,
  getValidQuickBooksAccessToken,
} from '../../_lib/quickBooksService.js';
import {
  buildQuickBooksInvoicePayload,
  hashInvoiceSource,
  normalizeQuickBooksInvoiceStatus,
  quickBooksRequestId,
} from '../../_lib/quickBooksSync.js';
import { methodNotAllowed } from './_http.js';

function safeMapping(mapping, invoice, providerInvoice) {
  const providerStatus = providerInvoice ? normalizeQuickBooksInvoiceStatus(providerInvoice) : {
    status: mapping.status,
    balance: mapping.balance,
    total: mapping.total,
    documentNumber: mapping.quickBooksDocumentNumber,
  };
  return {
    quickBooksInvoiceId: mapping.quickBooksInvoiceId,
    documentNumber: providerStatus.documentNumber,
    status: providerStatus.status,
    balance: providerStatus.balance,
    total: providerStatus.total,
    syncedAt: mapping.createdAt,
    localChangesNotSynced: mapping.sourceHash !== hashInvoiceSource(invoice),
  };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  const invoiceId = typeof (req.query.invoiceId ?? req.body?.invoiceId) === 'string'
    ? (req.query.invoiceId ?? req.body.invoiceId)
    : '';
  if (!invoiceId) return res.status(400).json({ ok: false, error: 'Invoice id is required.' });

  try {
    const [connection, invoice] = await Promise.all([
      getQuickBooksConnection({ businessId: session.businessId }),
      getInvoiceForBusiness(session.businessId, invoiceId),
    ]);
    if (!connection) return res.status(409).json({ ok: false, error: 'Connect QuickBooks first.' });
    if (!invoice) return res.status(404).json({ ok: false, error: 'Invoice not found.' });
    const existing = await getQuickBooksInvoiceMapping({ businessId: session.businessId, realmId: connection.realmId, invoiceId });
    const accessToken = await getValidQuickBooksAccessToken({ businessId: session.businessId, connection });

    if (existing) {
      const providerInvoice = await fetchQuickBooksInvoice({
        accessToken,
        realmId: connection.realmId,
        quickBooksInvoiceId: existing.quickBooksInvoiceId,
      });
      return res.status(200).json({ ok: true, invoice: safeMapping(existing, invoice, providerInvoice) });
    }
    if (req.method === 'GET') return res.status(200).json({ ok: true, invoice: null });
    if (invoice.status === 'draft') {
      return res.status(409).json({ ok: false, error: 'Send the OliveOps invoice before creating it in QuickBooks.' });
    }
    if (connection.currency && connection.currency !== 'CAD') {
      return res.status(409).json({ ok: false, error: 'QuickBooks company currency must be CAD. OliveOps does not convert currencies.' });
    }
    const customerMapping = await getQuickBooksCustomerMapping({
      businessId: session.businessId,
      realmId: connection.realmId,
      customerId: invoice.customerId,
    });
    const payload = buildQuickBooksInvoicePayload({ invoice, customerMapping, configuration: connection.configuration });
    const providerInvoice = await createQuickBooksInvoice({
      accessToken,
      realmId: connection.realmId,
      invoice: payload,
      requestId: quickBooksRequestId('invoice', session.businessId, connection.realmId, invoiceId),
    });
    const status = normalizeQuickBooksInvoiceStatus(providerInvoice);
    let mapping;
    try {
      mapping = await putQuickBooksInvoiceMapping({
        businessId: session.businessId,
        realmId: connection.realmId,
        invoiceId,
        mapping: {
          quickBooksInvoiceId: String(providerInvoice.Id),
          quickBooksDocumentNumber: status.documentNumber,
          sourceHash: hashInvoiceSource(invoice),
          status: status.status,
          balance: status.balance,
          total: status.total,
          syncToken: status.syncToken,
          createdByUserId: session.id,
        },
      });
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error;
      mapping = await getQuickBooksInvoiceMapping({ businessId: session.businessId, realmId: connection.realmId, invoiceId });
    }
    await createAuditEventForBusiness({
      businessId: session.businessId,
      auditEvent: {
        id: randomUUID(), action: 'quickbooks_invoice_created',
        actorUserId: session.id, actorName: session.name, actorEmail: session.email,
        affectedEntryCount: 1, createdAt: new Date().toISOString(),
        metadata: { invoiceId, quickBooksInvoiceId: mapping.quickBooksInvoiceId, realmId: connection.realmId },
      },
    });
    return res.status(201).json({ ok: true, invoice: safeMapping(mapping, invoice, providerInvoice) });
  } catch (error) {
    const message = error?.message && !String(error.message).includes('QuickBooks request failed')
      ? error.message
      : 'QuickBooks invoice synchronization failed.';
    return res.status(error?.status === 409 ? 409 : 502).json({ ok: false, error: message });
  }
}