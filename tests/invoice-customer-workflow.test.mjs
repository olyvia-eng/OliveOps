import test from 'node:test';
import assert from 'node:assert/strict';

import { createInvoiceDeliveryHandler } from '../api/invoice-delivery.js';
import { createInvoicePaymentsHandler } from '../api/invoice-payments.js';
import { createPublicInvoiceHandler } from '../api/public-invoice.js';
import { createInvoiceMailer } from '../api/_lib/invoiceEmails.js';
import { buildInvoiceSnapshot } from '../api/_lib/invoiceSnapshot.js';
import { createInvoiceAccessToken } from '../api/_lib/invoiceAccessToken.js';
import { customerDocumentSettings, enabledPaymentMethods, normalizePaymentMethods, validatePaymentMethods } from '../shared/customerDocuments.js';
import { createInvoiceDocument } from '../src/utils/invoicePdf.js';
import { buildInvoicePresentation } from '../src/utils/invoicePresentationModel.js';

const token = 'A'.repeat(43);
const business = {
  id: 'business-a', name: 'Greendale Landscaping', legalName: 'Greendale Landscaping Ltd.', email: 'admin@greendalelandscaping.ca', phone: '705-111-2345',
  businessAddress: '1245 Main St.\nToronto, ON K9K 2R3', paymentInstructions: 'Include the invoice number with payment.',
  paymentMethods: normalizePaymentMethods([
    { type: 'etransfer', enabled: true, displayName: 'E-transfer', instructions: 'Send to accounting@greendalelandscaping.ca' },
    { type: 'cheque', enabled: true, displayName: 'Cheque', instructions: 'Make payable to Greendale Landscaping.' },
  ]),
};
const invoice = {
  id: 'invoice-a', number: 'INV-2026-0001', status: 'draft', jobId: 'job-a', customerId: 'customer-a', issueDate: '2026-09-10', dueDate: '2026-10-10',
  customerNameSnapshot: 'Karen Sullivan', billingAddressSnapshot: '1 Customer Road', jobTitleSnapshot: 'Flagstone Patio', jobAddressSnapshot: '2 Project Road',
  subtotal: 2775.98, taxRate: 13, taxAmount: 360.88, amount: 3136.86, amountPaid: 0, notes: 'Thank you.',
  lineItems: [{ id: 'line-a', category: 'contract_service', description: 'Flagstone Patio', quantity: 1, unit: 'contract', taxable: true, subtotal: 2775.98, taxAmount: 360.88, total: 3136.86 }],
};
const customer = { id: 'customer-a', name: 'Karen Sullivan', email: 'karen@example.ca' };
const job = { id: 'job-a', customerId: 'customer-a', title: 'Flagstone Patio', currentContractRevenue: 4000 };

function response() {
  return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(value) { this.body = value; return this; } };
}

async function call(handler, req) { const res = response(); await handler(req, res); return res; }

async function snapshot() {
  return buildInvoiceSnapshot({ businessId: business.id, invoice, business, getFileForBusiness: async () => null, readStoredFile: async () => new Uint8Array() });
}

test('customer-document settings backfill legacy profiles and validate configurable payment methods', () => {
  const legacy = customerDocumentSettings({});
  assert.equal(legacy.defaultPaymentTermsDays, 30);
  assert.equal(legacy.paymentMethods.length, 8);
  assert.equal(enabledPaymentMethods(business).length, 2);
  assert.equal(validatePaymentMethods(business.paymentMethods), null);
  assert.match(validatePaymentMethods([{ type: 'etransfer', enabled: 'yes', displayName: 'E-transfer' }]), /enabled/);
  assert.match(validatePaymentMethods([{ type: 'fake', enabled: true, displayName: 'Fake' }]), /invalid/);
});

test('invoice snapshot reuses canonical branding and freezes enabled payment instructions', async () => {
  const issued = await snapshot();
  assert.equal(issued.company.name, 'Greendale Landscaping Ltd.');
  assert.deepEqual(issued.paymentMethods.map((method) => method.displayName), ['E-transfer', 'Cheque']);
  business.paymentMethods[0].instructions = 'Changed later';
  assert.equal(issued.paymentMethods[0].instructions, 'Send to accounting@greendalelandscaping.ca');
  const presentation = buildInvoicePresentation(issued);
  assert.equal(presentation.totals.displayBalance, '$3,136.86');
  assert.equal(presentation.paymentMethods.length, 2);
  assert.equal(presentation.information.every((item) => Array.isArray(item.details)), true);
  business.paymentMethods[0].instructions = 'Send to accounting@greendalelandscaping.ca';
});

