const text = (value) => String(value ?? '').trim();
export const invoiceMoney = (value) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) || 0);
export const invoiceDate = (value) => {
  const parsed = new Date(`${text(value).slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

export function buildInvoicePresentation(snapshot) {
  const invoice = snapshot?.invoice ?? {};
  const company = snapshot?.company ?? {};
  const amountPaid = Number(invoice.amountPaid) || 0;
  const total = Number(invoice.total) || 0;
  return {
    source: snapshot,
    company: { name: text(company.name) || 'Contractor', logoDataUrl: text(company.logoDataUrl), details: [company.address, [company.phone, company.email].map(text).filter(Boolean).join(' | '), company.website].map(text).filter(Boolean) },
    document: { label: 'Invoice', number: text(invoice.number), title: text(invoice.jobTitle) || text(invoice.description) },
    information: [
      { key: 'customer', label: 'Bill to', value: text(invoice.customerName) || 'Customer', details: [invoice.billingAddress].map(text).filter(Boolean) },
      { key: 'project', label: 'Project', value: text(invoice.jobTitle), details: [invoice.jobAddress].map(text).filter(Boolean) },
      { key: 'issued', label: 'Issue date', value: invoiceDate(invoice.issueDate), details: [] },
      { key: 'due', label: 'Due date', value: invoiceDate(invoice.dueDate), details: [] },
    ],
    description: text(invoice.description),
    lines: (Array.isArray(invoice.lineItems) ? invoice.lineItems : []).map((line, index) => ({ ...line, key: `${index}-${text(line.description)}`, description: text(line.description), displaySubtotal: invoiceMoney(line.subtotal), displayTax: invoiceMoney(line.taxAmount), displayTotal: invoiceMoney(line.total) })),
    totals: { subtotal: Number(invoice.subtotal) || 0, tax: Number(invoice.taxAmount) || 0, total, amountPaid, balance: Math.max(0, Number(invoice.balanceDue ?? total - amountPaid)), displaySubtotal: invoiceMoney(invoice.subtotal), displayTax: invoiceMoney(invoice.taxAmount), displayTotal: invoiceMoney(total), displayAmountPaid: invoiceMoney(amountPaid), displayBalance: invoiceMoney(invoice.balanceDue ?? total - amountPaid) },
    status: text(invoice.status) || 'sent',
    notes: text(invoice.notes),
    paymentMethods: (Array.isArray(snapshot?.paymentMethods) ? snapshot.paymentMethods : []).filter((method) => method && text(method.displayName)).map((method) => ({ type: method.type, displayName: text(method.displayName), instructions: text(method.instructions) })),
    paymentInstructions: text(snapshot?.paymentInstructions),
  };
}