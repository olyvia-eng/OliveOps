import type { Employee, Job, LabourClass, TimeCorrectionRequest, TimeEntry } from '../types';

export type JobLabourTotal = { hours: number; cost: number | null; revenue?: number; hasData: boolean; hoursAvailable: boolean; costAvailable: boolean; unavailableReason?: string };
export type JobLabourVariance = { hours: number | null; cost: number | null };
export type JobLabourClassSummary = { id: string; name: string; estimatedHours: number; estimatedCost: number; estimatedRevenue: number; scheduledHours: number; scheduledCost: number; scheduledCostAvailable: boolean; actualHours: number; actualCost: number; actualCostAvailable: boolean };
export type JobLabourEmployeeSummary = { employeeId: string; employeeName: string; labourClassId: string; labourClassName: string; hours: number; cost: number; costRate: number | null; costAvailable: boolean };
export type JobLabourSummary = {
  estimated: JobLabourTotal;
  scheduled: JobLabourTotal;
  actual: JobLabourTotal;
  variance: { scheduledVsEstimated: JobLabourVariance; actualVsEstimated: JobLabourVariance; actualVsScheduled: JobLabourVariance };
  byLabourClass: JobLabourClassSummary[];
  scheduledEmployees: JobLabourEmployeeSummary[];
  actualEmployees: JobLabourEmployeeSummary[];
};

export function calculateJobLabourSummary(input: { job: Job; employees?: Employee[]; labourClasses?: LabourClass[]; timeEntries?: TimeEntry[]; timeCorrections?: TimeCorrectionRequest[] }): JobLabourSummary;