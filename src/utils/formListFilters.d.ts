import type { FormCategory, FormRecord, FormStatus } from '../types';

export type FormListStatusFilter = 'operational' | 'all' | FormStatus;

export const DEFAULT_FORM_STATUS_FILTER: FormListStatusFilter;
export function filterFormsForList(
  forms: FormRecord[],
  filters?: { search?: string; category?: 'all' | FormCategory; status?: FormListStatusFilter },
): FormRecord[];
