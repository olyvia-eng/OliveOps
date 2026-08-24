import type { FormSubmission, TimeCorrectionRequest, TimeEntry } from '../../types';

export interface EmployeeProfileFile {
  id: string;
  fileName: string;
  originalFileName?: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  category?: string;
  entityType?: string;
  entityId?: string;
}

export interface EmployeeProfileRecords {
  employeeId: string | undefined;
  timeEntries: TimeEntry[];
  timeCorrections: TimeCorrectionRequest[];
  formSubmissions: FormSubmission[];
  files?: EmployeeProfileFile[];
}

export function scopeEmployeeProfileRecords(records: EmployeeProfileRecords): {
  timeEntries: TimeEntry[];
  timeCorrections: TimeCorrectionRequest[];
  formSubmissions: FormSubmission[];
  files: EmployeeProfileFile[];
};

export function getEmployeeRangeStart(range: '30-days' | '90-days' | 'year-to-date', now?: Date): Date;