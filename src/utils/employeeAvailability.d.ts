import type { Crew, Employee, Job, TimeOffRequestType } from '../types';

export interface ScheduleTimeOff {
  id: string;
  employeeId: string;
  employeeName: string;
  requestType: TimeOffRequestType;
  startDate: string;
  endDate: string;
  status: 'approved';
}

export interface EmployeeTimeOffConflict {
  requestId: string;
  employeeId: string;
  employeeName: string;
  requestType: TimeOffRequestType;
  startDate: string;
  endDate: string;
  fromCrew: boolean;
}

export function dateRangesOverlapInclusive(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean;
export function exclusiveEndDateKey(inclusiveEndDate: string): string;
export function getCrewEmployeeIds(crewId: string | undefined, crews: Crew[]): string[];
export function getEmployeeTimeOffConflicts(input: { employeeIds: string[]; crewId?: string; crews?: Crew[]; startDate: string; endDate: string; approvedTimeOff?: ScheduleTimeOff[] }): EmployeeTimeOffConflict[];
export function getJobTimeOffConflicts(job: Job, approvedTimeOff: ScheduleTimeOff[], crews?: Crew[]): EmployeeTimeOffConflict[];
export function normalizeTimeOffScheduleEntry(request: ScheduleTimeOff, employee?: Employee, divisionIds?: string[]): {
  source: 'time_off'; timeOffRequestId: string; title: string; summary: string; timeLabel: string; status: 'approved';
  start: string; end: string; startKey: string; endKey: string; allDay: true; crew: null; division: null;
  divisionIds: string[]; employeeIds: string[]; equipmentIds: string[]; timeOffRequest: ScheduleTimeOff;
};
export function formatTimeOffType(value: string): string;