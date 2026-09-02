export const INVOICE_LINE_CATEGORIES = Object.freeze([
  'material',
  'equipment',
  'labour',
  'subcontractor',
]);

const INVOICE_LINE_CATEGORY_SET = new Set(INVOICE_LINE_CATEGORIES);

export function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateInvoiceLineAmount(lineItem) {
  return roundCurrency(Number(lineItem?.quantity) * Number(lineItem?.unitPrice));
}

export function calculateInvoiceLineFinancials(lineItem, taxRate = 0, schemaVersion) {
  if (schemaVersion !== 2) {
    const total = calculateInvoiceLineAmount(lineItem);
    const taxAmount = lineItem?.taxable ? calculateIncludedTax(total, taxRate) : 0;
    return { subtotal: roundCurrency(total - taxAmount), taxAmount, total };
  }

  const subtotal = roundCurrency(Number(lineItem?.quantity) * Number(lineItem?.unitPriceBeforeTax));
  const taxAmount = lineItem?.taxable
    ? roundCurrency(subtotal * (Number(taxRate) / 100))
    : 0;
  return { subtotal, taxAmount, total: roundCurrency(subtotal + taxAmount) };
}

export function calculateIncludedTax(grossAmount, taxRate) {
  const gross = roundCurrency(Number(grossAmount));
  const rate = Number(taxRate);
  if (!Number.isFinite(gross) || !Number.isFinite(rate) || gross <= 0 || rate <= 0) return 0;
  return roundCurrency(gross - (gross / (1 + (rate / 100))));
}

export function calculateInvoiceSummary(lineItems, taxRate = 0, schemaVersion) {
  const summary = (Array.isArray(lineItems) ? lineItems : []).reduce((totals, lineItem) => {
    const line = calculateInvoiceLineFinancials(lineItem, taxRate, schemaVersion);
    return {
      amount: roundCurrency(totals.amount + line.total),
      subtotal: roundCurrency(totals.subtotal + line.subtotal),
      taxAmount: roundCurrency(totals.taxAmount + line.taxAmount),
    };
  }, { subtotal: 0, taxAmount: 0, amount: 0 });

  return summary;
}

export function normalizeInvoiceFinancials(invoice) {
  if (!Array.isArray(invoice?.lineItems) || invoice.lineItems.length === 0) return { ...invoice };

  const lineItems = invoice.lineItems.map((lineItem) => {
    const financials = calculateInvoiceLineFinancials(lineItem, invoice.taxRate, invoice.schemaVersion);
    if (invoice.schemaVersion === 2) {
      return {
        ...lineItem,
        unitPriceBeforeTax: Number(lineItem.unitPriceBeforeTax),
        subtotal: financials.subtotal,
        taxAmount: financials.taxAmount,
        total: financials.total,
        amount: financials.total,
      };
    }
    return { ...lineItem, amount: financials.total };
  });
  const summary = calculateInvoiceSummary(lineItems, invoice.taxRate, invoice.schemaVersion);

  return {
    ...invoice,
    lineItems,
    taxRate: Number(invoice.taxRate) || 0,
    ...summary,
  };
}

export function validateInvoiceLineItems(lineItems, taxRate = 0, schemaVersion) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return 'Invoice requires at least one line item.';

  for (const lineItem of lineItems) {
    if (!lineItem || typeof lineItem !== 'object') return 'Invoice line item is invalid.';
    if (typeof lineItem.id !== 'string' || !lineItem.id.trim()) return 'Invoice line item id is required.';
    if (!INVOICE_LINE_CATEGORY_SET.has(lineItem.category)) return 'Invoice line item category is invalid.';
    if (typeof lineItem.description !== 'string' || !lineItem.description.trim()) return 'Invoice line item description is required.';
    if (typeof lineItem.unit !== 'string' || !lineItem.unit.trim()) return 'Invoice line item unit is required.';
    if (!Number.isFinite(lineItem.quantity) || lineItem.quantity <= 0) return 'Invoice line item quantity must be greater than 0.';
    const unitPrice = schemaVersion === 2 ? lineItem.unitPriceBeforeTax : lineItem.unitPrice;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return 'Invoice line item unit price cannot be negative.';
    if (typeof lineItem.taxable !== 'boolean') return 'Invoice line item taxable value is required.';

    const financials = calculateInvoiceLineFinancials(lineItem, taxRate, schemaVersion);
    if (!Number.isFinite(financials.total) || financials.total <= 0) return 'Invoice line item amount must be greater than 0.';
    if (lineItem.amount !== undefined && (!Number.isFinite(lineItem.amount) || roundCurrency(lineItem.amount) !== financials.total)) {
      return 'Invoice line item amount does not match quantity and unit price.';
    }
  }

  if (lineItems.some((lineItem) => lineItem.taxable) && (!Number.isFinite(taxRate) || taxRate <= 0 || taxRate > 100)) {
    return 'A valid tax rate is required for taxable invoice lines.';
  }

  return null;
}

