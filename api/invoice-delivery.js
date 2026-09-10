import { createHash } from 'node:crypto';
import { getBusinessProfile, getCustomerForBusiness, getFileForBusiness, getInvoiceForBusiness, getJobForBusiness, issueInvoiceForBusiness, listInvoicesForBusiness } from './_lib/authRepo.js';
import { createInvoiceAccessToken } from './_lib/invoiceAccessToken.js';
import { invoiceEmailConfiguration, invoiceMailer } from './_lib/invoiceEmails.js';
import { completeInvoiceDelivery, failInvoiceDelivery, prepareInvoiceDelivery, retryInvoiceDelivery } from './_lib/invoiceRepo.js';
import { buildInvoiceSnapshot } from './_lib/invoiceSnapshot.js';
import { requireSession } from './_lib/session.js';
import { readStoredFile } from './_lib/storage.js';
import { calculateJobInvoicePosition, getInvoiceContractAmount } from '../src/utils/invoiceModel.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const origin = () => new URL(process.env.APP_ORIGIN).origin;

export function createInvoiceDeliveryHandler(overrides = {}) {
  const deps = { requireSession, getBusinessProfile, getCustomerForBusiness, getFileForBusiness, getInvoiceForBusiness, getJobForBusiness, issueInvoiceForBusiness, listInvoicesForBusiness, readStoredFile, prepareInvoiceDelivery, retryInvoiceDelivery, completeInvoiceDelivery, failInvoiceDelivery, buildInvoiceSnapshot, createInvoiceAccessToken, invoiceEmailConfiguration, invoiceMailer, origin, now: () => new Date(), ...overrides };
  return async (req, res) => {
    const session = await deps.requireSession(req, res, ['owner', 'admin']);
    if (!session) return;
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const invoiceId = String(req.body?.invoiceId ?? '').trim();
    let invoice = await deps.getInvoiceForBusiness(session.businessId, invoiceId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'Invoice not found.' });
    const retrying = invoice.status === 'sent' && invoice.deliveryStatus === 'failed' && Boolean(invoice.customerDocumentSnapshot);
    if (invoice.status !== 'draft' && !retrying) return res.status(409).json({ ok: false, error: 'This invoice cannot be sent in its current state.' });
    const configured = deps.invoiceEmailConfiguration();
    if (!configured.ok) return res.status(503).json({ ok: false, error: configured.message });
    const [business, customer, job] = await Promise.all([deps.getBusinessProfile(session.businessId), deps.getCustomerForBusiness(session.businessId, invoice.customerId), deps.getJobForBusiness(session.businessId, invoice.jobId)]);
    if (!business || !customer || !job) return res.status(404).json({ ok: false, error: 'Invoice customer document data not found.' });
    const recipient = String(customer.email ?? '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(recipient)) return res.status(400).json({ ok: false, error: 'A valid customer email is required.' });
    const attemptedAt = deps.now().toISOString();
    const token = deps.createInvoiceAccessToken({ businessId: session.businessId, invoiceId });
    let snapshot = invoice.customerDocumentSnapshot;
    if (!snapshot) {
      snapshot = await deps.buildInvoiceSnapshot({ businessId: session.businessId, invoice, business, getFileForBusiness: deps.getFileForBusiness, readStoredFile: deps.readStoredFile });
      const prepared = await deps.prepareInvoiceDelivery({ businessId: session.businessId, invoiceId, snapshot, tokenHash: hash(token), attemptedAt });
      if (!prepared.ok) return res.status(409).json({ ok: false, error: prepared.error });
    } else if (retrying) {
      const retried = await deps.retryInvoiceDelivery({ businessId: session.businessId, invoiceId, attemptedAt });
      if (!retried.ok) return res.status(409).json({ ok: false, error: retried.error });
    }
    if (!retrying) {
      invoice = await deps.getInvoiceForBusiness(session.businessId, invoiceId);
      const otherInvoices = (await deps.listInvoicesForBusiness(session.businessId)).filter((item) => item.id !== invoice.id);
      const position = calculateJobInvoicePosition(job, otherInvoices);
      const sentAt = deps.now().toISOString();
      const issued = { ...invoice, status: 'sent', sentAt, deliveryStatus: 'pending', deliveryRecipient: recipient, contractReservationAmount: getInvoiceContractAmount(invoice), amountPaid: 0, balanceDue: invoice.amount, updatedAt: sentAt };
      const result = await deps.issueInvoiceForBusiness({ businessId: session.businessId, invoice: issued, contractAmount: position.contractAmount, baselineIssuedAmount: position.previouslyInvoiced, allowOverContract: invoice.overContract === true });
      if (!result.ok) return res.status(409).json({ ok: false, error: result.error });
      invoice = issued;
    }
    const viewUrl = `${deps.origin()}/invoice/${token}`;
    const email = await deps.invoiceMailer.sendInvoice({ to: recipient, customerName: snapshot.invoice.customerName, company: snapshot.company, invoice: snapshot.invoice, viewUrl, idempotencyKey: `invoice-${invoice.id}` });
    if (!email.ok) {
      await deps.failInvoiceDelivery({ businessId: session.businessId, invoiceId, reason: email.message });
      return res.status(502).json({ ok: false, error: email.message, emailStatus: 'failed', invoice: { ...invoice, deliveryStatus: 'failed', deliveryFailureReason: email.message } });
    }
    const submittedAt = deps.now().toISOString();
    await deps.completeInvoiceDelivery({ businessId: session.businessId, invoiceId, recipient, providerMessageId: email.providerMessageId, submittedAt });
    const delivered = { ...invoice, deliveryStatus: 'sent', deliveryRecipient: recipient, deliveryProviderMessageId: email.providerMessageId, deliverySubmittedAt: submittedAt };
    return res.status(200).json({ ok: true, invoice: delivered, viewUrl, emailSent: true });
  };
}

export default createInvoiceDeliveryHandler();