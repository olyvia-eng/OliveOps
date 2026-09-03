import { createHash } from 'node:crypto';
import { calculateInvoiceLineFinancials, validateInvoiceLineItems } from '../../src/utils/invoiceModel.js';

const CATEGORY_SET = new Set(['contract_service', 'material', 'equipment', 'labour', 'subcontractor']);

export function buildQuickBooksConfigurationSelection({ requestedMappings, taxableTaxCodeId, nonTaxableTaxCodeId, items, taxCodes }) {
  if (!requestedMappings || typeof requestedMappings !== 'object') throw new Error('Category mappings are required.');
  const itemById = new Map(items.map((item) => [item.id, item]));
  const taxCodeById = new Map(taxCodes.map((taxCode) => [taxCode.id, taxCode]));
  const categoryMappings = {};
  for (const category of CATEGORY_SET) {
    const itemId = requestedMappings[category];
    if (!itemId) continue;
    const item = itemById.get(String(itemId));
    if (!item?.active) throw new Error(`Selected ${category} Product/Service is unavailable.`);
    categoryMappings[category] = item;
  }
  const taxableTaxCode = taxableTaxCodeId ? taxCodeById.get(String(taxableTaxCodeId)) : undefined;
  if (taxableTaxCodeId && (!taxableTaxCode?.active || !taxableTaxCode.taxable)) throw new Error('Select an active taxable QuickBooks tax code.');
  const nonTaxableTaxCode = nonTaxableTaxCodeId ? taxCodeById.get(String(nonTaxableTaxCodeId)) : undefined;
  if (nonTaxableTaxCodeId && (!nonTaxableTaxCode?.active || nonTaxableTaxCode.taxable)) throw new Error('Select an active non-taxable QuickBooks tax code.');
  return {
    categoryMappings,
    ...(taxableTaxCode ? { taxableTaxCode } : {}),
    ...(nonTaxableTaxCode ? { nonTaxableTaxCode } : {}),
  };
}

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
  const lineError = validateInvoiceLineItems(invoice.lineItems, invoice.taxRate, invoice.schemaVersion);
  if (lineError) throw new Error(lineError);
  if (!customerMapping?.quickBooksCustomerId) throw new Error('Map the OliveOps customer to QuickBooks first.');
  const categoryMappings = configuration?.categoryMappings ?? {};
  const nonTaxableTaxCode = configuration?.nonTaxableTaxCode;
  const taxableTaxCode = configuration?.taxableTaxCode;
  const lines = invoice.lineItems.map((lineItem) => {
    if (!CATEGORY_SET.has(lineItem.category)) throw new Error('Invoice line category is invalid.');
    const item = categoryMappings[lineItem.category];
    const categoryLabel = lineItem.category === 'contract_service' ? 'Contract Services' : lineItem.category;
    if (!item?.id) {
      if (lineItem.category === 'contract_service') throw new Error('Map Contract Services to a QuickBooks Product/Service before syncing this invoice.');
      throw new Error(`Map the ${categoryLabel} category to a QuickBooks Product/Service first.`);
    }
    const taxCode = lineItem.taxable ? taxableTaxCode : nonTaxableTaxCode;
    if (!taxCode?.id) throw new Error(`Configure a QuickBooks ${lineItem.taxable ? 'taxable' : 'non-taxable'} tax code first.`);
    const financials = calculateInvoiceLineFinancials(lineItem, invoice.taxRate, invoice.schemaVersion);
    const unitPrice = invoice.schemaVersion === 2 ? lineItem.unitPriceBeforeTax : lineItem.unitPrice;
    return {
      Amount: invoice.schemaVersion === 2 ? financials.subtotal : financials.total,
      Description: lineItem.description,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: item.id, name: item.name },
        Qty: lineItem.quantity,
        UnitPrice: unitPrice,
        TaxCodeRef: { value: taxCode.id },
      },
    };
  });

  if (invoice.lineItems.some((lineItem) => lineItem.taxable)) {
    const quickBooksTaxRate = Number(taxableTaxCode?.rate);
    if (!Number.isFinite(quickBooksTaxRate)) {
      throw new Error('QuickBooks did not provide a verifiable rate for the selected taxable Sales Tax Code. Update the QuickBooks mapping before syncing; the OliveOps invoice was not changed.');
    }
    const oliveOpsTaxRate = Number(invoice.taxRate);
    const taxTotals = invoice.lineItems.reduce((totals, lineItem) => {
      if (!lineItem.taxable) return totals;
      const financials = calculateInvoiceLineFinancials(lineItem, oliveOpsTaxRate, invoice.schemaVersion);
      return {
        oliveOps: totals.oliveOps + financials.taxAmount,
        quickBooks: totals.quickBooks + Math.round((financials.subtotal * (quickBooksTaxRate / 100) + Number.EPSILON) * 100) / 100,
      };
    }, { oliveOps: 0, quickBooks: 0 });
    const projectedDifference = Math.abs(taxTotals.quickBooks - taxTotals.oliveOps);
    if (projectedDifference >= 0.01) {
      throw new Error(`QuickBooks taxable Sales Tax Code rate (${quickBooksTaxRate}%) does not match the OliveOps invoice tax rate (${oliveOpsTaxRate}%). Update the QuickBooks mapping before syncing; the OliveOps invoice was not changed.`);
    }
  }

  return {
    CustomerRef: { value: customerMapping.quickBooksCustomerId },
    DocNumber: invoice.number,
    TxnDate: invoice.issueDate,
    DueDate: invoice.dueDate,
    PrivateNote: invoice.notes || undefined,
    GlobalTaxCalculation: invoice.schemaVersion === 2 ? 'TaxExcluded' : 'TaxInclusive',
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