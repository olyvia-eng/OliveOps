import type { InvoiceLineItem } from '../types';

export const INVOICE_LINE_CATEGORIES: readonly InvoiceLineItem['category'][];

export interface InvoiceSummary {
  subtotal: number;
  taxAmount: number;
  amount: number;
}

export function roundCurrency(value: number): number;
export function calculateInvoiceLineAmount(lineItem: Pick<InvoiceLineItem, 'quantity' | 'unitPrice'>): number;
export function calculateIncludedTax(grossAmount: number, taxRate: number): number;
export function calculateInvoiceSummary(lineItems: InvoiceLineItem[], taxRate?: number): InvoiceSummary;
export function normalizeInvoiceFinancials<T extends { lineItems?: InvoiceLineItem[]; taxRate?: number }>(invoice: T): T & InvoiceSummary;
export function validateInvoiceLineItems(lineItems: InvoiceLineItem[] | unknown, taxRate?: number): string | null;