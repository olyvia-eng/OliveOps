import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContractBillingSchedule, buildContractInvoiceLines, configureContractInvoice, paymentScheduleItemState } from '../src/utils/contractBillingModel.js';

const snapshot = (overrides = {}) => ({
  id: 'version-1',
  versionNumber: 2,
  proposal: { subtotal: 5551.96, taxRate: 13, taxAmount: 721.75, total: 6273.71, ...overrides },
  paymentSchedule: [
    { id: 'deposit', label: 'Initial Deposit', type: 'percentage', percentage: 50, amount: 3136.86, due: 'Before project start', sortOrder: 0 },
    { id: 'final', label: 'Final Payment', type: 'percentage', percentage: 50, amount: 3136.85, due: 'On project completion', sortOrder: 1 },
  ],
});

test('fully taxable 50 percent deposit and final reconcile tax and rounding', () => {
  const schedule = buildContractBillingSchedule(snapshot());
  assert.deepEqual(schedule.items.map((item) => ({ subtotal: item.subtotal, tax: item.taxAmount, total: item.total })), [
    { subtotal: 2775.98, tax: 360.88, total: 3136.86 },
    { subtotal: 2775.98, tax: 360.87, total: 3136.85 },
  ]);
  assert.equal(schedule.items[0].invoiceType, 'deposit');
  assert.equal(schedule.items[1].invoiceType, 'final');
});

test('mixed taxable contract preserves proportional taxable and non-taxable amounts', () => {
  const mixedSnapshot = snapshot({ subtotal: 1000, taxableSubtotal: 600, taxAmount: 78, total: 1078 });
  mixedSnapshot.paymentSchedule[0].amount = 539;
  mixedSnapshot.paymentSchedule[1].amount = 539;
  const schedule = buildContractBillingSchedule(mixedSnapshot);
  assert.deepEqual(schedule.items.map((item) => ({ taxable: item.taxableSubtotal, nonTaxable: item.nonTaxableSubtotal, tax: item.taxAmount })), [
    { taxable: 300, nonTaxable: 200, tax: 39 },
    { taxable: 300, nonTaxable: 200, tax: 39 },
  ]);
  assert.deepEqual(buildContractInvoiceLines(schedule.items[0], 'Initial Deposit').map((line) => ({ taxable: line.taxable, price: line.unitPriceBeforeTax, tax: line.taxAmountOverride })), [
    { taxable: true, price: 300, tax: 39 },
    { taxable: false, price: 200, tax: undefined },
  ]);
});

test('schedule state is derived from linked invoices and ignores void invoices', () => {
  const invoices = [
    { id: 'other-job', jobId: 'job-2', paymentScheduleItemId: 'deposit', status: 'sent', updatedAt: '2026-01-03' },
    { id: 'voided', jobId: 'job-1', paymentScheduleItemId: 'deposit', status: 'void', updatedAt: '2026-01-02' },
    { id: 'draft', jobId: 'job-1', paymentScheduleItemId: 'deposit', status: 'draft', updatedAt: '2026-01-01' },
  ];
  assert.equal(paymentScheduleItemState('deposit', invoices, 'job-1').status, 'draft');
  assert.equal(paymentScheduleItemState('final', invoices, 'job-1').status, 'not_invoiced');
});

test('schedule item creates a canonical draft and prevents a duplicate', () => {
  const contractBillingSchedule = buildContractBillingSchedule(snapshot());
  const job = { id: 'job-1', currentContractRevenue: 5551.96, contractBillingSchedule };
  const record = { id: 'invoice-1', schemaVersion: 2, invoiceType: 'progress', paymentScheduleItemId: 'deposit', taxRate: 99, lineItems: [{ description: '50% Initial Deposit - Flagstone Patio' }] };
  const configured = configureContractInvoice({ job, record, invoices: [], idFactory: () => 'generated-line' });
  assert.equal(configured.ok, true);
  assert.equal(configured.record.invoiceType, 'deposit');
  assert.equal(configured.record.taxRate, 13);
  assert.equal(configured.record.subtotal, 2775.98);
  assert.equal(configured.record.taxAmount, 360.88);
  assert.equal(configured.record.amount, 3136.86);
  assert.equal(configured.record.lineItems[0].description, '50% Initial Deposit - Flagstone Patio');

  const duplicate = configureContractInvoice({ job, record: { ...record, id: 'invoice-2' }, invoices: [{ ...configured.record, id: 'invoice-1', status: 'draft' }], idFactory: () => 'line-2' });
  assert.deepEqual(duplicate, { ok: false, error: 'This payment schedule item already has an invoice.', invoiceId: 'invoice-1' });
});

test('final invoice uses remaining issued contract balance including tax rounding', () => {
  const contractBillingSchedule = buildContractBillingSchedule(snapshot());
  const job = { id: 'job-1', currentContractRevenue: 5551.96, contractBillingSchedule };
  const issuedDeposit = { id: 'invoice-1', jobId: 'job-1', status: 'sent', paymentScheduleItemId: 'deposit', schemaVersion: 2, subtotal: 2775.98, taxAmount: 360.88, amount: 3136.86, lineItems: [{ taxable: true, quantity: 1, unitPriceBeforeTax: 2775.98, subtotal: 2775.98 }] };
  const configured = configureContractInvoice({ job, record: { id: 'invoice-2', schemaVersion: 2, invoiceType: 'final', paymentScheduleItemId: 'final', lineItems: [{ description: 'Final Payment' }] }, invoices: [issuedDeposit], idFactory: () => 'final-line' });
  assert.equal(configured.ok, true);
  assert.deepEqual({ subtotal: configured.record.subtotal, tax: configured.record.taxAmount, total: configured.record.amount }, { subtotal: 2775.98, tax: 360.87, total: 3136.85 });
});

test('custom invoice keeps manual lines and discards contract-only tax controls', () => {
  const manualLine = { id: 'manual', category: 'material', description: 'Extra stone', quantity: 2, unit: 'tonne', unitPrice: 100, unitPriceBeforeTax: 100, amount: 226, taxable: true, contractBilling: true, taxAmountOverride: 1 };
  const configured = configureContractInvoice({ job: { id: 'job-1' }, record: { schemaVersion: 2, invoiceType: 'custom', taxRate: 13, lineItems: [manualLine] }, invoices: [], idFactory: () => 'unused' });
  assert.equal(configured.ok, true);
  assert.equal(configured.record.lineItems[0].quantity, 2);
  assert.equal(configured.record.lineItems[0].taxAmount, 26);
  assert.equal(configured.record.lineItems[0].contractBilling, undefined);
  assert.equal(configured.record.lineItems[0].taxAmountOverride, undefined);
});

test('legacy Job contract invoices inherit sold tax without changing historical invoices', () => {
  const record = { schemaVersion: 2, invoiceType: 'deposit', taxRate: 5, lineItems: [{ id: 'line', category: 'contract_service', description: 'Deposit', quantity: 1, unit: 'job', unitPriceBeforeTax: 100, unitPrice: 100, amount: 105, taxable: false }] };
  const configured = configureContractInvoice({ job: { id: 'legacy-job', originalEstimateSnapshot: { taxRate: 13 } }, record, invoices: [], idFactory: () => 'unused' });
  assert.equal(configured.ok, true);
  assert.equal(configured.record.taxRate, 13);
  assert.equal(configured.record.lineItems[0].taxable, true);
  assert.equal(configured.record.amount, 113);
  assert.equal(configureContractInvoice({ job: {}, record: { amount: 75 }, invoices: [], idFactory: () => 'unused' }).record.amount, 75);
});