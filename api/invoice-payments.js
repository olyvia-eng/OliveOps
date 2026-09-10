import { randomUUID } from 'node:crypto';
import { getInvoiceForBusiness } from './_lib/authRepo.js';
import { listInvoicePayments, recordInvoicePayment } from './_lib/invoiceRepo.js';
import { requireSession } from './_lib/session.js';
import { roundCurrency } from '../src/utils/invoiceModel.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createInvoicePaymentsHandler(overrides = {}) {
  const deps = { requireSession, getInvoiceForBusiness, listInvoicePayments, recordInvoicePayment, randomUUID, now: () => new Date(), ...overrides };
  return async (req, res) => {
    const session = await deps.requireSession(req, res, ['owner', 'admin']);
    if (!session) return;
    const invoiceId = String(req.query?.invoiceId ?? req.body?.invoiceId ?? '').trim();
    const invoice = await deps.getInvoiceForBusiness(session.businessId, invoiceId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'Invoice not found.' });
    if (req.method === 'GET') return res.status(200).json({ ok: true, payments: await deps.listInvoicePayments({ businessId: session.businessId, invoiceId }) });
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const amount = roundCurrency(Number(req.body?.amount));
    const paymentDate = String(req.body?.paymentDate ?? '').trim();
    const paymentMethod = String(req.body?.paymentMethod ?? '').trim();
    const reference = String(req.body?.reference ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Payment amount must be greater than 0.' });
    if (!DATE_PATTERN.test(paymentDate)) return res.status(400).json({ ok: false, error: 'Payment date is invalid.' });
    if (!paymentMethod || paymentMethod.length > 100 || reference.length > 200 || notes.length > 2000) return res.status(400).json({ ok: false, error: 'Payment details are invalid.' });
    const createdAt = deps.now().toISOString();
    const payment = { id: deps.randomUUID(), invoiceId, amount, paymentDate, paymentMethod, ...(reference ? { reference } : {}), ...(notes ? { notes } : {}), status: 'active', createdAt, createdByUserId: session.id, quickBooksSync: { status: 'not_synced' } };
    const result = await deps.recordInvoicePayment({ businessId: session.businessId, invoice, payment, actor: session });
    if (!result.ok) return res.status(409).json({ ok: false, error: result.error });
    return res.status(201).json({ ok: true, payment, invoice: { ...invoice, amountPaid: result.amountPaid, balanceDue: result.balanceDue, status: result.status, updatedAt: createdAt } });
  };
}

export default createInvoicePaymentsHandler();