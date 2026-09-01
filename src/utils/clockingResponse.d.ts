import type { TimeEntry } from '../types';

export interface PendingClockingWorkflow {
  ok: true;
  blocked: true;
  workflowOccurrenceId: string;
  status: string;
  requiredFormCount: number;
  completedRequiredFormCount: number;
  remainingRequiredFormCount: number;
  requiredForms: Array<{ requirementId: string; formId: string; title: string }>;
  remainingForms: Array<{ requirementId: string; formId: string; title: string }>;
  clockInIntent?: {
    employeeId: string;
    workType: string;
    jobIds: string[];
    clockingContractVersion?: number;
    workAreaId?: string | null;
    workAreaNameSnapshot?: string | null;
  };
  timeEntryId?: string;
  intendedClockOutAt?: string;
}

export type ClockingResponseResult =
  | { kind: 'completed'; timeEntry: TimeEntry }
  | { kind: 'pending'; workflow: PendingClockingWorkflow }
  | { kind: 'failed'; message: string };

export function classifyClockingResponse(input: {
  action: 'clock-in' | 'clock-out';
  status: number;
  payload: unknown;
}): ClockingResponseResult;