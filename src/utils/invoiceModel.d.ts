import type { InvoiceLineItem } from '../types';

export const INVOICE_LINE_CATEGORIES: readonly InvoiceLineItem['category'][];

export interface InvoiceSummary {
  subtotal: number;
  taxAmount: number;
  amount: number;
}

export interface InvoiceLineFinancials {
  subtotal: number;
  taxAmount: number;
  total: number;
}

export function roundCurrency(value: number): number;
export function calculateInvoiceLineAmount(lineItem: Pick<InvoiceLineItem, 'quantity' | 'unitPrice'>): number;
export function calculateInvoiceLineFinancials(lineItem: InvoiceLineItem, taxRate?: number, schemaVersion?: 2): InvoiceLineFinancials;
export function calculateIncludedTax(grossAmount: number, taxRate: number): number;
export function calculateInvoiceSummary(lineItems: InvoiceLineItem[], taxRate?: number, schemaVersion?: 2): InvoiceSummary;
export function normalizeInvoiceFinancials<T extends { lineItems?: InvoiceLineItem[]; taxRate?: number }>(invoice: T): T & InvoiceSummary;
export function validateInvoiceLineItems(lineItems: InvoiceLineItem[] | unknown, taxRate?: number, schemaVersion?: 2): string | null;
export function getAuthoritativeContractValue(job: import('../types').Job | undefined): number;
export function isIssuedInvoice(invoice: Partial<import('../types').Invoice>): boolean;
export function getInvoiceContractAmount(invoice: Partial<import('../types').Invoice>): number;
export function getInvoiceRevenueAmount(invoice: Partial<import('../types').Invoice>): number;
export function getCustomerBillingAddressSnapshot(customer: Partial<import('../types').Customer> & { billingAddress?: import('../types').Address | string; mailingAddress?: import('../types').Address | string } | undefined): string;
export function calculateJobInvoicePosition(job: import('../types').Job | undefined, invoices: import('../types').Invoice[]): {
  contractAmount: number;
  previouslyInvoiced: number;
  draftAmount: number;
  remainingAmount: number;
};
export function getInvoiceBalance(invoice: Partial<import('../types').Invoice>): number;
export function isValidInvoiceStatusTransition(fromStatus: import('../types').InvoiceStatus, toStatus: import('../types').InvoiceStatus, context?: 'generic' | 'payment'): boolean;