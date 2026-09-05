import type { Employee, Expense, Invoice, Job, LabourClass, TimeCorrectionRequest, TimeEntry } from '../types';
import type { JobLabourSummary } from './jobLabourSummary.js';

export type JobPerformanceCostRow = {
  category: 'labour' | 'material' | 'equipment' | 'subcontractor';
  estimatedCost: number | null;
  actualCost: number | null;
  variance: number | null;
  source: string;
  sourceDescription?: string;
};

export type JobPerformance = {
  scopeWorkAreaId: string;
  labour: JobLabourSummary;
  revenue: { contract: number | null; issued: number | null; taxTreatment: string };
  profit: { estimatedGross: number | null; estimatedGrossMargin: number | null; estimatedNet: number | null; estimatedNetMargin: number | null; toDate: number | null; toDateMargin: number | null; unavailableReason: string | null };
  costs: { categories: JobPerformanceCostRow[]; estimatedDirect: number | null; knownActualDirect: number; actualDirectComplete: boolean; actualComplete: boolean; unavailableCategories: string[]; estimatedOverhead: number | null; actualOverhead: number | null; knownActualIncludingOverhead: number; varianceConvention: string };
  baseline: { available: boolean; source: 'accepted-estimate-snapshot' | 'unavailable'; unavailableReason: string | null };
  economics: {
    estimatedChartSegments: JobEconomicsChartSegment[];
    actualChartSegments: JobEconomicsChartSegment[];
    chartTotal: number;
    knownActualCost: number;
    actualCostComplete: boolean;
    marginAfterRecordedCosts: number | null;
    costConsumedPct: number | null;
    overContractAmount: number;
    statusMessage: string;
    forecastProfit: number | null;
    forecastMargin: number | null;
    forecastUnavailableReason: string;
  };
  details: Array<{ id: string; workAreaId: string; workAreaName: string; description: string; category: string; estimatedQuantity: number | null; actualQuantity: number | null; unit: string; estimatedCost: number | null; actualCost: number | null; variance: number | null; status: string }>;
  expenses: Array<{ id: string; vendor: string; description: string; category: string; date: string; amount: number; status: string; receiptUrl?: string; receiptFileId?: string; countedInActuals: boolean }>;
};

export type JobEconomicsChartSegment = {
  key: 'labour' | 'material' | 'equipment' | 'subcontractor' | 'overhead' | 'profit' | 'unspent';
  label: string;
  amount: number;
  percent: number | null;
};

export function calculateJobPerformance(input: { job: Job; employees?: Employee[]; labourClasses?: LabourClass[]; timeEntries?: TimeEntry[]; timeCorrections?: TimeCorrectionRequest[]; invoices?: Invoice[]; expenses?: Expense[]; scopeWorkAreaId?: string }): JobPerformance;