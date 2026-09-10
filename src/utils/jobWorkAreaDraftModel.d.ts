import type { JobWorkArea, JobWorkAreaLineItem, JobWorkAreaStatus } from '../types';

export interface JobWorkAreaDraft {
  name: string;
  description: string;
  status: JobWorkAreaStatus;
  lineItems: JobWorkAreaLineItem[];
}

export function formatJobPlanRateInput(value: number): string;
export function jobLineWorkers(line: Partial<JobWorkAreaLineItem>): number;
export function jobLineHoursPerWorker(line: Partial<JobWorkAreaLineItem>): number;
export function jobLinePlannedQuantity(line: Partial<JobWorkAreaLineItem>): number;
export function jobLinePlannedTotal(line: Partial<JobWorkAreaLineItem>): number;
export function loadJobWorkAreaDraft(workArea: JobWorkArea): JobWorkAreaDraft;
export function jobWorkAreaDraftTotals(draft: JobWorkAreaDraft): { plannedCost: number; soldRevenue: number };