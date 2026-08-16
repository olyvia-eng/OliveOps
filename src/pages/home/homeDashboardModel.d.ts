import type { Customer, Crew, Employee, ExternalCalendarEvent, Job, Task, TaskTab, TimeCorrectionRequest, TimeEntry } from '../../types';

export type HomeTaskFilter = 'all' | 'today' | 'overdue' | 'week' | 'completed';
export interface HomeUpcomingItem { id: string; kind: 'job' | 'task' | 'external'; title: string; start: string; end?: string; allDay?: boolean; location?: string; jobId?: string; taskId?: string; provider?: string }
export interface HomeActivityItem { id: string; kind: 'task' | 'job' | 'time' | 'correction'; title: string; timestamp: string }

export function localDateKey(value: Date | string): string;
export function getLocalDayRange(now?: Date): { start: Date; end: Date };
export function getLocalWeekRange(now?: Date): { start: Date; end: Date };
export function resolveSessionEmployee(input: { employees?: Employee[]; userId: string; email?: string }): Employee | null;
export function getPersonalJobs(input: { jobs?: Job[]; crews?: Crew[]; employeeId?: string }): Job[];
export function getPersonalTasks(tasks: Task[], userId: string): Task[];
export function filterTasksByRange(tasks: Task[], filter: string, now?: Date): Task[];
export function taskCreationDefaults(viewId: string, customTabs?: TaskTab[], now?: Date): { dueDate: string; taskTabId: string; status: 'open' };
export function getTaskSummary(tasks: Task[], now?: Date): { dueToday: number; highPriorityDueToday: number; overdue: number };
export function getJobsThisWeek(jobs: Job[], now?: Date): Job[];
export function getHoursLoggedToday(timeEntries: TimeEntry[], employeeId?: string, now?: Date): number;
export function buildUpcomingItems(input: { jobs?: Job[]; tasks?: Task[]; externalEvents?: ExternalCalendarEvent[]; customers?: Customer[]; now?: Date; limit?: number }): HomeUpcomingItem[];
export function buildRecentActivity(input: { jobs?: Job[]; tasks?: Task[]; timeEntries?: TimeEntry[]; corrections?: TimeCorrectionRequest[]; employeeId?: string; limit?: number }): HomeActivityItem[];
