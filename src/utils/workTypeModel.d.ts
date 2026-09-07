export type WorkType = 'project' | 'service';
export type ServiceScheduleType = 'recurring' | 'one_time' | 'as_needed';
export type ServiceBillingType = 'contract' | 'per_visit' | 'time_and_material';
export type ServiceFrequencyUnit = 'day' | 'week' | 'month';

export interface EstimateServiceModel {
  id: string;
  name: string;
  description: string;
  divisionId?: string;
  sortOrder: number;
  scheduleType: ServiceScheduleType;
  billingType: ServiceBillingType;
  startDate?: string;
  endDate?: string;
  frequency?: { interval: number; unit: ServiceFrequencyUnit };
  estimatedVisits?: number;
}

export const WORK_TYPES: WorkType[];
export const SERVICE_SCHEDULE_TYPES: ServiceScheduleType[];
export const SERVICE_BILLING_TYPES: ServiceBillingType[];
export const SERVICE_FREQUENCY_UNITS: ServiceFrequencyUnit[];
export function isWorkType(value: unknown): value is WorkType;
export function resolveWorkType(record: { workType?: unknown } | null | undefined): WorkType;
export function calculateSuggestedServiceVisits(service: Partial<EstimateServiceModel>): number | undefined;
export function normalizeEstimateService(service: Partial<EstimateServiceModel>, index?: number, generateId?: () => string): EstimateServiceModel;
export function normalizeEstimateServices(services: unknown, generateId?: () => string): EstimateServiceModel[];
export function validateEstimateService(service: unknown): string | null;
export function validateEstimateServices(services: unknown): string | null;