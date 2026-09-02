import test from 'node:test';
import assert from 'node:assert/strict';

import { ddb } from '../api/_lib/db.js';
import { issueInvoiceForBusiness, voidInvoiceForBusiness } from '../api/_lib/authRepo.js';

const transactionCancelled = () => Object.assign(new Error('transaction cancelled'), { name: 'TransactionCanceledException' });
const invoiceItem = (id, status = 'draft') => ({
  PK: 'BUSINESS#business-a', SK: `INVOICE#${id}`, entityType: 'INVOICE', businessId: 'business-a',
  invoiceId: id, id, jobId: 'job-a', customerId: 'customer-a', number: `INV-${id}`,
  status, subtotal: 60, taxAmount: 7.8, amount: 67.8, updatedAt: '2027-01-01T00:00:00.000Z',
});

function installLedgerMock(context) {
  const originalSend = ddb.send.bind(ddb);
  const state = { invoices: new Map([['invoice-a', invoiceItem('invoice-a')], ['invoice-b', invoiceItem('invoice-b')]]), ledger: null, audits: new Set() };
  ddb.send = async (command) => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
      if (input.Key.SK.startsWith('INVOICE#')) return { Item: state.invoices.get(input.Key.SK.slice('INVOICE#'.length)) };
      return { Item: state.ledger ? { ...state.ledger } : undefined };
    }
    if (command.constructor.name !== 'TransactWriteCommand') throw new Error(`Unexpected ${command.constructor.name}`);

    const nextInvoices = new Map(state.invoices);
    let nextLedger = state.ledger ? { ...state.ledger } : null;
    for (const operation of input.TransactItems) {
      if (operation.ConditionCheck) {
        if (nextLedger) throw transactionCancelled();
      }
      if (operation.Update) {
        const values = operation.Update.ExpressionAttributeValues;
        const names = operation.Update.ExpressionAttributeNames;
        if (Object.hasOwn(values, ':baseline')) {
          const current = nextLedger?.issuedAmount ?? values[':baseline'];
          const reservationField = names['#reservation'];
          if (nextLedger?.[reservationField] !== undefined) throw transactionCancelled();
          if (operation.Update.ConditionExpression.includes(':maximumBefore') && current > values[':maximumBefore']) throw transactionCancelled();
          nextLedger = { ...(nextLedger ?? {}), PK: operation.Update.Key.PK, SK: operation.Update.Key.SK, issuedAmount: current + values[':amount'], [reservationField]: values[':amount'] };
        } else {
          const releasedField = names['#released'];
          if (!nextLedger || nextLedger[releasedField] !== undefined || nextLedger.issuedAmount < values[':amount']) throw transactionCancelled();
          nextLedger = { ...nextLedger, issuedAmount: nextLedger.issuedAmount + values[':negativeAmount'], [releasedField]: values[':amount'] };
        }
      }
      if (operation.Put) {
        if (operation.Put.Item.entityType === 'AUDIT_EVENT') {
          if (state.audits.has(operation.Put.Item.eventId)) throw transactionCancelled();
          state.audits.add(operation.Put.Item.eventId);
          continue;
        }
        const id = operation.Put.Item.invoiceId;
        const current = nextInvoices.get(id);
        if (operation.Put.ConditionExpression.includes(':draft') && current?.status !== 'draft') throw transactionCancelled();
        if (operation.Put.ConditionExpression.includes(':overdue') && !['sent', 'overdue'].includes(current?.status)) throw transactionCancelled();
        nextInvoices.set(id, { ...operation.Put.Item });
      }
    }
    state.invoices = nextInvoices;
    state.ledger = nextLedger;
    return {};
  };
  context.after(() => { ddb.send = originalSend; });
  return state;
}

test('concurrent Send cannot over-reserve and Send/Void retries apply exactly once', async (context) => {
  const state = installLedgerMock(context);
  const sentA = { ...invoiceItem('invoice-a', 'sent'), sentAt: '2027-01-01T00:00:00.000Z', contractReservationAmount: 60 };
  const sentB = { ...invoiceItem('invoice-b', 'sent'), sentAt: '2027-01-01T00:00:00.000Z', contractReservationAmount: 60 };
  const send = (invoice) => issueInvoiceForBusiness({ businessId: 'business-a', invoice, contractAmount: 100, baselineIssuedAmount: 0 });

  const results = await Promise.all([send(sentA), send(sentB)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.equal(state.ledger.issuedAmount, 60);

  const issued = state.invoices.get('invoice-a').status === 'sent' ? sentA : sentB;
  const retry = await send(issued);
  assert.deepEqual(retry, { ok: true, idempotent: true });
  assert.equal(state.ledger.issuedAmount, 60);

  const voided = { ...state.invoices.get(issued.id), status: 'void', voidedAt: '2027-01-02T00:00:00.000Z', voidReason: 'Cancelled' };
  const actor = { id: 'user-a', name: 'Admin', email: 'admin@example.com' };
  const firstVoid = await voidInvoiceForBusiness({ businessId: 'business-a', invoice: voided, actor });
  const retryVoid = await voidInvoiceForBusiness({ businessId: 'business-a', invoice: voided, actor });
  assert.deepEqual(firstVoid, { ok: true, idempotent: false });
  assert.deepEqual(retryVoid, { ok: true, idempotent: true });
  assert.equal(state.ledger.issuedAmount, 0);
  assert.equal(state.audits.size, 1);
});

test('historical issued invoice voids idempotently when no ledger exists', async (context) => {
  const state = installLedgerMock(context);
  state.invoices.set('historical', { ...invoiceItem('historical', 'sent'), subtotal: 100, amount: 113 });
  const invoice = { ...state.invoices.get('historical'), status: 'void', voidedAt: '2027-02-01T00:00:00.000Z', voidReason: 'Historical correction' };
  const actor = { id: 'user-a', name: 'Admin', email: 'admin@example.com' };

  const first = await voidInvoiceForBusiness({ businessId: 'business-a', invoice, actor });
  const retry = await voidInvoiceForBusiness({ businessId: 'business-a', invoice, actor });

  assert.deepEqual(first, { ok: true, idempotent: false });
  assert.deepEqual(retry, { ok: true, idempotent: true });
  assert.equal(state.ledger, null);
  assert.equal(state.invoices.get('historical').status, 'void');
  assert.equal(state.audits.size, 1);
});