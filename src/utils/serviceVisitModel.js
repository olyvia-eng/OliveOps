const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const pad = (value) => String(value).padStart(2, '0');

function parseDateOnly(value) {
  if (!DATE_PATTERN.test(String(value ?? ''))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function dateKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
}

export function serviceVisitSeriesId(jobId, serviceId) {
  return `SERVICE_SERIES#${jobId}#${serviceId}`;
}

export function serviceVisitOccurrenceKey(jobId, serviceId, recurrenceDate) {
  return `${serviceVisitSeriesId(jobId, serviceId)}#${recurrenceDate}`;
}

export function serviceVisitId(jobId, serviceId, recurrenceDate) {
  return `visit-${encodeURIComponent(jobId)}-${encodeURIComponent(serviceId)}-${recurrenceDate}`;
}

export function resolveVisitBillingStatus(billingType, visitStatus = 'scheduled') {
  if (billingType === 'contract') return 'included';
  if (visitStatus === 'cancelled' || visitStatus === 'skipped') return 'not_billable';
  if (billingType === 'per_visit') return visitStatus === 'completed' ? 'ready' : 'pending';
  return 'pending_usage';
}

export const VISIT_STATUS_TRANSITIONS = {
  scheduled: ['in_progress', 'completed', 'skipped', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  skipped: [],
  cancelled: [],
};

export function canTransitionVisitStatus(from, to) {
  return from === to || Boolean(VISIT_STATUS_TRANSITIONS[from]?.includes(to));
}

export function validateVisitStatusTransition(from, to) {
  return canTransitionVisitStatus(from, to) ? null : `Visit status cannot change from ${from} to ${to}.`;
}

export function generateServiceOccurrenceDates(service) {
  if (service?.scheduleType === 'as_needed') return [];
  const schedule = service?.operationalSchedule ?? {};
  const start = parseDateOnly(schedule.startDate ?? service?.startDate);
  if (!start) return [];
  if (service?.scheduleType === 'one_time') return [dateKey(start)];
  const end = parseDateOnly(schedule.endDate ?? service?.endDate);
  if (!end || end < start) return [];
  const interval = Math.max(1, Math.trunc(number(service?.frequency?.interval, 1)));
  const unit = service?.frequency?.unit === 'day' || service?.frequency?.unit === 'month' ? service.frequency.unit : 'week';
  const dates = [];

  if (unit === 'month') {
    const requestedDay = Math.min(31, Math.max(1, Math.trunc(number(schedule.monthlyDay, start.getUTCDate()))));
    let monthOffset = 0;
    while (true) {
      const monthIndex = start.getUTCMonth() + monthOffset;
      const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
      const month = ((monthIndex % 12) + 12) % 12;
      const occurrence = new Date(Date.UTC(year, month, Math.min(requestedDay, daysInMonth(year, month)), 12));
      if (occurrence > end) break;
      if (occurrence >= start) dates.push(dateKey(occurrence));
      monthOffset += interval;
    }
    return dates;
  }

  if (unit === 'week') {
    const weekdays = [...new Set((Array.isArray(schedule.preferredWeekdays) && schedule.preferredWeekdays.length ? schedule.preferredWeekdays : [start.getUTCDay()]).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
      const elapsedDays = Math.round((cursor.getTime() - start.getTime()) / 86400000);
      if (Math.floor(elapsedDays / 7) % interval === 0 && weekdays.includes(cursor.getUTCDay())) dates.push(dateKey(cursor));
    }
    return dates;
  }

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, interval)) dates.push(dateKey(cursor));
  return dates;
}

function scheduledTimes(recurrenceDate, schedule) {
  const startTime = typeof schedule?.startTime === 'string' ? schedule.startTime : '';
  if (!/^\d{2}:\d{2}$/.test(startTime)) return { scheduleAllDay: true };
  const durationMinutes = Math.max(1, Math.trunc(number(schedule.durationMinutes, 60)));
  const [hour, minute] = startTime.split(':').map(Number);
  const endMinutes = hour * 60 + minute + durationMinutes;
  const endDate = addDays(parseDateOnly(recurrenceDate), Math.floor(endMinutes / 1440));
  return {
    scheduleAllDay: false,
    scheduledStartAt: `${recurrenceDate}T${startTime}:00`,
    scheduledEndAt: `${dateKey(endDate)}T${pad(Math.floor((endMinutes % 1440) / 60))}:${pad(endMinutes % 60)}:00`,
  };
}

export function buildGeneratedServiceVisits({ businessId, job, service, now = new Date().toISOString() }) {
  const seriesId = serviceVisitSeriesId(job.id, service.id);
  return generateServiceOccurrenceDates(service).map((recurrenceDate, index) => ({
    id: serviceVisitId(job.id, service.id, recurrenceDate),
    businessId,
    jobId: job.id,
    serviceId: service.id,
    sourceEstimateServiceId: service.sourceEstimateServiceId,
    scheduledDate: recurrenceDate,
    originalRecurrenceDate: recurrenceDate,
    ...scheduledTimes(recurrenceDate, service.operationalSchedule),
    crewId: service.operationalSchedule?.defaultCrewId,
    assignedEmployeeIds: [...new Set(service.operationalSchedule?.defaultEmployeeIds ?? [])],
    assignedEquipmentIds: [...new Set(service.operationalSchedule?.defaultEquipmentIds ?? [])],
    status: 'scheduled',
    billingTypeSnapshot: service.billingType,
    billingStatus: resolveVisitBillingStatus(service.billingType),
    source: service.scheduleType === 'one_time' ? 'one_time' : 'recurrence',
    seriesId,
    recurrenceSequence: index + 1,
    recurrenceKey: serviceVisitOccurrenceKey(job.id, service.id, recurrenceDate),
    revision: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }));
}

export function synchronizeServiceVisits(existingVisits, generatedVisits, today) {
  const byRecurrenceKey = new Map(existingVisits.filter((visit) => visit.recurrenceKey).map((visit) => [visit.recurrenceKey, visit]));
  const desiredKeys = new Set(generatedVisits.map((visit) => visit.recurrenceKey));
  const create = generatedVisits.filter((visit) => !byRecurrenceKey.has(visit.recurrenceKey));
  const preserve = existingVisits.filter((visit) => visit.source === 'manual' || visit.isSeriesException || ['completed', 'skipped', 'cancelled'].includes(visit.status) || visit.scheduledDate < today);
  const update = generatedVisits.flatMap((visit) => {
    const current = byRecurrenceKey.get(visit.recurrenceKey);
    if (!current || preserve.includes(current)) return [];
    return [{ ...current, ...visit, id: current.id, revision: number(current.revision, 1) + 1, createdAt: current.createdAt }];
  });
  const cancel = existingVisits.filter((visit) => visit.source !== 'manual' && !desiredKeys.has(visit.recurrenceKey) && !preserve.includes(visit) && visit.status === 'scheduled').map((visit) => ({ ...visit, status: 'cancelled', billingStatus: 'not_billable', cancellationReason: 'Series schedule changed', revision: number(visit.revision, 1) + 1 }));
  return { create, update, cancel, preserve };
}