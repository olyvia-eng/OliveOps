import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness, getCustomerForBusiness } from '../../_lib/authRepo.js';
import { requireSession } from '../../_lib/session.js';
import {
  getQuickBooksConnection,
  getQuickBooksCustomerMapping,
  putQuickBooksCustomerMapping,
} from '../../_lib/quickBooksRepo.js';
import {
  createQuickBooksCustomer,
  getValidQuickBooksAccessToken,
  listQuickBooksCustomers,
} from '../../_lib/quickBooksService.js';
import { buildQuickBooksCustomerPayload, quickBooksRequestId } from '../../_lib/quickBooksSync.js';
import { methodNotAllowed } from './_http.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;
  const customerId = typeof (req.query.customerId ?? req.body?.customerId) === 'string'
    ? (req.query.customerId ?? req.body.customerId)
    : '';
  if (!customerId) return res.status(400).json({ ok: false, error: 'Customer id is required.' });
  try {
    const [connection, customer] = await Promise.all([
      getQuickBooksConnection({ businessId: session.businessId }),
      getCustomerForBusiness(session.businessId, customerId),
    ]);
    if (!connection) return res.status(409).json({ ok: false, error: 'Connect QuickBooks first.' });
    if (!customer) return res.status(404).json({ ok: false, error: 'Customer not found.' });
    const existing = await getQuickBooksCustomerMapping({ businessId: session.businessId, realmId: connection.realmId, customerId });
    if (existing) return res.status(200).json({ ok: true, mapping: existing });
    const accessToken = await getValidQuickBooksAccessToken({ businessId: session.businessId, connection });
    const customerPayload = buildQuickBooksCustomerPayload(customer);

    if (req.method === 'GET') {
      const candidates = await listQuickBooksCustomers({ accessToken, realmId: connection.realmId, displayName: customerPayload.DisplayName });
      return res.status(200).json({ ok: true, mapping: null, candidates });
    }

    const action = req.body?.action;
    let quickBooksCustomer;
    if (action === 'map') {
      const selectedId = typeof req.body?.quickBooksCustomerId === 'string' ? req.body.quickBooksCustomerId : '';
      const customers = await listQuickBooksCustomers({ accessToken, realmId: connection.realmId });
      quickBooksCustomer = customers.find((candidate) => candidate.id === selectedId && candidate.active);
      if (!quickBooksCustomer) return res.status(400).json({ ok: false, error: 'Selected QuickBooks customer is unavailable.' });
    } else if (action === 'create') {
      const created = await createQuickBooksCustomer({
        accessToken,
        realmId: connection.realmId,
        customer: customerPayload,
        requestId: quickBooksRequestId('customer', session.businessId, connection.realmId, customerId),
      });
      quickBooksCustomer = { id: String(created.Id), displayName: created.DisplayName ?? customerPayload.DisplayName };
    } else {
      return res.status(400).json({ ok: false, error: 'Choose whether to map or create the customer.' });
    }

    const mapping = await putQuickBooksCustomerMapping({
      businessId: session.businessId,
      realmId: connection.realmId,
      customerId,
      mapping: {
        quickBooksCustomerId: quickBooksCustomer.id,
        quickBooksDisplayName: quickBooksCustomer.displayName,
        mappedByUserId: session.id,
      },
    });
    await createAuditEventForBusiness({
      businessId: session.businessId,
      auditEvent: {
        id: randomUUID(), action: action === 'create' ? 'quickbooks_customer_created' : 'quickbooks_customer_mapped',
        actorUserId: session.id, actorName: session.name, actorEmail: session.email,
        affectedEntryCount: 1, createdAt: new Date().toISOString(),
        metadata: { customerId, quickBooksCustomerId: quickBooksCustomer.id, realmId: connection.realmId },
      },
    });
    return res.status(200).json({ ok: true, mapping });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return res.status(409).json({ ok: false, error: 'Customer is already mapped.' });
    return res.status(502).json({ ok: false, error: 'QuickBooks customer synchronization failed.' });
  }
}