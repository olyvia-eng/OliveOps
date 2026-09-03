import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateInvoiceLineFinancials,
  calculateJobInvoicePosition,
  getCustomerBillingAddressSnapshot,
  getInvoiceRevenueAmount,
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

test('schema version 2 uses tax-exclusive prices and rounded line financials', () => {
  const taxable = { ...line(), unitPriceBeforeTax: 10.005, unitPrice: undefined, amount: 999 };
  const nonTaxable = { ...line({ id: 'line-2', taxable: false }), unitPriceBeforeTax: 5.555, unitPrice: undefined };
  assert.deepEqual(calculateInvoiceLineFinancials(taxable, 13, 2), {
    subtotal: 10.01,
    taxAmount: 1.3,
    total: 11.31,
  });

  const normalized = normalizeInvoiceFinancials({
    schemaVersion: 2,
    taxRate: 13,
    lineItems: [taxable, nonTaxable],
  });
  assert.deepEqual(
    { subtotal: normalized.subtotal, taxAmount: normalized.taxAmount, amount: normalized.amount },
    { subtotal: 15.57, taxAmount: 1.3, amount: 16.87 }
  );
  assert.deepEqual(
    { subtotal: normalized.lineItems[0].subtotal, taxAmount: normalized.lineItems[0].taxAmount, total: normalized.lineItems[0].total },
    { subtotal: 10.01, taxAmount: 1.3, total: 11.31 }
  );
});

test('job invoice position excludes draft and void invoices from billed amount', () => {
  const job = { id: 'job-1', currentContractRevenue: 1000, originalContractRevenue: 900, contractValue: 800 };
  const position = calculateJobInvoicePosition(job, [
    { jobId: 'job-1', status: 'draft', subtotal: 100, amount: 113 },
    { jobId: 'job-1', status: 'sent', subtotal: 200, amount: 226 },
    { jobId: 'job-1', status: 'void', subtotal: 300, amount: 339 },
  ]);
  assert.deepEqual(position, {
    contractAmount: 1000,
    previouslyInvoiced: 200,
    draftAmount: 100,
    remainingAmount: 800,
  });
});

test('billing address never falls back to the job site address', () => {
  const customer = { address: { street: '10 Billing St', city: 'Ottawa', province: 'ON', postalCode: 'K1A 0B1', country: 'CA' } };
  const job = { propertyAddressSnapshot: '99 Job Site Rd, Ottawa, ON' };
  assert.equal(getCustomerBillingAddressSnapshot(customer), '10 Billing St, Ottawa, ON, K1A 0B1, CA');
  assert.notEqual(getCustomerBillingAddressSnapshot(customer), job.propertyAddressSnapshot);
  assert.equal(getCustomerBillingAddressSnapshot({}), '');
});

test('invoice revenue excludes HST and preserves legacy fallbacks', () => {
  assert.equal(getInvoiceRevenueAmount({ schemaVersion: 2, subtotal: 100, taxAmount: 13, amount: 113 }), 100);
  assert.equal(getInvoiceRevenueAmount({ amount: 113, taxAmount: 13 }), 100);
  assert.equal(getInvoiceRevenueAmount({ amount: 113, taxRate: 13, lineItems: [line()] }), 100);
  assert.equal(getInvoiceRevenueAmount({ amount: 75 }), 75);
});

test('invoice validation accepts Contract Services without changing resource categories', () => {
  assert.equal(validateInvoiceLineItems([line({ category: 'contract_service' })], 13), null);
  assert.equal(validateInvoiceLineItems([line({ category: 'unknown' })], 13), 'Invoice line item category is invalid.');
});