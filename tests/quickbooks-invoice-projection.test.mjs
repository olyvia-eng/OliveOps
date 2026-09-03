import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuickBooksConfigurationSelection,
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
  taxableTaxCode: { id: 'tax-hst', name: 'HST', taxable: true, rate: 13 },
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

test('partial configuration saves valid Product/Service mappings without tax codes', () => {
  const taxCodes = [
    { ...configuration.taxableTaxCode, active: true },
    { id: 'NON-1', name: 'Zero rated', taxable: false, active: true, rate: 0 },
    { id: 'NON-2', name: 'Exempt', taxable: false, active: true, rate: 0 },
  ];
  const partial = buildQuickBooksConfigurationSelection({
    requestedMappings: { labour: 'item-1', material: '' }, taxableTaxCodeId: '', nonTaxableTaxCodeId: '',
    items: [{ ...configuration.categoryMappings.labour, active: true }], taxCodes,
  });
  assert.equal(partial.categoryMappings.labour.id, 'item-1');
  assert.equal(partial.categoryMappings.material, undefined);
  assert.equal(partial.taxableTaxCode, undefined);
  assert.equal(partial.nonTaxableTaxCode, undefined);
  const selected = buildQuickBooksConfigurationSelection({
    requestedMappings: {}, taxableTaxCodeId: '', nonTaxableTaxCodeId: 'NON-2', items: [], taxCodes,
  });
  assert.equal(selected.nonTaxableTaxCode.id, 'NON-2');
});

test('taxable-only invoices do not require a non-taxable tax code', () => {
  const taxableInvoice = { ...invoice, lineItems: [invoice.lineItems[0]] };
  const payload = buildQuickBooksInvoicePayload({
    invoice: taxableInvoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration: { categoryMappings: { labour: configuration.categoryMappings.labour }, taxableTaxCode: configuration.taxableTaxCode },
  });
  assert.equal(payload.Line[0].SalesItemLineDetail.TaxCodeRef.value, 'tax-hst');
});

test('non-taxable invoice lines require the explicit non-taxable tax code', () => {
  const nonTaxableInvoice = { ...invoice, lineItems: [invoice.lineItems[1]] };
  assert.throws(() => buildQuickBooksInvoicePayload({
    invoice: nonTaxableInvoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration: { categoryMappings: { material: configuration.categoryMappings.material } },
  }), /Configure a QuickBooks non-taxable tax code first/);
});

test('invoice projection requires only category mappings used by that invoice', () => {
  const taxableInvoice = { ...invoice, lineItems: [invoice.lineItems[0]] };
  const payload = buildQuickBooksInvoicePayload({
    invoice: taxableInvoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration: { categoryMappings: { labour: configuration.categoryMappings.labour }, taxableTaxCode: configuration.taxableTaxCode },
  });
  assert.equal(payload.Line.length, 1);
  assert.throws(() => buildQuickBooksInvoicePayload({
    invoice: taxableInvoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration: { categoryMappings: {}, taxableTaxCode: configuration.taxableTaxCode },
  }), /Map the labour category/);
});

test('existing mapping IDs remain compatible when provider resources are refreshed', () => {
  const selected = buildQuickBooksConfigurationSelection({
    requestedMappings: { labour: 'item-1' },
    taxableTaxCodeId: 'tax-hst',
    nonTaxableTaxCodeId: 'NON',
    items: [{ ...configuration.categoryMappings.labour, active: true, type: 'Service' }],
    taxCodes: [
      { ...configuration.taxableTaxCode, active: true },
      { ...configuration.nonTaxableTaxCode, active: true },
    ],
  });
  assert.equal(selected.categoryMappings.labour.id, 'item-1');
  assert.equal(selected.taxableTaxCode.rate, 13);
});

test('tax rate mismatch fails before a QuickBooks invoice can be projected', () => {
  assert.throws(() => buildQuickBooksInvoicePayload({
    invoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration: { ...configuration, taxableTaxCode: { ...configuration.taxableTaxCode, rate: 7.25 } },
  }), /does not match the OliveOps invoice tax rate.*invoice was not changed/);
  assert.throws(() => buildQuickBooksInvoicePayload({
    invoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration: { ...configuration, taxableTaxCode: { ...configuration.taxableTaxCode, rate: undefined } },
  }), /did not provide a verifiable rate.*invoice was not changed/);
});

test('QuickBooks request IDs and invoice source hashes are deterministic', () => {
  assert.equal(
    quickBooksRequestId('invoice', 'business-1', 'realm-1', 'invoice-1'),
    quickBooksRequestId('invoice', 'business-1', 'realm-1', 'invoice-1')
  );
  assert.notEqual(hashInvoiceSource(invoice), hashInvoiceSource({ ...invoice, notes: 'Changed' }));
  assert.notEqual(hashInvoiceSource(invoice), hashInvoiceSource({ ...invoice, lineItems: invoice.lineItems.map((line, index) => index === 0 ? { ...line, category: 'contract_service' } : line) }));
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

test('Contract Services requires its own QuickBooks Product/Service mapping', () => {
  const contractInvoice = {
    ...invoice,
    lineItems: [{ ...invoice.lineItems[0], category: 'contract_service', description: 'Contract deposit' }],
  };
  assert.throws(
    () => buildQuickBooksInvoicePayload({ invoice: contractInvoice, customerMapping: { quickBooksCustomerId: 'qbo-customer-1' }, configuration }),
    /Map Contract Services to a QuickBooks Product\/Service before syncing this invoice\./
  );
  const payload = buildQuickBooksInvoicePayload({
    invoice: contractInvoice,
    customerMapping: { quickBooksCustomerId: 'qbo-customer-1' },
    configuration: { ...configuration, categoryMappings: { ...configuration.categoryMappings, contract_service: { id: 'item-contract', name: 'Contract Services' } } },
  });
  assert.equal(payload.Line[0].SalesItemLineDetail.ItemRef.value, 'item-contract');
});