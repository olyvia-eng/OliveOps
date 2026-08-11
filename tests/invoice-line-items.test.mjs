import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateIncludedTax,
  calculateInvoiceLineAmount,
  calculateInvoiceSummary,
  normalizeInvoiceFinancials,
  roundCurrency,
  validateInvoiceLineItems,
} from '../src/utils/invoiceModel.js';

const line = (overrides = {}) => ({
  id: 'line-1',
  category: 'labour',
  description: 'Installation labour',
  quantity: 1,
  unit: 'job',
  unitPrice: 113,
  amount: 113,
  taxable: true,
  ...overrides,
});

test('invoice model rounds line amounts at currency precision', () => {
  assert.equal(calculateInvoiceLineAmount(line({ quantity: 1.255, unitPrice: 10 })), 12.55);
  assert.equal(roundCurrency(10.005), 10.01);
});

test('invoice model extracts included tax from a tax-inclusive amount', () => {
  assert.equal(calculateIncludedTax(113, 13), 13);
  assert.equal(calculateIncludedTax(105, 5), 5);
  assert.equal(calculateIncludedTax(100, 0), 0);
});

test('invoice summary supports mixed taxable and non-taxable gross lines', () => {
  const summary = calculateInvoiceSummary([
    line(),
    line({ id: 'line-2', category: 'material', description: 'Permit', unitPrice: 50, amount: 50, taxable: false }),
  ], 13);

  assert.deepEqual(summary, {
    subtotal: 150,
    taxAmount: 13,
    amount: 163,
  });
});

test('invoice line validation rejects missing tax decisions and stale derived amounts', () => {
  assert.equal(validateInvoiceLineItems([line()], 0), 'A valid tax rate is required for taxable invoice lines.');
  assert.equal(
    validateInvoiceLineItems([line({ amount: 112.99 })], 13),
    'Invoice line item amount does not match quantity and unit price.'
  );
  assert.equal(validateInvoiceLineItems([line()], 13), null);
});

test('invoice line validation keeps legacy flat invoices distinguishable', () => {
  assert.equal(validateInvoiceLineItems(undefined, 0), 'Invoice requires at least one line item.');
  assert.equal(validateInvoiceLineItems([], 0), 'Invoice requires at least one line item.');
});

test('invoice normalization overwrites client-derived financial values', () => {
  const normalized = normalizeInvoiceFinancials({
    amount: 999,
    subtotal: 999,
    taxAmount: 0,
    taxRate: 13,
    lineItems: [line({ amount: 999 })],
  });

  assert.equal(normalized.lineItems[0].amount, 113);
  assert.equal(normalized.subtotal, 100);
  assert.equal(normalized.taxAmount, 13);
  assert.equal(normalized.amount, 113);
});