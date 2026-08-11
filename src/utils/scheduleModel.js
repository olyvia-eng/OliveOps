import {
  GOOGLE_SCHEDULE_COLOUR,
  JOB_STATUS_COLOURS,
  NEUTRAL_SCHEDULE_COLOUR,
  SCHEDULE_COLOUR_PALETTE,
} from '../config/scheduleColours.js';

export const DEFAULT_CALENDAR_PREFERENCES = {
  view: 'week',
  colourBy: 'crew',
  showGoogleEvents: true,
};

const hash = (value) => [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0);
const byId = (values, id) => values.find((value) => value.id === id) ?? null;

export function normalizeCalendarPreferences(value) {
  return {
    view: ['month', 'week', 'day'].includes(value?.view) ? value.view : DEFAULT_CALENDAR_PREFERENCES.view,
    colourBy: ['crew', 'division', 'status'].includes(value?.colourBy) ? value.colourBy : DEFAULT_CALENDAR_PREFERENCES.colourBy,
    showGoogleEvents: typeof value?.showGoogleEvents === 'boolean' ? value.showGoogleEvents : DEFAULT_CALENDAR_PREFERENCES.showGoogleEvents,
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
  if (colourBy === 'status') return JOB_STATUS_COLOURS[job?.status] ?? NEUTRAL_SCHEDULE_COLOUR;
  const entity = colourBy === 'division' ? division : crew;
  if (!entity) return NEUTRAL_SCHEDULE_COLOUR;
  const configured = SCHEDULE_COLOUR_PALETTE.find((colour) => colour.value.toLowerCase() === String(entity.colour).toLowerCase());
  return configured ?? SCHEDULE_COLOUR_PALETTE[hash(entity.id) % SCHEDULE_COLOUR_PALETTE.length];
}

export function filterScheduleEntries(entries, filters) {
  return entries.filter((entry) => {
    if (entry.source === 'google') return filters.showGoogleEvents !== false;
    if (filters.divisionId && filters.divisionId !== 'all' && entry.division?.id !== filters.divisionId) return false;
    if (filters.resourceId && filters.resourceId !== 'all') {
      const [kind, id] = filters.resourceId.split(':');
      if (kind === 'crew' && entry.crew?.id !== id) return false;
      if (kind === 'employee' && !entry.employeeIds.includes(id)) return false;
    }
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