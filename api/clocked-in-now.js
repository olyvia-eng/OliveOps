import { requireSession } from './_lib/session.js';
import {
  listEmployeesForBusiness,
  listJobsForBusiness,
} from './_lib/authRepo.js';
import { listActiveTimeEntriesForBusiness } from './_lib/clocking.js';
import { getTimeEntryPresentation } from '../src/utils/timeEntryPresentation.js';

export function buildClockedInNowItems(entries, employees, jobs) {
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));

  return entries
    .filter((entry) => entry.status === 'clocked_in')
    .map((entry) => {
      const presentation = getTimeEntryPresentation(entry, jobs);
      const supportedWorkType = entry.workType === 'job' || entry.workType === 'drive_time' || entry.workType === 'non_billable';
      return {
        id: entry.id,
        employeeId: entry.employeeId,
        employeeName: employeeNames.get(entry.employeeId) || entry.employeeName || 'Employee',
        contextLabel: supportedWorkType
          ? entry.workType === 'non_billable' ? presentation.activityLabel : presentation.workLabel
          : 'Clocked In',
        clockIn: entry.clockIn,
      };
    })
    .sort((left, right) => Date.parse(left.clockIn) - Date.parse(right.clockIn) || left.employeeName.localeCompare(right.employeeName));
}

export function createClockedInNowHandler(dependencyOverrides = {}) {
  const dependencies = {
    requireSession,
    listActiveTimeEntriesForBusiness,
    listEmployeesForBusiness,
    listJobsForBusiness,
    ...dependencyOverrides,
  };

  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const session = await dependencies.requireSession(req, res, ['owner', 'admin']);
    if (!session) return;

    try {
      const employees = await dependencies.listEmployeesForBusiness(session.businessId);
      const [entries, jobs] = await Promise.all([
        dependencies.listActiveTimeEntriesForBusiness({ businessId: session.businessId, employeeIds: employees.map((employee) => employee.id) }),
        dependencies.listJobsForBusiness(session.businessId),
      ]);
      return res.status(200).json({ ok: true, items: buildClockedInNowItems(entries, employees, jobs) });
    } catch (error) {
      console.error('Clocked In Now request failed', error);
      return res.status(500).json({ ok: false, error: 'Could not load active employees.' });
    }
  };
}

export default createClockedInNowHandler();