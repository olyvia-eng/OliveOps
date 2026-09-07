const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALL_WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);
const MONDAY_TO_FRIDAY = new Set([1, 2, 3, 4, 5]);

const parseDateKey = (value) => {
  if (!DATE_KEY_PATTERN.test(String(value))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
};

const formatDateKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

export const scheduleIncludesWeekends = (schedule) => schedule?.includeWeekends !== false;

export const getScheduleWorkingWeekdays = (schedule) => scheduleIncludesWeekends(schedule) ? ALL_WEEKDAYS : MONDAY_TO_FRIDAY;

export function isScheduleDateIncluded(schedule, dateKey) {
  const start = parseDateKey(schedule?.startDate);
  const end = parseDateKey(schedule?.endDate || schedule?.startDate);
  const date = parseDateKey(dateKey);
  if (!start || !end || !date || end < start || date < start || date > end) return false;
  return getScheduleWorkingWeekdays(schedule).has(date.getUTCDay());
}

export function getScheduleDateKeys(schedule) {
  const start = parseDateKey(schedule?.startDate);
  const end = parseDateKey(schedule?.endDate || schedule?.startDate);
  if (!start || !end || end < start) return [];
  const keys = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateKey = formatDateKey(date);
    if (isScheduleDateIncluded(schedule, dateKey)) keys.push(dateKey);
  }
  return keys;
}

export const scheduleHasWorkingDays = (schedule) => getScheduleDateKeys(schedule).length > 0;

export function scheduleDateRangesOverlap(left, right) {
  const startDate = String(left?.startDate) > String(right?.startDate) ? left?.startDate : right?.startDate;
  const leftEnd = left?.endDate || left?.startDate;
  const rightEnd = right?.endDate || right?.startDate;
  const endDate = String(leftEnd) < String(rightEnd) ? leftEnd : rightEnd;
  if (!startDate || !endDate || endDate < startDate) return false;
  return getScheduleDateKeys({ startDate, endDate, includeWeekends: true })
    .some((dateKey) => isScheduleDateIncluded(left, dateKey) && isScheduleDateIncluded(right, dateKey));
}

export function getScheduleDateSegments(schedule) {
  const dateKeys = getScheduleDateKeys(schedule);
  if (dateKeys.length === 0) return [];
  const segments = [];
  let startKey = dateKeys[0];
  let endKey = dateKeys[0];
  for (const dateKey of dateKeys.slice(1)) {
    const expected = parseDateKey(endKey);
    expected.setUTCDate(expected.getUTCDate() + 1);
    if (dateKey === formatDateKey(expected)) {
      endKey = dateKey;
      continue;
    }
    segments.push({ startKey, endKey });
    startKey = dateKey;
    endKey = dateKey;
  }
  segments.push({ startKey, endKey });
  return segments;
}