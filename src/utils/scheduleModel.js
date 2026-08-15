import {
  GOOGLE_SCHEDULE_COLOUR,
  JOB_STATUS_COLOURS,
  NEUTRAL_SCHEDULE_COLOUR,
  SCHEDULE_COLOUR_PALETTE,
  OUTLOOK_SCHEDULE_COLOUR,
} from '../config/scheduleColours.js';

export const DEFAULT_CALENDAR_PREFERENCES = {
  view: 'week',
  colourBy: 'crew',
  showGoogleEvents: true,
  showOutlookEvents: true,
};

const hash = (value) => [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0);
const byId = (values, id) => values.find((value) => value.id === id) ?? null;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const localDateKey = (value) => {
  if (dateOnlyPattern.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftDateKey = (value, amount) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
};

export function normalizeCalendarPreferences(value) {
  return {
    view: ['month', 'week', 'day'].includes(value?.view) ? value.view : DEFAULT_CALENDAR_PREFERENCES.view,
    colourBy: ['crew', 'division', 'status'].includes(value?.colourBy) ? value.colourBy : DEFAULT_CALENDAR_PREFERENCES.colourBy,
    showGoogleEvents: typeof value?.showGoogleEvents === 'boolean' ? value.showGoogleEvents : DEFAULT_CALENDAR_PREFERENCES.showGoogleEvents,
    showOutlookEvents: typeof value?.showOutlookEvents === 'boolean' ? value.showOutlookEvents : DEFAULT_CALENDAR_PREFERENCES.showOutlookEvents,
  };
}

export function getEffectiveDivision(job, divisions, budgets) {
  const direct = job.divisionId ? byId(divisions, job.divisionId) : null;
  if (direct) return direct;
  const legacyName = job.pricingBudgetId ? byId(budgets, job.pricingBudgetId)?.division : '';
  if (!legacyName) return null;
  const normalized = legacyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return divisions.find((division) => division.normalizedName === normalized) ?? {
    id: `legacy:${normalized}`,
    name: legacyName,
    normalizedName: normalized,
    colour: '',
    active: true,
    sortOrder: Number.MAX_SAFE_INTEGER,
  };
}

export function resolveScheduleColour({ source = 'oliveops', colourBy, job, crew, division }) {
  if (source === 'google') return GOOGLE_SCHEDULE_COLOUR;
  if (source === 'microsoft') return OUTLOOK_SCHEDULE_COLOUR;
  if (colourBy === 'status') return JOB_STATUS_COLOURS[job?.status] ?? NEUTRAL_SCHEDULE_COLOUR;
  const entity = colourBy === 'division' ? division : crew;
  if (!entity) return NEUTRAL_SCHEDULE_COLOUR;
  const configured = SCHEDULE_COLOUR_PALETTE.find((colour) => colour.value.toLowerCase() === String(entity.colour).toLowerCase());
  return configured ?? SCHEDULE_COLOUR_PALETTE[hash(entity.id) % SCHEDULE_COLOUR_PALETTE.length];
}

export function filterScheduleEntries(entries, filters) {
  return entries.filter((entry) => {
    if (entry.source === 'google') return filters.showGoogleEvents !== false;
    if (entry.source === 'external') {
      if (entry.provider === 'google') return filters.showGoogleEvents !== false;
      if (entry.provider === 'microsoft') return filters.showOutlookEvents !== false;
      return false;
    }
    if (filters.divisionId && filters.divisionId !== 'all' && entry.division?.id !== filters.divisionId) return false;
    if (filters.resourceId && filters.resourceId !== 'all') {
      const [kind, id] = filters.resourceId.split(':');
      if (kind === 'crew' && entry.crew?.id !== id) return false;
      if (kind === 'employee' && !entry.employeeIds.includes(id)) return false;
    }
    if (filters.crewId && filters.crewId !== 'all' && entry.crew?.id !== filters.crewId) return false;
    if (filters.employeeId && filters.employeeId !== 'all' && !entry.employeeIds.includes(filters.employeeId)) return false;
    if (filters.status && filters.status !== 'all' && entry.status !== filters.status) return false;
    if (filters.jobId && filters.jobId !== 'all' && entry.jobId !== filters.jobId) return false;
    if (filters.equipmentId && filters.equipmentId !== 'all' && !entry.equipmentIds.includes(filters.equipmentId)) return false;
    return true;
  });
}

export function getScheduleLegend(entries, colourBy) {
  const seen = new Map();
  for (const entry of entries) {
    if (entry.source !== 'oliveops') continue;
    const entity = colourBy === 'crew' ? entry.crew : colourBy === 'division' ? entry.division : { id: entry.status, name: entry.status };
    const key = entity?.id ?? 'unassigned';
    if (seen.has(key)) continue;
    seen.set(key, {
      id: key,
      label: entity?.name ?? 'Unassigned',
      colour: resolveScheduleColour({ colourBy, job: { status: entry.status }, crew: entry.crew, division: entry.division }),
    });
  }
  return [...seen.values()];
}

export function groupScheduleEntriesByDay(entries, dayKeys) {
  return dayKeys.map((dayKey) => ({
    dayKey,
    entries: entries.filter((entry) => entry.startKey <= dayKey && entry.endKey >= dayKey),
  }));
}

export function normalizeExternalScheduleEntry(event) {
  const startKey = localDateKey(event.start);
  const rawEndKey = localDateKey(event.end) || startKey;
  const endKey = event.allDay && rawEndKey > startKey ? shiftDateKey(rawEndKey, -1) : rawEndKey;
  const timeLabel = event.allDay ? '' : [event.start, event.end]
    .map((value) => new Date(value).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }))
    .join(' - ');
  return {
    source: 'external',
    provider: event.provider,
    externalEventId: event.externalEventId,
    externalCalendarId: event.externalCalendarId,
    title: event.title,
    status: event.status,
    start: event.start,
    end: event.end,
    startKey,
    endKey: endKey < startKey ? startKey : endKey,
    allDay: event.allDay,
    timeLabel,
    location: event.location,
    crew: null,
    division: null,
    employeeIds: [],
    equipmentIds: [],
    externalEvent: event,
  };
}