export function getAuthoritativeContractValue(job) {
  const candidates = [
    job?.currentContractRevenue,
    job?.originalContractRevenue,
    job?.contractValue,
    job?.originalEstimateSnapshot?.subtotal,
  ];
  const value = candidates.find((candidate) => Number.isFinite(candidate) && candidate >= 0);
  return roundCurrency(value ?? 0);
}

export function isIssuedInvoice(invoice) {
  return invoice?.status !== 'draft' && invoice?.status !== 'void';
}

export function getInvoiceContractAmount(invoice) {
  return getInvoiceRevenueAmount(invoice);
}

export function getInvoiceRevenueAmount(invoice) {
  if (Number.isFinite(invoice?.subtotal) && invoice.subtotal > 0) {
    return roundCurrency(invoice.subtotal);
  }
  if (Number.isFinite(invoice?.amount) && Number.isFinite(invoice?.taxAmount) && invoice.taxAmount >= 0) {
    return roundCurrency(Math.max(0, invoice.amount - invoice.taxAmount));
  }
  if (Array.isArray(invoice?.lineItems) && invoice.lineItems.length > 0) {
    const summary = calculateInvoiceSummary(invoice.lineItems, invoice.taxRate, invoice.schemaVersion);
    if (Number.isFinite(summary.subtotal) && summary.subtotal > 0) return summary.subtotal;
  }
  return roundCurrency(Number.isFinite(invoice?.amount) ? invoice.amount : 0);
}

export function getCustomerBillingAddressSnapshot(customer) {
  const address = customer?.billingAddress ?? customer?.mailingAddress ?? customer?.address;
  if (typeof address === 'string') return address.trim();
  if (!address || typeof address !== 'object') return '';
  return [address.street, address.city, address.province, address.postalCode, address.country]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim())
    .join(', ');
}

export function calculateJobInvoicePosition(job, invoices) {
  const contractAmount = getAuthoritativeContractValue(job);
  const relevant = (Array.isArray(invoices) ? invoices : []).filter((invoice) => invoice?.jobId === job?.id);
  const previouslyInvoiced = roundCurrency(relevant
    .filter(isIssuedInvoice)
    .reduce((sum, invoice) => sum + getInvoiceContractAmount(invoice), 0));
  const draftAmount = roundCurrency(relevant
    .filter((invoice) => invoice?.status === 'draft')
    .reduce((sum, invoice) => sum + getInvoiceContractAmount(invoice), 0));
  return {
    contractAmount,
    previouslyInvoiced,
    draftAmount,
    remainingAmount: roundCurrency(Math.max(0, contractAmount - previouslyInvoiced)),
  };
}

export function getInvoiceBalance(invoice) {
  if (invoice?.status === 'paid' || invoice?.status === 'void') return 0;
  return roundCurrency(invoice?.amount ?? 0);
}

const PHASE_ONE_STATUS_TRANSITIONS = Object.freeze({
  draft: new Set(['draft', 'sent']),
  sent: new Set(['sent', 'void']),
  partially_paid: new Set(['partially_paid']),
  overdue: new Set(['overdue', 'void']),
  paid: new Set(['paid']),
  void: new Set(['void']),
});

const PAYMENT_STATUS_TRANSITIONS = Object.freeze({
  sent: new Set(['partially_paid', 'paid']),
  partially_paid: new Set(['paid']),
  overdue: new Set(['partially_paid', 'paid']),
});

export function isValidInvoiceStatusTransition(fromStatus, toStatus, context = 'generic') {
  if (PHASE_ONE_STATUS_TRANSITIONS[fromStatus]?.has(toStatus)) return true;
  return context === 'payment' && (PAYMENT_STATUS_TRANSITIONS[fromStatus]?.has(toStatus) ?? false);
}