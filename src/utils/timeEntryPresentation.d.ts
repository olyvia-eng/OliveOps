import type { Job, TimeEntry } from '../types';

type JobReference = Pick<Job, 'id' | 'title'>;

export function sortTimeEntriesNewestFirst<T extends Partial<TimeEntry>>(entries: readonly T[]): T[];
export function getTimeEntryWorkAreaLabel(entry: Partial<TimeEntry>): string | null;
export function getTimeEntryJobLabel(entry: Partial<TimeEntry>, jobs: JobReference[]): string;
export function getTimeEntryWorkLabel(entry: Partial<TimeEntry>, jobs: JobReference[]): string;
export function getTimeEntryActivityLabel(entry: Partial<TimeEntry>): string;
export function getTimeEntryPresentation(entry: Partial<TimeEntry>, jobs: JobReference[]): {
	activityLabel: string;
	jobLabel: string | null;
	workAreaId: string | null;
	workAreaLabel: string | null;
	workLabel: string;
};
export function formatTimeEntryDuration(hours: number): string;