import test from 'node:test';
import assert from 'node:assert/strict';

import { ddb } from '../api/_lib/db.js';
import { recordInvoicePayment } from '../api/_lib/invoiceRepo.js';

const cancelled = () => Object.assign(new Error('transaction cancelled'), { name: 'TransactionCanceledException' });
const actor = { id: 'owner-a', name: 'Owner', email: 'owner@example.ca' };
const invoice = { id: 'invoice-a', status: 'sent', amount: 100, amountPaid: 0 };
const payment = (id, amount) => ({ id, amount, paymentDate: '2026-09-12', paymentMethod: 'E-transfer', reference: id, notes: '', createdAt: '2026-09-12T12:00:00.000Z', recordedBy: actor.id, quickBooksSync: { status: 'not_synced' } });

function installPaymentMock(context) {
  const originalSend = ddb.send.bind(ddb);
  const state = { invoices: new Map([['BUSINESS#business-a|INVOICE#invoice-a', { ...invoice }]]), payments: new Map(), audits: new Map() };
  ddb.send = async (command) => {
    assert.equal(command.constructor.name, 'TransactWriteCommand');
    const operations = command.input.TransactItems;
    const update = operations[0].Update;
    const key = `${update.Key.PK}|${update.Key.SK}`;
    const current = state.invoices.get(key);
    const values = update.ExpressionAttributeValues;
    if (!current || !['sent', 'partially_paid', 'overdue'].includes(current.status) || (Number(current.amountPaid) || 0) !== values[':expectedPaid'] || values[':nextPaid'] > current.amount) throw cancelled();
    const paymentPut = operations[1].Put.Item;
    const auditPut = operations[2].Put.Item;
    if (state.payments.has(paymentPut.SK) || state.audits.has(auditPut.SK)) throw cancelled();
    state.invoices.set(key, { ...current, amountPaid: values[':nextPaid'], balanceDue: values[':balance'], status: values[':status'] });
    state.payments.set(paymentPut.SK, structuredClone(paymentPut));
    state.audits.set(auditPut.SK, structuredClone(auditPut));
    return {};
  };
  context.after(() => { ddb.send = originalSend; });
  return state;
}

test('concurrent payment attempts use an optimistic amount-paid condition and only one stale write commits', async (context) => {
  const state = installPaymentMock(context);
  const attempts = await Promise.all([
    recordInvoicePayment({ businessId: 'business-a', invoice, payment: payment('payment-a', 60), actor }),
    recordInvoicePayment({ businessId: 'business-a', invoice, payment: payment('payment-b', 60), actor }),
  ]);
  assert.equal(attempts.filter((result) => result.ok).length, 1);
  assert.equal(attempts.filter((result) => !result.ok).length, 1);
  assert.equal(state.invoices.get('BUSINESS#business-a|INVOICE#invoice-a').amountPaid, 60);
  assert.equal(state.payments.size, 1);
  assert.equal(state.audits.size, 1);
});

test('payment transaction is tenant scoped, rejects overpayment, and stores immutable history with sync metadata', async (context) => {
  const state = installPaymentMock(context);
  const foreign = await recordInvoicePayment({ businessId: 'business-b', invoice, payment: payment('foreign', 10), actor });
  assert.equal(foreign.ok, false);
  assert.equal(state.payments.size, 0);

  const excessive = await recordInvoicePayment({ businessId: 'business-a', invoice, payment: payment('excessive', 100.01), actor });
  assert.equal(excessive.ok, false);
  assert.equal(state.payments.size, 0);

  const result = await recordInvoicePayment({ businessId: 'business-a', invoice, payment: payment('payment-a', 40), actor });
  assert.deepEqual(result, { ok: true, amountPaid: 40, balanceDue: 60, status: 'partially_paid' });
  const stored = [...state.payments.values()][0];
  assert.equal(stored.businessId, 'business-a');
  assert.equal(stored.invoiceId, 'invoice-a');
  assert.deepEqual(stored.quickBooksSync, { status: 'not_synced' });
  assert.equal([...state.audits.values()][0].action, 'invoice_payment_recorded');
});
