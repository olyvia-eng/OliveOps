export type ScheduleWorkingDayInput = { startDate?: string; endDate?: string; includeWeekends?: boolean };

export function scheduleIncludesWeekends(schedule?: { includeWeekends?: boolean } | null): boolean;
export function getScheduleWorkingWeekdays(schedule?: { includeWeekends?: boolean } | null): ReadonlySet<number>;
export function isScheduleDateIncluded(schedule: ScheduleWorkingDayInput, dateKey: string): boolean;
export function getScheduleDateKeys(schedule: ScheduleWorkingDayInput): string[];
export function scheduleHasWorkingDays(schedule: ScheduleWorkingDayInput): boolean;
export function scheduleDateRangesOverlap(left: ScheduleWorkingDayInput, right: ScheduleWorkingDayInput): boolean;
export function getScheduleDateSegments(schedule: ScheduleWorkingDayInput): Array<{ startKey: string; endKey: string }>;