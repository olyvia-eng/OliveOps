import { createHash } from 'node:crypto';
import { calculateInvoiceLineAmount, validateInvoiceLineItems } from '../../src/utils/invoiceModel.js';

const CATEGORY_SET = new Set(['material', 'equipment', 'labour', 'subcontractor']);

export function quickBooksRequestId(type, businessId, realmId, entityId) {
  return createHash('sha256').update(`${type}:${businessId}:${realmId}:${entityId}`).digest('hex').slice(0, 48);
}

export function hashInvoiceSource(invoice) {
  const source = {
    id: invoice.id,
    customerId: invoice.customerId,
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    taxRate: invoice.taxRate,
    lineItems: invoice.lineItems,
  };
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

export function buildQuickBooksCustomerPayload(customer) {
  const displayName = (customer.company || customer.name || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`).trim();
  if (!displayName) throw new Error('Customer name is required for QuickBooks.');
  const address = customer.address ?? customer.properties?.[0];
  return {
    DisplayName: displayName,
    ...(customer.company ? { CompanyName: customer.company } : {}),
    ...(customer.firstName ? { GivenName: customer.firstName } : {}),
    ...(customer.lastName ? { FamilyName: customer.lastName } : {}),
    ...(customer.email ? { PrimaryEmailAddr: { Address: customer.email } } : {}),
    ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}),
    ...(address ? {
      BillAddr: {
        Line1: address.street,
        City: address.city,
        CountrySubDivisionCode: address.province,
        PostalCode: address.postalCode,
        Country: address.country,
      },
    } : {}),
  };
}

export function buildQuickBooksInvoicePayload({ invoice, customerMapping, configuration }) {
  const lineError = validateInvoiceLineItems(invoice.lineItems, invoice.taxRate);
  if (lineError) throw new Error(lineError);
  if (!customerMapping?.quickBooksCustomerId) throw new Error('Map the OliveOps customer to QuickBooks first.');
  const categoryMappings = configuration?.categoryMappings ?? {};
  const nonTaxableTaxCode = configuration?.nonTaxableTaxCode;
  const taxableTaxCode = configuration?.taxableTaxCode;
  const lines = invoice.lineItems.map((lineItem) => {
    if (!CATEGORY_SET.has(lineItem.category)) throw new Error('Invoice line category is invalid.');
    const item = categoryMappings[lineItem.category];
    if (!item?.id) throw new Error(`Map the ${lineItem.category} category to a QuickBooks Product/Service first.`);
    const taxCode = lineItem.taxable ? taxableTaxCode : nonTaxableTaxCode;
    if (!taxCode?.id) throw new Error(`Configure a QuickBooks ${lineItem.taxable ? 'taxable' : 'non-taxable'} tax code first.`);
    return {
      Amount: calculateInvoiceLineAmount(lineItem),
      Description: lineItem.description,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: item.id, name: item.name },
        Qty: lineItem.quantity,
        UnitPrice: lineItem.unitPrice,
        TaxCodeRef: { value: taxCode.id },
      },
    };
  });

  return {
    CustomerRef: { value: customerMapping.quickBooksCustomerId },
    DocNumber: invoice.number,
    TxnDate: invoice.issueDate,
    DueDate: invoice.dueDate,
    PrivateNote: invoice.notes || undefined,
    GlobalTaxCalculation: 'TaxInclusive',
    CurrencyRef: { value: 'CAD' },
    Line: lines,
  };
}

export function normalizeQuickBooksInvoiceStatus(quickBooksInvoice, now = new Date()) {
  const balance = Number(quickBooksInvoice?.Balance ?? 0);
  const dueDate = quickBooksInvoice?.DueDate ?? '';
  let status = 'open';
  if (balance <= 0) status = 'paid';
  else if (dueDate && dueDate < now.toISOString().slice(0, 10)) status = 'overdue';
  return {
    status,
    balance,
    total: Number(quickBooksInvoice?.TotalAmt ?? 0),
    documentNumber: quickBooksInvoice?.DocNumber ?? '',
    syncToken: quickBooksInvoice?.SyncToken ?? '',
  };
}