test('invoice email uses Resend branding, secure URL, and no attachment containing invoice data', async () => {
  let message; let options;
  const mailer = createInvoiceMailer({ env: { RESEND_API_KEY: 'secret', INVOICE_FROM_EMAIL: 'OliveOps <billing@oliveops.ca>' }, resendClient: { emails: { send: async (value, sendOptions) => { message = value; options = sendOptions; return { data: { id: 'resend-invoice-1' } }; } } } });
  const snap = await snapshot();
  const result = await mailer.sendInvoice({ to: customer.email, customerName: customer.name, company: snap.company, invoice: snap.invoice, viewUrl: `https://app.example.ca/invoice/${token}`, idempotencyKey: 'invoice-invoice-a' });
  assert.deepEqual(result, { ok: true, providerMessageId: 'resend-invoice-1' });
  assert.equal(message.from, 'Greendale Landscaping Ltd. via OliveOps <billing@oliveops.ca>');
  assert.equal(message.replyTo, business.email);
  assert.deepEqual(options, { idempotencyKey: 'invoice-invoice-a' });
  for (const value of ['Your invoice is ready', 'Flagstone Patio', 'INV-2026-0001', '$3,136.86', 'October 10, 2026', 'View Invoice', token, 'does not process payments']) assert.match(message.html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal('attachments' in message, false);
});

test('send snapshots before issuing, issues before email, and returns the immutable secure URL', async () => {
  const events = [];
  let stored = structuredClone(invoice);
  const handler = createInvoiceDeliveryHandler({
    requireSession: async () => ({ id: 'owner-a', businessId: 'business-a', name: 'Owner', email: 'owner@example.ca' }),
    getInvoiceForBusiness: async (businessId) => businessId === 'business-a' ? structuredClone(stored) : null,
    getBusinessProfile: async () => structuredClone(business), getCustomerForBusiness: async () => customer, getJobForBusiness: async () => job,
    getFileForBusiness: async () => null, readStoredFile: async () => new Uint8Array(), listInvoicesForBusiness: async () => [stored],
    createInvoiceAccessToken: () => token, invoiceEmailConfiguration: () => ({ ok: true }), origin: () => 'https://app.example.ca', now: () => new Date('2026-09-10T12:00:00.000Z'),
    prepareInvoiceDelivery: async ({ snapshot: value }) => { events.push('snapshot'); stored = { ...stored, customerDocumentSnapshot: structuredClone(value), deliveryStatus: 'pending' }; return { ok: true }; },
    issueInvoiceForBusiness: async ({ invoice: value, businessId }) => { events.push('issue'); assert.equal(businessId, 'business-a'); stored = structuredClone(value); return { ok: true }; },
    invoiceMailer: { sendInvoice: async ({ idempotencyKey }) => { events.push('email'); assert.equal(idempotencyKey, 'invoice-invoice-a'); return { ok: true, providerMessageId: 'resend-1' }; } },
    completeInvoiceDelivery: async () => { events.push('complete'); }, failInvoiceDelivery: async () => assert.fail('delivery should not fail'),
  });
  const result = await call(handler, { method: 'POST', body: { invoiceId: invoice.id } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(events, ['snapshot', 'issue', 'email', 'complete']);
  assert.equal(result.body.invoice.status, 'sent');
  assert.equal(result.body.viewUrl, `https://app.example.ca/invoice/${token}`);
});

test('failed email remains an issued invoice with a retryable delivery state', async () => {
  let stored = structuredClone(invoice); let failed;
  const handler = createInvoiceDeliveryHandler({
    requireSession: async () => ({ id: 'owner-a', businessId: 'business-a' }), getInvoiceForBusiness: async () => structuredClone(stored),
    getBusinessProfile: async () => business, getCustomerForBusiness: async () => customer, getJobForBusiness: async () => job,
    getFileForBusiness: async () => null, readStoredFile: async () => new Uint8Array(), listInvoicesForBusiness: async () => [stored],
    createInvoiceAccessToken: () => token, invoiceEmailConfiguration: () => ({ ok: true }), origin: () => 'https://app.example.ca', now: () => new Date('2026-09-10T12:00:00.000Z'),
    prepareInvoiceDelivery: async ({ snapshot: value }) => { stored = { ...stored, customerDocumentSnapshot: value, deliveryStatus: 'pending' }; return { ok: true }; },
    issueInvoiceForBusiness: async ({ invoice: value }) => { stored = structuredClone(value); return { ok: true }; },
    invoiceMailer: { sendInvoice: async () => ({ ok: false, message: 'Provider rejected the message.' }) },
    failInvoiceDelivery: async (value) => { failed = value; }, completeInvoiceDelivery: async () => assert.fail('failed email cannot complete'),
  });
  const result = await call(handler, { method: 'POST', body: { invoiceId: invoice.id } });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.invoice.status, 'sent');
  assert.equal(result.body.invoice.deliveryStatus, 'failed');
  assert.equal(failed.businessId, 'business-a');
});

test('secure invoice access fails closed and records external first/last/count views without tenant data', async () => {
  const snap = await snapshot(); let viewed;
  const handler = createPublicInvoiceHandler({ getPublicInvoiceByTokenHash: async () => ({ token: { businessId: 'business-a', invoiceId: invoice.id }, invoice: { ...invoice, status: 'sent', customerDocumentSnapshot: snap } }), markInvoiceViewed: async (value) => { viewed = value; }, now: () => new Date('2026-09-11T13:42:00.000Z') });
  assert.equal((await call(handler, { method: 'GET', query: { token: 'guessable' } })).statusCode, 404);
  const denied = createPublicInvoiceHandler({ getPublicInvoiceByTokenHash: async () => null });
  assert.equal((await call(denied, { method: 'GET', query: { token } })).statusCode, 404);
  const result = await call(handler, { method: 'GET', query: { token } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(viewed.businessId, 'business-a');
  assert.equal(viewed.viewedAt, '2026-09-11T13:42:00.000Z');
  assert.doesNotMatch(JSON.stringify(result.body), /business-a|customer-a|job-a|unitCost|margin|tokenHash/);
});

test('payment workflow supports partial and multiple payments, blocks overpayment, and remains tenant scoped', async () => {
  let current = { ...invoice, status: 'sent', amountPaid: 0, balanceDue: invoice.amount };
  const payments = [];
  const handler = createInvoicePaymentsHandler({
    requireSession: async () => ({ id: 'owner-a', businessId: 'business-a', name: 'Owner', email: 'owner@example.ca' }),
    getInvoiceForBusiness: async (businessId, invoiceId) => businessId === 'business-a' && invoiceId === invoice.id ? structuredClone(current) : null,
    listInvoicePayments: async ({ businessId }) => { assert.equal(businessId, 'business-a'); return structuredClone(payments); },
    randomUUID: (() => { let count = 0; return () => `payment-${++count}`; })(), now: () => new Date('2026-09-12T12:00:00.000Z'),
    recordInvoicePayment: async ({ businessId, invoice: source, payment }) => {
      assert.equal(businessId, 'business-a');
      const nextPaid = source.amountPaid + payment.amount;
      if (nextPaid > source.amount) return { ok: false, error: 'Payment exceeds the remaining balance.' };
      const balanceDue = Math.round((source.amount - nextPaid) * 100) / 100;
      const status = balanceDue === 0 ? 'paid' : 'partially_paid';
      current = { ...source, amountPaid: nextPaid, balanceDue, status }; payments.unshift(payment);
      return { ok: true, amountPaid: nextPaid, balanceDue, status };
    },
  });
  const first = await call(handler, { method: 'POST', query: {}, body: { invoiceId: invoice.id, amount: 1500, paymentDate: '2026-09-12', paymentMethod: 'E-transfer', reference: 'ET-1' } });
  assert.equal(first.statusCode, 201); assert.equal(first.body.invoice.status, 'partially_paid'); assert.equal(first.body.invoice.balanceDue, 1636.86);
  const over = await call(handler, { method: 'POST', query: {}, body: { invoiceId: invoice.id, amount: 2000, paymentDate: '2026-09-12', paymentMethod: 'Other' } });
  assert.equal(over.statusCode, 409); assert.equal(current.amountPaid, 1500);
  const final = await call(handler, { method: 'POST', query: {}, body: { invoiceId: invoice.id, amount: 1636.86, paymentDate: '2026-09-13', paymentMethod: 'Cheque', reference: '1004' } });
  assert.equal(final.body.invoice.status, 'paid'); assert.equal(final.body.invoice.balanceDue, 0);
  const history = await call(handler, { method: 'GET', query: { invoiceId: invoice.id }, body: {} });
  assert.equal(history.body.payments.length, 2);
  assert.deepEqual(history.body.payments.map((payment) => payment.quickBooksSync.status), ['not_synced', 'not_synced']);
});

test('invoice access tokens are stable, tenant-bound, and contain no business identifiers', () => {
  const env = { JWT_SECRET: 'server-secret' };
  const first = createInvoiceAccessToken({ businessId: 'business-a', invoiceId: 'invoice-a', env });
  assert.equal(createInvoiceAccessToken({ businessId: 'business-a', invoiceId: 'invoice-a', env }), first);
  assert.notEqual(createInvoiceAccessToken({ businessId: 'business-b', invoiceId: 'invoice-a', env }), first);
  assert.doesNotMatch(first, /business|invoice|server-secret/);
});

test('invoice PDF embeds snapshotted branding and paginates adversarial customer content', async () => {
  const issued = await snapshot();
  issued.company.logoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  issued.invoice.lineItems = Array.from({ length: 32 }, (_, index) => ({ category: 'contract_service', description: `Landscape installation phase ${index + 1}: excavation, drainage, granular base, material placement, grading, cleanup, and restoration`, quantity: 1, unit: 'phase', taxable: true, subtotal: 100, taxAmount: 13, total: 113 }));
  issued.paymentMethods[0].instructions = 'Include the invoice number and property address with payment. '.repeat(20);
  issued.paymentInstructions = 'Contact the contractor directly with any payment questions. '.repeat(20);
  issued.invoice.notes = 'Historical customer note. '.repeat(40);
  const document = createInvoiceDocument(issued);
  assert.ok(document.getNumberOfPages() >= 2);
  assert.ok(document.output('arraybuffer').byteLength > 10_000);
  for (let page = 1; page <= document.getNumberOfPages(); page += 1) {
    assert.match(document.internal.pages[page].join('\n'), new RegExp(`Page ${page}`));
  }
});
