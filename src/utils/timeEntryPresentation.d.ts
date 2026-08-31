import type { Job, TimeEntry } from '../types';

type JobReference = Pick<Job, 'id' | 'title'>;

export function getTimeEntryWorkAreaLabel(entry: Partial<TimeEntry>): string | null;
export function getTimeEntryJobLabel(entry: Partial<TimeEntry>, jobs: JobReference[]): string;
export function getTimeEntryWorkLabel(entry: Partial<TimeEntry>, jobs: JobReference[]): string;