import { endOfDay, format, parseISO, startOfDay } from 'date-fns';
import type { Customer, EquipmentAsset, ID, Job } from '../types';
import { getScheduleDateKeys, getScheduleDateSegments, isScheduleDateIncluded, scheduleDateRangesOverlap, scheduleIncludesWeekends } from './scheduleWorkingDays.js';

export type JobScheduleWindow = {
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  allDay: boolean;
  includeWeekends: boolean;
};

type ScheduleWindowInput = {
  startDate?: string;
  endDate?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  scheduleAllDay?: boolean;
  includeWeekends?: boolean;
};

export type JobAssignmentConflict = {
  job: Job;
  schedule: JobScheduleWindow;
  conflictingCrewId?: ID;
  conflictingEmployeeIds: ID[];
  conflictingEquipmentIds: ID[];
};

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const parseDateOnly = (value: string | undefined): Date | null => {
  if (!value) return null;
  const parsed = parseISO(`${value}T00:00:00`);
  return isValidDate(parsed) ? parsed : null;
};

const parseDateTime = (value: string | undefined): Date | null => {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValidDate(parsed) ? parsed : null;
};

export const isJobExplicitlyScheduled = (job: Job): boolean => {
  if (job.scheduleConfirmed === true) return true;
  if (job.scheduleConfirmed === false) return false;
  if (job.scheduledStartAt || job.scheduledEndAt) return true;
  if (!job.startDate) return false;

  if (
    job.sourceEstimateId
    && job.convertedFromEstimateAt
    && job.startDate === job.convertedFromEstimateAt.slice(0, 10)
    && !job.endDate
  ) {
    return false;
  }

  return true;
};

export const getScheduleWindowFromValues = ({
  startDate,
  endDate,
  scheduledStartAt,
  scheduledEndAt,
  scheduleAllDay,
  includeWeekends,
}: ScheduleWindowInput): JobScheduleWindow | null => {
  const explicitStart = parseDateTime(scheduledStartAt);
  const explicitEnd = parseDateTime(scheduledEndAt);
  const fallbackStart = parseDateOnly(startDate);
  const fallbackEnd = parseDateOnly(endDate) ?? fallbackStart;
  const allDay = scheduleAllDay !== false;

  const start = explicitStart ?? fallbackStart;
  const end = explicitEnd ?? fallbackEnd;
  if (!start || !end) return null;

  const normalizedStart = allDay ? startOfDay(start) : start;
  const normalizedEnd = allDay ? endOfDay(end) : end;
  const safeEnd = normalizedEnd >= normalizedStart ? normalizedEnd : normalizedStart;

  return {
    start: normalizedStart,
    end: safeEnd,
    startKey: format(normalizedStart, 'yyyy-MM-dd'),
    endKey: format(safeEnd, 'yyyy-MM-dd'),
    allDay,
    includeWeekends: includeWeekends !== false,
  };
};

export const getJobScheduleWindow = (job: Job): JobScheduleWindow | null => {
  if (!isJobExplicitlyScheduled(job)) return null;
  return getScheduleWindowFromValues(job);
};

export const scheduleWindowsOverlap = (left: JobScheduleWindow | null, right: JobScheduleWindow | null) => {
  if (!left || !right) return false;
  if (!scheduleDateRangesOverlap(
    { startDate: left.startKey, endDate: left.endKey, includeWeekends: left.includeWeekends },
    { startDate: right.startKey, endDate: right.endKey, includeWeekends: right.includeWeekends },
  )) return false;
  return getScheduleSegments(left).some((leftSegment) => getScheduleSegments(right)
    .some((rightSegment) => leftSegment.start < rightSegment.end && leftSegment.end > rightSegment.start));
};

