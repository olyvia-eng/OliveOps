import { nanoid } from 'nanoid';

export const generateId = (): string => nanoid();

export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);

export const formatDate = (iso: string): string => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatDateTime = (iso: string): string => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const nowISO = (): string => new Date().toISOString();

export const durationHours = (clockIn: string, clockOut?: string, breakMinutes = 0): number => {
  const start = new Date(clockIn).getTime();
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  const ms = end - start - breakMinutes * 60_000;
  return Math.max(0, ms / 3_600_000);
};

export const calcLineItemTotal = (
  quantity: number,
  unitCost: number,
  markup: number
): number => {
  return quantity * unitCost * (1 + markup / 100);
};

export const calcEstimateSubtotal = (lineItems: { total: number }[]): number =>
  lineItems.reduce((s, li) => s + li.total, 0);

export const calcEstimateTax = (subtotal: number, taxRate: number): number =>
  subtotal * (taxRate / 100);

export const calcEstimateTotal = (subtotal: number, tax: number): number =>
  subtotal + tax;

export const statusColor: Record<string, string> = {
  // Estimate
  draft: 'bg-brand-100 text-brand-700',
  sent: 'bg-accent-50 text-accent-600',
  accepted: 'bg-brand-200 text-brand-800',
  declined: 'bg-accent-100 text-accent-700',
  converted: 'bg-brand-300 text-brand-900',
  // Job
  scheduled: 'bg-accent-50 text-accent-600',
  in_progress: 'bg-brand-100 text-brand-700',
  on_hold: 'bg-accent-100 text-accent-700',
  completed: 'bg-brand-200 text-brand-800',
  cancelled: 'bg-accent-100 text-accent-700',
  // Customer
  lead: 'bg-brand-100 text-brand-700',
  client: 'bg-brand-200 text-brand-800',
  prospect: 'bg-accent-50 text-accent-600',
  active: 'bg-brand-200 text-brand-800',
  inactive: 'bg-accent-100 text-accent-700',
};
