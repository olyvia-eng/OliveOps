import { createHash } from 'node:crypto';
import { getPublicInvoiceByTokenHash, markInvoiceViewed } from './_lib/invoiceRepo.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function createPublicInvoiceHandler(overrides = {}) {
  const deps = { getPublicInvoiceByTokenHash, markInvoiceViewed, now: () => new Date(), ...overrides };
  return async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const token = String(req.query?.token ?? '').trim();
    if (!TOKEN_PATTERN.test(token)) return res.status(404).json({ ok: false, error: 'Invoice not found.' });
    const resolved = await deps.getPublicInvoiceByTokenHash(hash(token));
    if (!resolved) return res.status(404).json({ ok: false, error: 'Invoice not found.' });
    res.setHeader('Cache-Control', 'private, no-store');
    const viewedAt = deps.now().toISOString();
    await deps.markInvoiceViewed({ businessId: resolved.token.businessId, invoiceId: resolved.token.invoiceId, viewedAt });
    const snapshot = structuredClone(resolved.invoice.customerDocumentSnapshot);
    snapshot.invoice.amountPaid = Number(resolved.invoice.amountPaid) || 0;
    snapshot.invoice.balanceDue = Math.max(0, Number(resolved.invoice.amount) - snapshot.invoice.amountPaid);
    snapshot.invoice.status = resolved.invoice.status;
    return res.status(200).json({ ok: true, invoice: snapshot });
  };
}

export default createPublicInvoiceHandler();