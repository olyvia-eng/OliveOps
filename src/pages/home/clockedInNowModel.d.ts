import type { Employee, Job, TimeEntry } from '../../types';

export interface ClockedInNowItem {
	id: string;
	employeeId: string;
	employeeName: string;
	contextLabel: string;
	clockIn: string;
}

export function buildClockedInNowItems(entries: TimeEntry[], employees: Employee[], jobs: Job[]): ClockedInNowItem[];
export function formatClockedInElapsed(clockIn: string, now?: number): string;