import type { Invoice, InvoiceLineItem, InvoiceStatus, InvoiceType } from '../types';

export interface ContractBillingScheduleItem {
  id: string;
  label: string;
  due: string;
  sortOrder: number;
  type: 'percentage' | 'fixed';
  percentage: number;
  invoiceType: Exclude<InvoiceType, 'custom'>;
  subtotal: number;
  taxableSubtotal: number;
  nonTaxableSubtotal: number;
  taxAmount: number;
  total: number;
}

export interface ContractBillingSchedule {
  schemaVersion: 1;
  proposalVersionId?: string;
  proposalVersionNumber?: number;
  contractSubtotal: number;
  taxableSubtotal: number;
  nonTaxableSubtotal: number;
  taxRate: number;
  taxAmount: number;
  contractTotal: number;
  items: ContractBillingScheduleItem[];
}

export function buildContractBillingSchedule(proposalSnapshot: unknown): ContractBillingSchedule;
export function buildContractInvoiceLines(scheduleItem: ContractBillingScheduleItem, description?: string): Array<Omit<InvoiceLineItem, 'id' | 'amount'> & { contractBilling: true; taxAmountOverride?: number }>;
export function remainingContractBillingItem(schedule: ContractBillingSchedule, scheduleItem: ContractBillingScheduleItem, invoices: Invoice[], jobId: string): ContractBillingScheduleItem;
export function paymentScheduleItemState(itemId: string, invoices: Invoice[], jobId?: string): { status: InvoiceStatus | 'not_invoiced'; invoice: Invoice | null };
export function configureContractInvoice(input: { job: { id: string; currentContractRevenue?: number; contractBillingSchedule?: ContractBillingSchedule }; record: Partial<Invoice> & { schemaVersion?: number; lineItems?: InvoiceLineItem[] }; invoices: Invoice[]; idFactory: () => string }): { ok: true; record: Partial<Invoice> } | { ok: false; error: string; invoiceId?: string };