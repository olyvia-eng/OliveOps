import type { Budget, CalendarColourBy, CalendarPreferences, Crew, Division, Job } from '../types';
import type { ScheduleColour } from '../config/scheduleColours.js';

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences;
export function normalizeCalendarPreferences(value?: Partial<CalendarPreferences> | null): CalendarPreferences;
export function getEffectiveDivision(job: Job, divisions: Division[], budgets: Budget[]): Division | null;
export function resolveScheduleColour(input: { source?: 'oliveops' | 'google'; colourBy: CalendarColourBy; job?: Pick<Job, 'status'>; crew?: Crew | null; division?: Division | null }): ScheduleColour;

export interface NormalizedScheduleEntry {
  source: 'oliveops' | 'google';
  jobId?: string;
  status: string;
  startKey: string;
  endKey: string;
  crew: Crew | null;
  division: Division | null;
  employeeIds: string[];
  equipmentIds: string[];
}

export function filterScheduleEntries(entries: NormalizedScheduleEntry[], filters: { divisionId?: string; resourceId?: string; jobId?: string; equipmentId?: string; showGoogleEvents?: boolean }): NormalizedScheduleEntry[];
export function getScheduleLegend(entries: NormalizedScheduleEntry[], colourBy: CalendarColourBy): Array<{ id: string; label: string; colour: ScheduleColour }>;
export function groupScheduleEntriesByDay(entries: NormalizedScheduleEntry[], dayKeys: string[]): Array<{ dayKey: string; entries: NormalizedScheduleEntry[] }>;