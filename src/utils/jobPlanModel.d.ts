import type { JobWorkArea, JobWorkAreaCategoryTotals, JobWorkAreaLineItem } from '../types';

export const JOB_PLANNING_SNAPSHOT_VERSION: 1;

export interface JobPlanTotals {
  operationalWorkAreas: JobWorkArea[];
  currentPlannedCost: number;
  currentContractRevenue: number;
  currentExpectedProfit: number;
  currentExpectedMarginPct: number;
  plannedByCategory: JobWorkAreaCategoryTotals;
}

export function calculateJobPlanLine(
  rawLine: Partial<JobWorkAreaLineItem>,
  options?: { contractRevenue?: number },
): JobWorkAreaLineItem;
export function calculateJobPlan(workAreas?: JobWorkArea[]): JobPlanTotals;
export function createJobOnlyPlanLine(rawLine: Partial<JobWorkAreaLineItem>): JobWorkAreaLineItem;
export function cloneJobPlan<T>(value: T): T;