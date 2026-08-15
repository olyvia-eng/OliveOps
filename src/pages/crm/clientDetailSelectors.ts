import type { Customer, Estimate, Invoice, Job } from '../../types';
import {
  computeEstimateSubtotal,
  computeEstimateTax,
  computeEstimateTotal,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';

export interface ClientDetailSummary {
  estimates: Estimate[];
  jobs: Job[];
  invoices: Invoice[];
  estimateValue: number;
  contractValue: number;
  invoiceValue: number;
  activeJobCount: number;
}

const newestFirst = <T extends { updatedAt: string }>(items: T[]): T[] => (
  [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
);

export function computeClientEstimateValue(estimate: Estimate): number {
  const subtotal = computeEstimateSubtotal(normalizeEstimateWorkAreas(estimate));
  return computeEstimateTotal(subtotal, computeEstimateTax(subtotal, estimate.taxRate));
}

export function selectClientDetailSummary(
  customerId: Customer['id'],
  estimates: Estimate[],
  jobs: Job[],
  invoices: Invoice[]
): ClientDetailSummary {
  const relatedEstimates = newestFirst(estimates.filter((estimate) => estimate.customerId === customerId));
  const relatedJobs = newestFirst(jobs.filter((job) => job.customerId === customerId));
  const relatedInvoices = newestFirst(invoices.filter((invoice) => invoice.customerId === customerId));

  return {
    estimates: relatedEstimates,
    jobs: relatedJobs,
    invoices: relatedInvoices,
    estimateValue: relatedEstimates.reduce((total, estimate) => total + computeClientEstimateValue(estimate), 0),
    contractValue: relatedJobs.reduce((total, job) => total + job.contractValue, 0),
    invoiceValue: relatedInvoices.reduce((total, invoice) => total + invoice.amount, 0),
    activeJobCount: relatedJobs.filter((job) => job.status === 'scheduled' || job.status === 'in_progress').length,
  };
}