export const getScheduleSegments = (window: JobScheduleWindow | null): JobScheduleWindow[] => {
  if (!window) return [];
  if (window.includeWeekends) return [window];
  if (window.allDay) {
    return getScheduleDateSegments({ startDate: window.startKey, endDate: window.endKey, includeWeekends: false }).map((segment) => ({
      start: startOfDay(parseISO(`${segment.startKey}T00:00:00`)),
      end: endOfDay(parseISO(`${segment.endKey}T00:00:00`)),
      startKey: segment.startKey,
      endKey: segment.endKey,
      allDay: true,
      includeWeekends: false,
    }));
  }

  const startTime = format(window.start, 'HH:mm:ss');
  const endTime = format(window.end, 'HH:mm:ss');
  return getScheduleDateKeys({ startDate: window.startKey, endDate: window.endKey, includeWeekends: false }).map((dateKey) => {
    const start = parseISO(`${dateKey}T${startTime}`);
    const end = parseISO(`${dateKey}T${endTime}`);
    return {
      start,
      end: end >= start ? end : start,
      startKey: dateKey,
      endKey: dateKey,
      allDay: false,
      includeWeekends: false,
    };
  });
};

export const isJobScheduledOnDate = (job: Job, dateKey: string): boolean => {
  const window = getJobScheduleWindow(job);
  return Boolean(window && isScheduleDateIncluded({
    startDate: window.startKey,
    endDate: window.endKey,
    includeWeekends: window.includeWeekends,
  }, dateKey));
};

export const getJobAssignmentConflicts = ({
  jobId,
  jobs,
  scheduleWindow,
  crewId,
  assignedEmployeeIds,
  assignedEquipmentIds,
}: {
  jobId: string;
  jobs: Job[];
  scheduleWindow: JobScheduleWindow | null;
  crewId?: ID;
  assignedEmployeeIds: ID[];
  assignedEquipmentIds: ID[];
}): JobAssignmentConflict[] => {
  if (!scheduleWindow) return [];

  const employeeIds = new Set(assignedEmployeeIds);
  const equipmentIds = new Set(assignedEquipmentIds);

  return jobs
    .map((job) => {
      if (job.id === jobId) return null;

      const otherSchedule = getJobScheduleWindow(job);
      if (!scheduleWindowsOverlap(scheduleWindow, otherSchedule)) return null;

      const conflictingEmployeeIds = (job.assignedEmployeeIds ?? []).filter((id) => employeeIds.has(id));
      const conflictingEquipmentIds = (job.assignedEquipmentIds ?? []).filter((id) => equipmentIds.has(id));
      const conflictingCrewId = crewId && job.crewId === crewId ? crewId : undefined;

      if (!conflictingCrewId && conflictingEmployeeIds.length === 0 && conflictingEquipmentIds.length === 0) return null;

      return {
        job,
        schedule: otherSchedule!,
        ...(conflictingCrewId ? { conflictingCrewId } : {}),
        conflictingEmployeeIds,
        conflictingEquipmentIds,
      };
    })
    .filter((value): value is JobAssignmentConflict => Boolean(value));
};

export const getScheduledDayKeys = (job: Job): string[] => {
  const window = getJobScheduleWindow(job);
  if (!window) return [];
  return getScheduleDateKeys({
    startDate: window.startKey,
    endDate: window.endKey,
    includeWeekends: scheduleIncludesWeekends(job),
  });
};

export const formatScheduleTimeLabel = (job: Job): string => {
  const window = getJobScheduleWindow(job);
  if (!window) return 'Unscheduled';
  if (window.allDay) return 'All day';

  const start = window.start.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const end = window.end.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  return `${start} - ${end}`;
};

export const formatCustomerPropertyLabel = (job: Job, customer?: Customer | null): string => {
  const property = typeof job.propertyLabel === 'string' && job.propertyLabel.trim()
    ? job.propertyLabel.trim()
    : typeof job.propertyAddressSnapshot === 'string' && job.propertyAddressSnapshot.trim()
      ? job.propertyAddressSnapshot.trim()
      : '';

  if (customer?.name && property) return `${customer.name} · ${property}`;
  if (customer?.name) return customer.name;
  if (property) return property;
  return 'Customer or property not set';
};

export const getAssignedEquipmentForJob = (job: Job, equipmentAssets: EquipmentAsset[]): EquipmentAsset[] => {
  const assignedIds = new Set(job.assignedEquipmentIds ?? []);
  return equipmentAssets.filter((asset) => assignedIds.has(asset.id) || asset.currentJobId === job.id);
};
