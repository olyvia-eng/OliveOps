import type { Budget, Customer, Division, Employee, EquipmentAsset, Estimate, Expense, Invoice, Job, TimeEntry } from '../../types';

export type DataCenterDatePreset = 'month' | 'quarter' | 'ytd' | 'last_year' | 'custom';
export interface DataCenterDateRange { start: Date; end: Date }
export interface FilteredDataCenterRecords {
  customers: Customer[];
  estimates: Estimate[];
  jobs: Job[];
  invoices: Invoice[];
  expenses: Expense[];
  employees: Employee[];
  timeEntries: TimeEntry[];
  equipmentAssets: EquipmentAsset[];
  jobById: Map<string, Job>;
}

export function getDataCenterDateRange(preset: DataCenterDatePreset, now?: Date, customStart?: string, customEnd?: string): DataCenterDateRange;
export function isInDataCenterDateRange(value: string | undefined, range: DataCenterDateRange): boolean;
export function getTimeEntryHours(entry: TimeEntry, range: DataCenterDateRange, now?: Date): number;
export function getEstimateValue(estimate: Estimate): number;
export function filterDataCenterRecords(input: {
  divisionId?: string;
  range: DataCenterDateRange;
  divisions?: Division[];
  budgets?: Budget[];
  customers?: Customer[];
  estimates?: Estimate[];
  jobs?: Job[];
  invoices?: Invoice[];
  expenses?: Expense[];
  employees?: Employee[];
  timeEntries?: TimeEntry[];
  equipmentAssets?: EquipmentAsset[];
}): FilteredDataCenterRecords;
