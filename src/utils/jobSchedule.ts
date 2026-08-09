import { eachDayOfInterval, endOfDay, format, parseISO, startOfDay } from 'date-fns';
import type { Customer, EquipmentAsset, Job } from '../types';

export type JobScheduleWindow = {
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  allDay: boolean;
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

export const getJobScheduleWindow = (job: Job): JobScheduleWindow | null => {
  if (!isJobExplicitlyScheduled(job)) return null;

  const explicitStart = parseDateTime(job.scheduledStartAt);
  const explicitEnd = parseDateTime(job.scheduledEndAt);
  const fallbackStart = parseDateOnly(job.startDate);
  const fallbackEnd = parseDateOnly(job.endDate) ?? fallbackStart;
  const allDay = job.scheduleAllDay !== false;

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
  };
};

export const getScheduledDayKeys = (job: Job): string[] => {
  const window = getJobScheduleWindow(job);
  if (!window) return [];
  return eachDayOfInterval({ start: startOfDay(window.start), end: startOfDay(window.end) }).map((day) => format(day, 'yyyy-MM-dd'));
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
