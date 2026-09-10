import type { InvoiceCustomerDocumentSnapshot } from '../types';

export interface InvoicePresentation {
  source: InvoiceCustomerDocumentSnapshot;
  company: { name: string; logoDataUrl: string; details: string[] };
  document: { label: string; number: string; title: string };
  information: Array<{ key: string; label: string; value: string; details: string[] }>;
  description: string;
  lines: Array<{ key: string; description: string; quantity: number; unit: string; displaySubtotal: string; displayTax: string; displayTotal: string }>;
  totals: { subtotal: number; tax: number; total: number; amountPaid: number; balance: number; displaySubtotal: string; displayTax: string; displayTotal: string; displayAmountPaid: string; displayBalance: string };
  status: string;
  notes: string;
  paymentMethods: Array<{ type: string; displayName: string; instructions: string }>;
  paymentInstructions: string;
}

export function invoiceMoney(value: number): string;
export function invoiceDate(value: string): string;
export function buildInvoicePresentation(snapshot: InvoiceCustomerDocumentSnapshot): InvoicePresentation;