export function normalizeGoogleScheduleEntry(event) {
  return normalizeExternalScheduleEntry({
    externalEventId: event.googleEventId,
    externalCalendarId: event.googleCalendarId,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location,
    status: event.status,
    htmlLink: event.htmlLink,
    provider: 'google',
    sourceLabel: 'Google Calendar',
  });
}

export function buildWeeklyScheduleSpans(entries, dayKeys) {
  if (dayKeys.length === 0) return [];
  const firstDay = dayKeys[0];
  const lastDay = dayKeys[dayKeys.length - 1];
  return entries
    .filter((entry) => entry.startKey <= lastDay && entry.endKey >= firstDay)
    .map((entry) => {
      const clippedStartKey = entry.startKey < firstDay ? firstDay : entry.startKey;
      const clippedEndKey = entry.endKey > lastDay ? lastDay : entry.endKey;
      const startIndex = dayKeys.indexOf(clippedStartKey);
      const endIndex = dayKeys.indexOf(clippedEndKey);
      return {
        entry,
        startColumn: startIndex + 1,
        endColumn: endIndex + 1,
        columnSpan: endIndex - startIndex + 1,
        continuesBefore: entry.startKey < firstDay,
        continuesAfter: entry.endKey > lastDay,
      };
    })
    .filter((span) => span.startColumn > 0 && span.endColumn > 0)
    .sort((left, right) => left.startColumn - right.startColumn || right.endColumn - left.endColumn);
}

export function packWeeklyScheduleSpans(spans) {
  const rowEnds = [];
  return spans.map((span) => {
    let row = rowEnds.findIndex((endColumn) => endColumn < span.startColumn);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = span.endColumn;
    return { ...span, row };
  });
}