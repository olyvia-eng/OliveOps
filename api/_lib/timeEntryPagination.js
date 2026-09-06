import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { requireEnv } from './env.js';

export const TIME_ENTRY_INDEX_NAME = process.env.DDB_TIME_ENTRY_INDEX_NAME || 'TimeEntryChronologicalIndex';
export const TIME_ENTRY_INDEX_PK = 'timeEntryIndexPk';
export const TIME_ENTRY_INDEX_SK = 'timeEntryIndexSk';

const PAGE_SIZES = Object.freeze({
  reports: new Set([25, 50, 100]),
  job: new Set([10, 25, 50]),
});

const DEFAULT_PAGE_SIZE = Object.freeze({ reports: 25, job: 10 });
const WORK_TYPES = new Set(['job', 'drive_time', 'non_billable']);
const STATUSES = new Set(['clocked_in', 'clocked_out']);

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalDate(value, endOfDay = false) {
  const text = stringValue(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new TimeEntryPageError('time_entry_date_invalid', 'Date filters must use YYYY-MM-DD.');
  const timestamp = Date.parse(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (!Number.isFinite(timestamp)) throw new TimeEntryPageError('time_entry_date_invalid', 'Date filters are invalid.');
  return new Date(timestamp).toISOString();
}

function sortedUnique(values) {
  return [...new Set(values.map(stringValue).filter(Boolean))].sort();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function scopeDigest(scope) {
  return createHash('sha256').update(stableJson(scope)).digest('base64url');
}

function cursorSecret() {
  return requireEnv('JWT_SECRET');
}

function sign(encodedPayload) {
  return createHmac('sha256', cursorSecret()).update(encodedPayload).digest('base64url');
}

export class TimeEntryPageError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TimeEntryPageError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeTimeEntryPageQuery(query = {}, { surface, businessId, employeeIds = [], restrictToEmployeeIds = false }) {
  if (!PAGE_SIZES[surface] || !stringValue(businessId)) {
    throw new TimeEntryPageError('time_entry_scope_invalid', 'Time Entry page scope is invalid.');
  }

  const requestedLimit = query.limit === undefined || query.limit === ''
    ? DEFAULT_PAGE_SIZE[surface]
    : Number(query.limit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit > 100 || !PAGE_SIZES[surface].has(requestedLimit)) {
    throw new TimeEntryPageError('time_entry_limit_invalid', `Page size is not supported for ${surface === 'job' ? 'Job Time Entries' : 'Time Tracking'}.`);
  }

  const jobId = stringValue(query.jobId);
  if (surface === 'job' && !jobId) {
    throw new TimeEntryPageError('time_entry_job_required', 'A Job is required for Job Time Entries.');
  }
  const workType = stringValue(query.workType);
  if (workType && workType !== 'all' && !WORK_TYPES.has(workType)) {
    throw new TimeEntryPageError('time_entry_work_type_invalid', 'Activity filter is invalid.');
  }
  const status = stringValue(query.status);
  if (status && status !== 'all' && !STATUSES.has(status)) {
    throw new TimeEntryPageError('time_entry_status_invalid', 'Status filter is invalid.');
  }

  const filters = {
    startAt: optionalDate(query.startDate),
    endAt: optionalDate(query.endDate, true),
    employeeIds: sortedUnique(employeeIds),
    employeeFilterApplied: restrictToEmployeeIds || Boolean(stringValue(query.employeeId)),
    jobId: jobId || null,
    workAreaId: stringValue(query.workAreaId) || null,
    workType: workType && workType !== 'all' ? workType : null,
    unbillableCategoryId: stringValue(query.unbillableCategoryId) || null,
    status: status && status !== 'all' ? status : null,
    includeZero: stringValue(query.includeZero).toLowerCase() !== 'false',
  };
  if (filters.startAt && filters.endAt && filters.startAt > filters.endAt) {
    throw new TimeEntryPageError('time_entry_date_range_invalid', 'Start Date must be on or before End Date.');
  }

  const scope = { version: 2, surface, businessId: stringValue(businessId), filters };
  return { limit: requestedLimit, filters, scope, scopeHash: scopeDigest(scope) };
}

export function encodeTimeEntryCursor({ scopeHash, key }) {
  if (!stringValue(scopeHash) || !key || typeof key !== 'object') {
    throw new TimeEntryPageError('time_entry_cursor_invalid', 'Pagination cursor is invalid.');
  }
  const encodedPayload = Buffer.from(JSON.stringify({ version: 1, scopeHash, key }), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function decodeTimeEntryCursor(cursor, expectedScopeHash) {
  const value = stringValue(cursor);
  const [encodedPayload, signature, extra] = value.split('.');
  if (!encodedPayload || !signature || extra) {
    throw new TimeEntryPageError('time_entry_cursor_invalid', 'Pagination cursor is invalid.');
  }

  const expectedSignature = sign(encodedPayload);
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new TimeEntryPageError('time_entry_cursor_invalid', 'Pagination cursor is invalid.');
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload?.version !== 1 || payload.scopeHash !== expectedScopeHash || !payload.key || typeof payload.key !== 'object') {
      throw new Error('scope mismatch');
    }
    return payload.key;
  } catch {
    throw new TimeEntryPageError('time_entry_cursor_scope_mismatch', 'Pagination cursor does not match these filters.');
  }
}

function inverseId(value) {
  return Buffer.from(String(value ?? ''), 'utf8')
    .toJSON().data
    .map((byte) => (255 - byte).toString(16).padStart(2, '0'))
    .join('');
}

export function timeEntryOrderKey(entry) {
  const clockIn = Number.isFinite(Date.parse(entry?.clockIn ?? ''))
    ? new Date(entry.clockIn).toISOString()
    : new Date(0).toISOString();
  const createdAt = Number.isFinite(Date.parse(entry?.createdAt ?? ''))
    ? new Date(entry.createdAt).toISOString()
    : new Date(0).toISOString();
  const activeRank = entry?.status === 'clocked_in' ? '1' : '0';
  return `${activeRank}#${clockIn}#${createdAt}#${inverseId(entry?.id)}`;
}

export function timeEntryIndexAttributes(businessId, entry) {
  const clockIn = new Date(entry?.clockIn ?? '').toISOString();
  const createdAt = Number.isFinite(Date.parse(entry?.createdAt ?? ''))
    ? new Date(entry.createdAt).toISOString()
    : clockIn;
  const activeRank = entry?.status === 'clocked_in' ? '1' : '0';
  return {
    [TIME_ENTRY_INDEX_PK]: `BUSINESS#${businessId}#TIME_ENTRIES`,
    [TIME_ENTRY_INDEX_SK]: `${activeRank}#${clockIn}#${createdAt}#${inverseId(entry?.id)}`,
  };
}

export function matchesTimeEntryFilters(entry, filters) {
  const clockIn = typeof entry?.clockIn === 'string' ? entry.clockIn : '';
  if (!clockIn || (filters.startAt && clockIn < filters.startAt) || (filters.endAt && clockIn > filters.endAt)) return false;
  if (filters.employeeFilterApplied && !filters.employeeIds.includes(entry.employeeId)) return false;
  if (filters.jobId) {
    const jobIds = Array.isArray(entry.jobIds) && entry.jobIds.length > 0
      ? entry.jobIds
      : entry.jobId ? [entry.jobId] : [];
    if (entry.workType !== 'job' || !jobIds.includes(filters.jobId)) return false;
  }
  if (filters.workAreaId && entry.workAreaId !== filters.workAreaId) return false;
  if (filters.workType && (entry.workType ?? 'job') !== filters.workType) return false;
  if (filters.unbillableCategoryId) {
    if ((entry.workType ?? 'job') !== 'non_billable') return false;
    if (filters.unbillableCategoryId === 'uncategorized') {
      if (entry.unbillableCategoryId) return false;
    } else if (entry.unbillableCategoryId !== filters.unbillableCategoryId) return false;
  }
  if (filters.status && entry.status !== filters.status) return false;
  if (!filters.includeZero && entry.clockOut) {
    const duration = Date.parse(entry.clockOut) - Date.parse(entry.clockIn) - Number(entry.breakMinutes ?? 0) * 60_000;
    if (!Number.isFinite(duration) || duration <= 0) return false;
  }
  return true;
}