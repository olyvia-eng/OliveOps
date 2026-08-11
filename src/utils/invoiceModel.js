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

export function calculateIncludedTax(grossAmount, taxRate) {
  const gross = roundCurrency(Number(grossAmount));
  const rate = Number(taxRate);
  if (!Number.isFinite(gross) || !Number.isFinite(rate) || gross <= 0 || rate <= 0) return 0;
  return roundCurrency(gross - (gross / (1 + (rate / 100))));
}

export function calculateInvoiceSummary(lineItems, taxRate = 0) {
  const rate = Number(taxRate);
  const summary = (Array.isArray(lineItems) ? lineItems : []).reduce((totals, lineItem) => {
    const amount = calculateInvoiceLineAmount(lineItem);
    const includedTax = lineItem?.taxable ? calculateIncludedTax(amount, rate) : 0;
    return {
      amount: roundCurrency(totals.amount + amount),
      subtotal: roundCurrency(totals.subtotal + amount - includedTax),
      taxAmount: roundCurrency(totals.taxAmount + includedTax),
    };
  }, { subtotal: 0, taxAmount: 0, amount: 0 });

  return summary;
}

export function normalizeInvoiceFinancials(invoice) {
  if (!Array.isArray(invoice?.lineItems) || invoice.lineItems.length === 0) return { ...invoice };

  const lineItems = invoice.lineItems.map((lineItem) => ({
    ...lineItem,
    amount: calculateInvoiceLineAmount(lineItem),
  }));
  const summary = calculateInvoiceSummary(lineItems, invoice.taxRate);

  return {
    ...invoice,
    lineItems,
    taxRate: Number(invoice.taxRate) || 0,
    ...summary,
  };
}

export function validateInvoiceLineItems(lineItems, taxRate = 0) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return 'Invoice requires at least one line item.';

  for (const lineItem of lineItems) {
    if (!lineItem || typeof lineItem !== 'object') return 'Invoice line item is invalid.';
    if (typeof lineItem.id !== 'string' || !lineItem.id.trim()) return 'Invoice line item id is required.';
    if (!INVOICE_LINE_CATEGORY_SET.has(lineItem.category)) return 'Invoice line item category is invalid.';
    if (typeof lineItem.description !== 'string' || !lineItem.description.trim()) return 'Invoice line item description is required.';
    if (typeof lineItem.unit !== 'string' || !lineItem.unit.trim()) return 'Invoice line item unit is required.';
    if (!Number.isFinite(lineItem.quantity) || lineItem.quantity <= 0) return 'Invoice line item quantity must be greater than 0.';
    if (!Number.isFinite(lineItem.unitPrice) || lineItem.unitPrice < 0) return 'Invoice line item unit price cannot be negative.';
    if (typeof lineItem.taxable !== 'boolean') return 'Invoice line item taxable value is required.';

    const amount = calculateInvoiceLineAmount(lineItem);
    if (!Number.isFinite(amount) || amount <= 0) return 'Invoice line item amount must be greater than 0.';
    if (lineItem.amount !== undefined && (!Number.isFinite(lineItem.amount) || roundCurrency(lineItem.amount) !== amount)) {
      return 'Invoice line item amount does not match quantity and unit price.';
    }
  }

  if (lineItems.some((lineItem) => lineItem.taxable) && (!Number.isFinite(taxRate) || taxRate <= 0 || taxRate > 100)) {
    return 'A valid tax rate is required for taxable invoice lines.';
  }

  return null;
}