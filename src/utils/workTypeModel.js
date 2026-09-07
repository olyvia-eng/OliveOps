export const WORK_TYPES = ['project', 'service'];
export const SERVICE_SCHEDULE_TYPES = ['recurring', 'one_time', 'as_needed'];
export const SERVICE_BILLING_TYPES = ['contract', 'per_visit', 'time_and_material'];
export const SERVICE_FREQUENCY_UNITS = ['day', 'week', 'month'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export const isWorkType = (value) => WORK_TYPES.includes(value);
export const resolveWorkType = (record) => isWorkType(record?.workType) ? record.workType : 'project';

export function calculateSuggestedServiceVisits(service) {
  if (service?.scheduleType === 'one_time') return 1;
  if (service?.scheduleType !== 'recurring' || !dateOnly(service.startDate) || !dateOnly(service.endDate)) return undefined;
  const interval = Number(service.frequency?.interval);
  if (!Number.isInteger(interval) || interval <= 0 || !SERVICE_FREQUENCY_UNITS.includes(service.frequency?.unit)) return undefined;
  const start = new Date(`${service.startDate}T12:00:00Z`);
  const end = new Date(`${service.endDate}T12:00:00Z`);
  if (end < start) return undefined;
  if (service.frequency.unit === 'day') return Math.floor((end - start) / 86400000 / interval) + 1;
  if (service.frequency.unit === 'week') return Math.floor((end - start) / (86400000 * 7) / interval) + 1;
  let visits = 1;
  const cursor = new Date(start);
  while (true) {
    cursor.setUTCMonth(cursor.getUTCMonth() + interval);
    if (cursor > end) break;
    visits += 1;
  }
  return visits;
}

export function normalizeEstimateService(service, index = 0, generateId) {
  const scheduleType = SERVICE_SCHEDULE_TYPES.includes(service?.scheduleType) ? service.scheduleType : 'recurring';
  const suggestedVisits = calculateSuggestedServiceVisits({ ...service, scheduleType });
  return {
    ...(service && typeof service === 'object' ? service : {}),
    id: isNonEmptyString(service?.id) ? service.id : generateId?.(),
    name: typeof service?.name === 'string' ? service.name : '',
    description: typeof service?.description === 'string' ? service.description : '',
    divisionId: isNonEmptyString(service?.divisionId) ? service.divisionId : undefined,
    sortOrder: Number.isFinite(service?.sortOrder) ? service.sortOrder : index,
    scheduleType,
    billingType: SERVICE_BILLING_TYPES.includes(service?.billingType) ? service.billingType : 'contract',
    startDate: dateOnly(service?.startDate) ? service.startDate : undefined,
    endDate: dateOnly(service?.endDate) ? service.endDate : undefined,
    frequency: scheduleType === 'recurring' ? {
      interval: Number.isInteger(service?.frequency?.interval) ? service.frequency.interval : 1,
      unit: SERVICE_FREQUENCY_UNITS.includes(service?.frequency?.unit) ? service.frequency.unit : 'week',
    } : undefined,
    estimatedVisits: Number.isFinite(service?.estimatedVisits)
      ? service.estimatedVisits
      : suggestedVisits,
    lineItems: Array.isArray(service?.lineItems) ? service.lineItems : [],
  };
}

export const normalizeEstimateServices = (services, generateId) => (Array.isArray(services) ? services : [])
  .filter((service) => service && typeof service === 'object' && !Array.isArray(service))
  .map((service, index) => normalizeEstimateService(service, index, generateId))
  .sort((left, right) => left.sortOrder - right.sortOrder)
  .map((service, sortOrder) => ({ ...service, sortOrder }));

export function validateEstimateService(service) {
  if (!service || typeof service !== 'object' || Array.isArray(service)) return 'Service is invalid.';
  if (!isNonEmptyString(service.id)) return 'Service id is required.';
  if (!isNonEmptyString(service.name)) return 'Service name is required.';
  if (service.description !== undefined && typeof service.description !== 'string') return 'Service description is invalid.';
  if (!SERVICE_SCHEDULE_TYPES.includes(service.scheduleType)) return 'Service schedule type is invalid.';
  if (!SERVICE_BILLING_TYPES.includes(service.billingType)) return 'Service billing type is invalid.';
  if (service.divisionId !== undefined && !isNonEmptyString(service.divisionId)) return 'Service division is invalid.';
  if (!Number.isInteger(service.sortOrder) || service.sortOrder < 0) return 'Service order is invalid.';
  if (service.estimatedVisits !== undefined && (!Number.isInteger(service.estimatedVisits) || service.estimatedVisits < 0)) return 'Estimated visits must be zero or greater.';
  if (service.startDate !== undefined && !dateOnly(service.startDate)) return 'Service start date is invalid.';
  if (service.endDate !== undefined && !dateOnly(service.endDate)) return 'Service end date is invalid.';
  if (service.startDate && service.endDate && service.endDate < service.startDate) return 'Service end date cannot precede its start date.';
  if (service.scheduleType === 'recurring') {
    if (!dateOnly(service.startDate) || !dateOnly(service.endDate)) return 'Recurring Services require valid start and end dates.';
    if (!Number.isInteger(service.frequency?.interval) || service.frequency.interval <= 0) return 'Service frequency interval must be greater than zero.';
    if (!SERVICE_FREQUENCY_UNITS.includes(service.frequency?.unit)) return 'Service frequency unit is invalid.';
  }
  if (service.scheduleType === 'one_time') {
    if (!dateOnly(service.startDate)) return 'One-time Services require an expected visit date.';
    if (service.estimatedVisits !== undefined && service.estimatedVisits !== 1) return 'One-time Services must have one estimated visit.';
  }
  if (service.scheduleType === 'as_needed') {
    return null;
  }
  return null;
}

export function validateEstimateServices(services) {
  if (!Array.isArray(services)) return 'Estimate Services must be an array.';
  const ids = new Set();
  for (const service of services) {
    const error = validateEstimateService(service);
    if (error) return error;
    if (ids.has(service.id)) return 'Service ids must be unique.';
    ids.add(service.id);
  }
  return null;
}