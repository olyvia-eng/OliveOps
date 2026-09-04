import type { Employee, Expense, Invoice, Job, LabourClass, TimeCorrectionRequest, TimeEntry } from '../types';
import type { JobLabourSummary } from './jobLabourSummary.js';

export type JobPerformanceCostRow = {
  category: 'labour' | 'material' | 'equipment' | 'subcontractor';
  estimatedCost: number;
  actualCost: number | null;
  variance: number | null;
  source: string;
  sourceDescription?: string;
};

export type JobPerformance = {
  scopeWorkAreaId: string;
  labour: JobLabourSummary;
  revenue: { contract: number; issued: number | null; taxTreatment: string };
  profit: { estimatedGross: number; estimatedGrossMargin: number | null; estimatedNet: number | null; estimatedNetMargin: number | null; toDate: number | null; toDateMargin: number | null; unavailableReason: string | null };
  costs: { categories: JobPerformanceCostRow[]; estimatedDirect: number; knownActualDirect: number; actualDirectComplete: boolean; estimatedOverhead: number | null; actualOverhead: number | null; knownActualIncludingOverhead: number; varianceConvention: string };
  details: Array<{ id: string; workAreaId: string; workAreaName: string; description: string; category: string; estimatedQuantity: number | null; actualQuantity: number | null; unit: string; estimatedCost: number | null; actualCost: number | null; variance: number | null; status: string }>;
  expenses: Array<{ id: string; vendor: string; description: string; category: string; date: string; amount: number; status: string; receiptUrl?: string; receiptFileId?: string; countedInActuals: boolean }>;
};

export function calculateJobPerformance(input: { job: Job; employees?: Employee[]; labourClasses?: LabourClass[]; timeEntries?: TimeEntry[]; timeCorrections?: TimeCorrectionRequest[]; invoices?: Invoice[]; expenses?: Expense[]; scopeWorkAreaId?: string }): JobPerformance;