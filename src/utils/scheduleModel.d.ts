import type { Budget, CalendarColourBy, CalendarPreferences, Crew, Division, ExternalCalendarEvent, ExternalCalendarProvider, GoogleCalendarEvent, Job } from '../types';
import type { ScheduleColour } from '../config/scheduleColours.js';

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences;
export function normalizeCalendarPreferences(value?: Partial<CalendarPreferences> | null): CalendarPreferences;
export function getEffectiveDivision(job: Job, divisions: Division[], budgets: Budget[]): Division | null;
export function resolveScheduleColour(input: { source?: 'oliveops' | ExternalCalendarProvider; colourBy: CalendarColourBy; job?: { status: string }; crew?: Crew | null; division?: Division | null }): ScheduleColour;

export interface NormalizedScheduleEntry {
  source: 'oliveops' | 'external';
  provider?: ExternalCalendarProvider;
  jobId?: string;
  googleEventId?: string;
  googleCalendarId?: string;
  externalEventId?: string;
  externalCalendarId?: string;
  title?: string;
  summary?: string;
  timeLabel?: string;
  status: string;
  start?: string;
  end?: string;
  startKey: string;
  endKey: string;
  allDay?: boolean;
  location?: string;
  crew: Crew | null;
  division: Division | null;
  employeeIds: string[];
  equipmentIds: string[];
  googleEvent?: GoogleCalendarEvent;
  externalEvent?: ExternalCalendarEvent;
}

export interface WeeklyScheduleSpan {
  entry: NormalizedScheduleEntry;
  startColumn: number;
  endColumn: number;
  columnSpan: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface PackedWeeklyScheduleSpan extends WeeklyScheduleSpan { row: number }

export function filterScheduleEntries(entries: NormalizedScheduleEntry[], filters: { divisionId?: string; resourceId?: string; crewId?: string; employeeId?: string; status?: string; jobId?: string; equipmentId?: string; showGoogleEvents?: boolean; showOutlookEvents?: boolean }): NormalizedScheduleEntry[];
export function getScheduleLegend(entries: NormalizedScheduleEntry[], colourBy: CalendarColourBy): Array<{ id: string; label: string; colour: ScheduleColour }>;
export function groupScheduleEntriesByDay(entries: NormalizedScheduleEntry[], dayKeys: string[]): Array<{ dayKey: string; entries: NormalizedScheduleEntry[] }>;
export function normalizeGoogleScheduleEntry(event: GoogleCalendarEvent): NormalizedScheduleEntry;
export function normalizeExternalScheduleEntry(event: ExternalCalendarEvent): NormalizedScheduleEntry;
export function buildWeeklyScheduleSpans(entries: NormalizedScheduleEntry[], dayKeys: string[]): WeeklyScheduleSpan[];
export function packWeeklyScheduleSpans(spans: WeeklyScheduleSpan[]): PackedWeeklyScheduleSpan[];