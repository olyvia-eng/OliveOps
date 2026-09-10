import test from 'node:test';
import assert from 'node:assert/strict';

import { ddb } from '../api/_lib/db.js';
import { createInvoiceForBusiness, deleteInvoiceForBusiness, issueInvoiceForBusiness, voidInvoiceForBusiness } from '../api/_lib/authRepo.js';

const transactionCancelled = () => Object.assign(new Error('transaction cancelled'), { name: 'TransactionCanceledException' });
const invoiceItem = (id, status = 'draft') => ({
  PK: 'BUSINESS#business-a', SK: `INVOICE#${id}`, entityType: 'INVOICE', businessId: 'business-a',
  invoiceId: id, id, jobId: 'job-a', customerId: 'customer-a', number: `INV-${id}`,
  status, subtotal: 60, taxAmount: 7.8, amount: 67.8, updatedAt: '2027-01-01T00:00:00.000Z',
});

function installLedgerMock(context) {
  const originalSend = ddb.send.bind(ddb);
  const state = { invoices: new Map([['invoice-a', invoiceItem('invoice-a')], ['invoice-b', invoiceItem('invoice-b')]]), claims: new Map(), ledger: null, audits: new Set() };
  ddb.send = async (command) => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
      if (input.Key.SK.startsWith('INVOICE#')) return { Item: state.invoices.get(input.Key.SK.slice('INVOICE#'.length)) };
      if (input.Key.SK.startsWith('INVOICE_SCHEDULE_CLAIM#')) return { Item: state.claims.get(input.Key.SK) };
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
      if (operation.Delete) {
        const current = state.claims.get(operation.Delete.Key.SK);
        if (current?.invoiceId !== operation.Delete.ExpressionAttributeValues[':invoiceId']) throw transactionCancelled();
        state.claims.delete(operation.Delete.Key.SK);
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

test('voiding an issued contract invoice releases its payment schedule claim', async (context) => {
  const state = installLedgerMock(context);
  const claimKey = 'INVOICE_SCHEDULE_CLAIM#job-a#deposit';
  const sent = {
    ...invoiceItem('scheduled', 'sent'), paymentScheduleItemId: 'deposit',
    contractReservationAmount: 60, sentAt: '2027-01-01T00:00:00.000Z',
  };
  state.invoices.set(sent.id, sent);
  state.claims.set(claimKey, { SK: claimKey, invoiceId: sent.id });
  state.ledger = { issuedAmount: 60, [`reserved#${sent.id}`]: 60 };

  const invoice = { ...sent, status: 'void', voidedAt: '2027-01-02T00:00:00.000Z', voidReason: 'Contract cancelled' };
  const result = await voidInvoiceForBusiness({
    businessId: 'business-a', invoice,
    actor: { id: 'user-a', name: 'Admin', email: 'admin@example.com' },
  });

  assert.deepEqual(result, { ok: true, idempotent: false });
  assert.equal(state.claims.has(claimKey), false);
});

test('payment schedule claims reject concurrent invoice drafts and release on deletion', async (context) => {
  const originalSend = ddb.send.bind(ddb);
  const state = { items: new Map() };
  ddb.send = async (command) => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return { Item: state.items.get(input.Key.SK) };
    if (command.constructor.name === 'DeleteCommand') {
      state.items.delete(input.Key.SK);
      return {};
    }
    if (command.constructor.name !== 'TransactWriteCommand') throw new Error(`Unexpected ${command.constructor.name}`);

    const nextItems = new Map(state.items);
    for (const operation of input.TransactItems) {
      if (operation.Put) {
        const key = operation.Put.Item.SK;
        if (operation.Put.ConditionExpression.includes('attribute_not_exists') && nextItems.has(key)) throw transactionCancelled();
        nextItems.set(key, { ...operation.Put.Item });
      }
      if (operation.Delete) {
        const current = nextItems.get(operation.Delete.Key.SK);
        if (operation.Delete.ConditionExpression?.includes('#invoiceId') && current?.invoiceId !== operation.Delete.ExpressionAttributeValues[':invoiceId']) throw transactionCancelled();
        if (operation.Delete.ConditionExpression?.includes('#status') && current?.status !== 'draft') throw transactionCancelled();
        nextItems.delete(operation.Delete.Key.SK);
      }
    }
    state.items = nextItems;
    return {};
  };
  context.after(() => { ddb.send = originalSend; });

  const base = {
    jobId: 'job-a', customerId: 'customer-a', paymentScheduleItemId: 'deposit',
    status: 'draft', updatedAt: '2027-01-01T00:00:00.000Z',
  };
  const invoiceA = { ...base, id: 'invoice-a' };
  const invoiceB = { ...base, id: 'invoice-b' };
  const results = await Promise.all([
    createInvoiceForBusiness({ businessId: 'business-a', invoice: invoiceA }),
    createInvoiceForBusiness({ businessId: 'business-a', invoice: invoiceB }),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  const created = results[0].ok ? invoiceA : invoiceB;
  const rejected = results[0].ok ? invoiceB : invoiceA;
  assert.match(results.find((result) => !result.ok).error, /already has an invoice/);

  await deleteInvoiceForBusiness('business-a', created.id, created);
  assert.deepEqual(await createInvoiceForBusiness({ businessId: 'business-a', invoice: rejected }), { ok: true });
});