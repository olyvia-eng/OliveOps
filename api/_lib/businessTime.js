export const DEFAULT_BUSINESS_TIME_ZONE = 'America/Toronto';

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeBusinessTimeZone(value) {
  return isValidTimeZone(value) ? value.trim() : DEFAULT_BUSINESS_TIME_ZONE;
}

function localDateParts(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid instant is required.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeBusinessTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function getBusinessPeriodKeys(instant = new Date(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const { year, month, day } = localDateParts(instant, timeZone);
  const dateKey = `${year}-${month}-${day}`;
  const localDate = new Date(`${dateKey}T12:00:00.000Z`);
  const mondayOffset = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - mondayOffset);
  return {
    daily: dateKey,
    weekly: localDate.toISOString().slice(0, 10),
    monthly: `${year}-${month}`,
  };
}

export function getPeriodKeyForTrigger(trigger, instant = new Date(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const keys = getBusinessPeriodKeys(instant, timeZone);
  if (trigger === 'weekly') return keys.weekly;
  if (trigger === 'monthly') return keys.monthly;
  return keys.daily;
}