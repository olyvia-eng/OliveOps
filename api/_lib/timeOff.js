import { createHash } from 'node:crypto';

export const TIME_OFF_REQUEST_TYPES = new Set(['vacation', 'sick', 'personal', 'unpaid', 'other']);
export const TIME_OFF_STATUSES = new Set(['pending', 'approved', 'denied', 'cancelled']);
export const MAX_TIME_OFF_NOTE_LENGTH = 2000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function normalizeTimeOffCreationInput(input = {}) {
  return {
    requestType: typeof input.requestType === 'string' ? input.requestType.trim().toLowerCase() : '',
    startDate: typeof input.startDate === 'string' ? input.startDate.trim() : '',
    endDate: typeof input.endDate === 'string' ? input.endDate.trim() : '',
    employeeNote: typeof input.employeeNote === 'string' ? input.employeeNote.trim() : '',
    idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '',
  };
}

export function validateTimeOffCreationInput(input) {
  if (!TIME_OFF_REQUEST_TYPES.has(input.requestType)) return 'Request type is invalid.';
  if (!isCalendarDate(input.startDate)) return 'Start date must be a valid calendar date in YYYY-MM-DD format.';
  if (!isCalendarDate(input.endDate)) return 'End date must be a valid calendar date in YYYY-MM-DD format.';
  if (input.endDate < input.startDate) return 'End date must be on or after start date.';
  if (input.employeeNote.length > MAX_TIME_OFF_NOTE_LENGTH) return `Employee note must be ${MAX_TIME_OFF_NOTE_LENGTH} characters or fewer.`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.idempotencyKey)) return 'Idempotency key is required and must be 1 to 128 safe characters.';
  return null;
}

export function timeOffPayloadFingerprint(input) {
  return createHash('sha256').update(JSON.stringify({
    requestType: input.requestType,
    startDate: input.startDate,
    endDate: input.endDate,
    employeeNote: input.employeeNote,
  })).digest('hex');
}

export function dateRangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function approvedTimeOffOverlapping(requests, startDate, endDate) {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) return [];
  return requests.filter((request) => request.status === 'approved' && dateRangesOverlap(request.startDate, request.endDate, startDate, endDate));
}

export function safeEmployeeTimeOffRequest(request) {
  return {
    id: request.id,
    requestType: request.requestType,
    startDate: request.startDate,
    endDate: request.endDate,
    employeeNote: request.employeeNote,
    status: request.status,
    submittedAt: request.submittedAt,
    reviewedAt: request.reviewedAt,
    reviewNote: request.reviewNote,
    cancelledAt: request.cancelledAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
