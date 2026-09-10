import { enabledPaymentMethods } from '../../shared/customerDocuments.js';

export const INVOICE_SNAPSHOT_SCHEMA_VERSION = 1;

export async function buildInvoiceSnapshot({ businessId, invoice, business, getFileForBusiness, readStoredFile }) {
  const company = {
    name: business.legalName || business.name,
    phone: business.phone || '', email: business.email || '', website: business.website || '', address: business.businessAddress || '', logoDataUrl: '',
  };
  if (business.logoFileId) {
    const logo = await getFileForBusiness(businessId, business.logoFileId);
    if (logo?.uploadStatus === 'uploaded' && logo.entityType === 'business-profile' && ['image/png', 'image/jpeg'].includes(logo.mimeType)) {
      const bytes = await readStoredFile({ businessId, key: logo.objectKey ?? logo.key });
      company.logoDataUrl = `data:${logo.mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    }
  }
  const safeInvoice = {
    number: invoice.number, invoiceType: invoice.invoiceType, issueDate: invoice.issueDate, dueDate: invoice.dueDate,
    customerName: invoice.customerNameSnapshot || '', billingAddress: invoice.billingAddressSnapshot || '', jobTitle: invoice.jobTitleSnapshot || '', jobAddress: invoice.jobAddressSnapshot || '',
    description: invoice.lineItems?.[0]?.description || invoice.jobTitleSnapshot || '', lineItems: (invoice.lineItems ?? []).map(({ category, description, quantity, unit, taxable, subtotal, taxAmount, total, amount }) => ({ category, description, quantity, unit, taxable, subtotal, taxAmount, total: total ?? amount })),
    subtotal: invoice.subtotal, taxRate: invoice.taxRate, taxAmount: invoice.taxAmount, total: invoice.amount, amountPaid: invoice.amountPaid || 0, balanceDue: invoice.amount, notes: invoice.notes || '', status: 'sent',
  };
  return {
    schemaVersion: INVOICE_SNAPSHOT_SCHEMA_VERSION,
    company,
    invoice: safeInvoice,
    paymentMethods: enabledPaymentMethods(business).map((method) => ({ type: method.type, displayName: method.displayName, instructions: method.instructions })),
    paymentInstructions: business.paymentInstructions || '',
  };
}