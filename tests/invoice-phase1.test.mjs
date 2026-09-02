import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ddb } from '../api/_lib/db.js';
import { reserveNextInvoiceNumberForBusiness } from '../api/_lib/authRepo.js';
import { getInvoiceBalance, isValidInvoiceStatusTransition } from '../src/utils/invoiceModel.js';

test('invoice numbers use one tenant-and-year scoped atomic ADD counter', async (context) => {
  const originalSend = ddb.send.bind(ddb);
  let sequence = 0;
  const commands = [];
  ddb.send = async (command) => {
    commands.push(command.input);
    sequence += 1;
    return { Attributes: { sequence } };
  };
  context.after(() => { ddb.send = originalSend; });

  const numbers = await Promise.all(Array.from({ length: 25 }, () => reserveNextInvoiceNumberForBusiness({
    businessId: 'business-a',
    year: '2027',
  })));

  assert.equal(new Set(numbers).size, 25);
  assert.equal(numbers[0], 'INV-2027-001');
  assert.equal(numbers.at(-1), 'INV-2027-025');
  assert.ok(commands.every((input) => input.Key.PK === 'BUSINESS#business-a'));
  assert.ok(commands.every((input) => input.Key.SK === 'INVOICE_COUNTER#2027'));
  assert.ok(commands.every((input) => input.UpdateExpression.includes('ADD #sequence :increment')));
  assert.ok(commands.every((input) => input.ReturnValues === 'UPDATED_NEW'));
});

test('invoice status transitions are forward-only and void is terminal', () => {
  assert.equal(isValidInvoiceStatusTransition('draft', 'sent'), true);
  assert.equal(isValidInvoiceStatusTransition('draft', 'paid'), false);
  assert.equal(isValidInvoiceStatusTransition('sent', 'partially_paid'), true);
  assert.equal(isValidInvoiceStatusTransition('sent', 'void'), true);
  assert.equal(isValidInvoiceStatusTransition('paid', 'void'), false);
  assert.equal(isValidInvoiceStatusTransition('void', 'sent'), false);
});

test('invoice balances preserve draft display but exclude paid and void balances', () => {
  assert.equal(getInvoiceBalance({ status: 'draft', amount: 113 }), 113);
  assert.equal(getInvoiceBalance({ status: 'sent', amount: 113 }), 113);
  assert.equal(getInvoiceBalance({ status: 'paid', amount: 113 }), 0);
  assert.equal(getInvoiceBalance({ status: 'void', amount: 113 }), 0);
});

test('invoice API owns numbers, totals, snapshots, lifecycle timestamps, and destructive restrictions', () => {
  const source = readFileSync('api/data.js', 'utf8');
  assert.match(source, /Invoice number is assigned by the server/);
  assert.match(source, /Invoice number cannot be changed/);
  assert.match(source, /normalizeInvoiceFinancials\(record\)/);
  assert.match(source, /customerNameSnapshot/);
  assert.match(source, /Invoice lifecycle timestamps are server-controlled/);
  assert.match(source, /Invoice exceeds the remaining contract amount/);
  assert.match(source, /QuickBooks-linked invoices are read-only/);
  assert.match(source, /Only draft invoices can be deleted/);
  assert.match(source, /action: 'invoice_voided'/);
});

test('invoice drawer awaits persistence, keeps errors visible, and does not expose manual numbers', () => {
  const page = readFileSync('src/pages/finance/InvoicesPage.tsx', 'utf8');
  const store = readFileSync('src/store/index.ts', 'utf8');
  assert.match(page, /Assigned when saved/);
  assert.doesNotMatch(page, /label="Invoice Number"/);
  assert.match(page, /const result = selected \? await updateInvoice/);
  assert.match(page, /if \(!result\.ok\) return setError/);
  assert.match(page, /setOpen\(false\); emitAppToast/);
  assert.match(page, /legacy \? 'Legacy price incl\. tax' : 'Unit Price'/);
  assert.match(store, /addInvoice: async/);
  assert.match(store, /payload\.invoice/);
});

test('QuickBooks refuses draft invoice creation and supports both tax modes', () => {
  const endpoint = readFileSync('api/integrations/quickbooks/invoices.js', 'utf8');
  const projection = readFileSync('api/_lib/quickBooksSync.js', 'utf8');
  assert.match(endpoint, /invoice\.status === 'draft'/);
  assert.match(projection, /'TaxExcluded' : 'TaxInclusive'/);
});