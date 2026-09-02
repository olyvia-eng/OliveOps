import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuickBooksCustomerPayload,
  buildQuickBooksInvoicePayload,
  hashInvoiceSource,
  normalizeQuickBooksInvoiceStatus,
  quickBooksRequestId,
} from '../api/_lib/quickBooksSync.js';

const invoice = {
  id: 'invoice-1',
  customerId: 'customer-1',
  number: 'INV-1001',
  issueDate: '2026-08-11',
  dueDate: '2026-09-10',
  notes: 'Thank you',
  taxRate: 13,
  lineItems: [
    { id: 'line-1', category: 'labour', description: 'Installation', quantity: 2, unit: 'hr', unitPrice: 56.5, amount: 113, taxable: true },
    { id: 'line-2', category: 'material', description: 'Permit', quantity: 1, unit: 'each', unitPrice: 50, amount: 50, taxable: false },
  ],
};

const configuration = {
  categoryMappings: {
    labour: { id: 'item-1', name: 'Labour' },
    material: { id: 'item-2', name: 'Materials' },
  },
  taxableTaxCode: { id: 'tax-hst', name: 'HST', taxable: true },
  nonTaxableTaxCode: { id: 'NON', name: 'Non-taxable', taxable: false },
};

test('QuickBooks invoice projection uses explicit Item and per-line tax references', () => {
  const payload = buildQuickBooksInvoicePayload({
    invoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration,
  });
  assert.equal(payload.GlobalTaxCalculation, 'TaxInclusive');
  assert.equal(payload.CurrencyRef.value, 'CAD');
  assert.equal(payload.CustomerRef.value, 'qbo-customer-1');
  assert.deepEqual(payload.Line.map((line) => ({
    amount: line.Amount,
    item: line.SalesItemLineDetail.ItemRef.value,
    tax: line.SalesItemLineDetail.TaxCodeRef.value,
  })), [
    { amount: 113, item: 'item-1', tax: 'tax-hst' },
    { amount: 50, item: 'item-2', tax: 'NON' },
  ]);
});

test('QuickBooks invoice projection fails closed on missing mappings', () => {
  assert.throws(
    () => buildQuickBooksInvoicePayload({ invoice, customerMapping: null, configuration }),
    /Map the OliveOps customer/
  );
  assert.throws(
    () => buildQuickBooksInvoicePayload({
      invoice,
      customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
      configuration: { ...configuration, categoryMappings: { labour: configuration.categoryMappings.labour } },
    }),
    /Map the material category/
  );
});

test('QuickBooks request IDs and invoice source hashes are deterministic', () => {
  assert.equal(
    quickBooksRequestId('invoice', 'business-1', 'realm-1', 'invoice-1'),
    quickBooksRequestId('invoice', 'business-1', 'realm-1', 'invoice-1')
  );
  assert.notEqual(hashInvoiceSource(invoice), hashInvoiceSource({ ...invoice, notes: 'Changed' }));
});

test('QuickBooks invoice status is derived read-only from balance and due date', () => {
  assert.equal(normalizeQuickBooksInvoiceStatus({ Balance: 0, TotalAmt: 163 }).status, 'paid');
  assert.equal(normalizeQuickBooksInvoiceStatus({ Balance: 163, DueDate: '2026-08-01' }, new Date('2026-08-11')).status, 'overdue');
  assert.equal(normalizeQuickBooksInvoiceStatus({ Balance: 163, DueDate: '2026-09-01' }, new Date('2026-08-11')).status, 'open');
});

test('QuickBooks customer payload uses reviewed OliveOps identity and address fields', () => {
  const payload = buildQuickBooksCustomerPayload({
    name: 'Alex Owner', company: 'Olive Contracting', email: 'alex@example.com', phone: '555-0100',
    address: { street: '1 Main St', city: 'Ottawa', province: 'ON', postalCode: 'K1A 0B1', country: 'CA' },
  });
  assert.equal(payload.DisplayName, 'Olive Contracting');
  assert.equal(payload.PrimaryEmailAddr.Address, 'alex@example.com');
  assert.equal(payload.BillAddr.CountrySubDivisionCode, 'ON');
});

test('QuickBooks invoice projection sends schema version 2 prices as tax-exclusive', () => {
  const payload = buildQuickBooksInvoicePayload({
    invoice: {
      ...invoice,
      schemaVersion: 2,
      pricingMode: 'tax_exclusive',
      lineItems: invoice.lineItems.map((lineItem) => ({
        ...lineItem,
        unitPriceBeforeTax: lineItem.id === 'line-1' ? 50 : 50,
        subtotal: lineItem.id === 'line-1' ? 100 : 50,
        taxAmount: lineItem.id === 'line-1' ? 13 : 0,
        total: lineItem.id === 'line-1' ? 113 : 50,
      })),
    },
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration,
  });
  assert.equal(payload.GlobalTaxCalculation, 'TaxExcluded');
  assert.deepEqual(payload.Line.map((line) => ({ amount: line.Amount, unitPrice: line.SalesItemLineDetail.UnitPrice })), [
    { amount: 100, unitPrice: 50 },
    { amount: 50, unitPrice: 50 },
  ]);
});