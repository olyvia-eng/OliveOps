import {
  getJobForBusiness,
  listEmployeesForBusiness,
  listTimeCorrectionsForBusiness,
  listTimeEntryPageForBusiness,
} from './_lib/authRepo.js';
import { authorizeRecordAccess } from './_lib/authorization.js';
import { listCrewsForBusiness } from './_lib/schedulingConfig.js';
import { requireSession } from './_lib/session.js';
import { buildEffectiveTimeEntries } from './_lib/timeCorrections.js';
import {
  decodeTimeEntryCursor,
  encodeTimeEntryCursor,
  normalizeTimeEntryPageQuery,
  TimeEntryPageError,
} from './_lib/timeEntryPagination.js';

const EXPORT_ENTRY_LIMIT = 10_000;
const EXPORT_BYTE_LIMIT = 5 * 1024 * 1024;

function queryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedQuery(query = {}) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, queryValue(value)]));
}

function effectiveEntryTransform(corrections) {
  return (entry) => buildEffectiveTimeEntries([entry], corrections.filter((correction) => correction.timeEntryId === entry.id))[0] ?? entry;
}

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function durationHours(entry) {
  if (!entry.clockOut) return 0;
  return Math.max(0, (Date.parse(entry.clockOut) - Date.parse(entry.clockIn)) / 3_600_000 - Number(entry.breakMinutes ?? 0) / 60);
}

function exportCsv(entries, employees, query) {
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const totals = new Map();
  for (const entry of entries) {
    const current = totals.get(entry.employeeId) ?? { total: 0, job: 0, drive_time: 0, non_billable: 0 };
    const workType = entry.workType === 'drive_time' || entry.workType === 'non_billable' ? entry.workType : 'job';
    const hours = durationHours(entry);
    current.total += hours;
    current[workType] += hours;
    totals.set(entry.employeeId, current);
  }
  const rows = [...totals.entries()]
    .map(([employeeId, values]) => ({ employeeId, name: employeeNames.get(employeeId) ?? 'Unknown', ...values }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
  const metadata = [
    ['Report', 'Bookkeeper Time Summary'],
    ['Generated At', new Date().toISOString()],
    ['Start Date', query.startDate ?? ''],
    ['End Date', query.endDate ?? ''],
    ['Activity', query.workType || 'All Types'],
    ['Job', query.jobId || 'All Jobs'],
    ['Employee', query.employeeId ? employeeNames.get(query.employeeId) ?? 'Unknown' : 'All Employees'],
    ['Matching Entries', entries.length],
    [],
  ];
  const body = rows.map((row) => [row.name, row.total.toFixed(2), row.job.toFixed(2), row.drive_time.toFixed(2), row.non_billable.toFixed(2)]);
  return [...metadata, ['Employee', 'Total Hours', 'Job Hours', 'Drive Time Hours', 'Non-Billable Hours'], ...body]
    .map((row) => row.map(csvValue).join(','))
    .join('\r\n');
}

export function createTimeEntriesHandler(dependencyOverrides = {}) {
  const dependencies = {
    requireSession,
    getJobForBusiness,
    listCrewsForBusiness,
    listEmployeesForBusiness,
    listTimeCorrectionsForBusiness,
    listTimeEntryPageForBusiness,
    ...dependencyOverrides,
  };

  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    const session = await dependencies.requireSession(req, res, undefined, 'time-entries');
    if (!session) return;

    try {
      const query = normalizedQuery(req.query);
      const surface = query.surface === 'job' ? 'job' : 'reports';
      if (surface === 'reports' && session.role !== 'owner' && session.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (surface === 'job') {
        const [job, crews] = await Promise.all([
          dependencies.getJobForBusiness(session.businessId, query.jobId),
          dependencies.listCrewsForBusiness(session.businessId),
        ]);
        if (!job || !authorizeRecordAccess(session, 'jobs', job, { crews })) {
          return res.status(404).json({ ok: false, error: 'Job not found.' });
        }
      }

      const [employees, corrections] = await Promise.all([
        dependencies.listEmployeesForBusiness(session.businessId),
        dependencies.listTimeCorrectionsForBusiness(session.businessId),
      ]);
      const requestedEmployeeId = typeof query.employeeId === 'string' ? query.employeeId.trim() : '';
      if (requestedEmployeeId && !employees.some((employee) => employee.id === requestedEmployeeId)) {
        throw new TimeEntryPageError('time_entry_employee_invalid', 'Employee filter is invalid.');
      }
      const canReadAllEmployees = session.role === 'owner' || session.role === 'admin' || session.role === 'foreman';
      const employeeIds = canReadAllEmployees
        ? requestedEmployeeId ? [requestedEmployeeId] : []
        : requestedEmployeeId
          ? requestedEmployeeId === session.employeeId ? [requestedEmployeeId] : []
          : session.employeeId ? [session.employeeId] : [];
      const pageQuery = normalizeTimeEntryPageQuery(query, {
        surface,
        businessId: session.businessId,
        employeeIds,
        restrictToEmployeeIds: !canReadAllEmployees,
      });
      let exclusiveStartKey = query.action !== 'export' && query.cursor
        ? decodeTimeEntryCursor(query.cursor, pageQuery.scopeHash)
        : undefined;
      const transformEntry = effectiveEntryTransform(corrections);

      if (query.action === 'export') {
        const entries = [];
        let truncated = false;
        while (entries.length < EXPORT_ENTRY_LIMIT) {
          const page = await dependencies.listTimeEntryPageForBusiness({
            businessId: session.businessId,
            filters: pageQuery.filters,
            limit: Math.min(100, EXPORT_ENTRY_LIMIT - entries.length),
            exclusiveStartKey,
            transformEntry,
          });
          entries.push(...page.items);
          if (!page.hasMore || !page.lastEvaluatedKey) break;
          if (entries.length >= EXPORT_ENTRY_LIMIT) truncated = true;
          exclusiveStartKey = page.lastEvaluatedKey;
        }
        if (truncated) {
          return res.status(413).json({ ok: false, code: 'time_entry_export_too_large', error: 'Export exceeds the 10,000-entry safety limit. Use a shorter date range.' });
        }
        const csv = exportCsv(entries, employees, query);
        if (Buffer.byteLength(csv, 'utf8') > EXPORT_BYTE_LIMIT) {
          return res.status(413).json({ ok: false, code: 'time_entry_export_too_large', error: 'Export exceeds the 5 MB safety limit. Use a shorter date range.' });
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="time-summary-${query.startDate || 'all'}-to-${query.endDate || 'all'}.csv"`);
        return res.status(200).send(csv);
      }

      const page = await dependencies.listTimeEntryPageForBusiness({
        businessId: session.businessId,
        filters: pageQuery.filters,
        limit: pageQuery.limit,
        exclusiveStartKey,
        transformEntry,
      });
      return res.status(200).json({
        ok: true,
        items: page.items,
        hasMore: page.hasMore,
        nextCursor: page.hasMore && page.lastEvaluatedKey
          ? encodeTimeEntryCursor({ scopeHash: pageQuery.scopeHash, key: page.lastEvaluatedKey })
          : null,
      });
    } catch (error) {
      if (error instanceof TimeEntryPageError) {
        return res.status(error.status).json({ ok: false, code: error.code, error: error.message });
      }
      console.error('Time Entry page request failed', error);
      return res.status(500).json({ ok: false, error: 'Could not load Time Entries.' });
    }
  };
}

export default createTimeEntriesHandler();