import { getTimeEntryPresentation } from '../../utils/timeEntryPresentation.js';

export function buildClockedInNowItems(entries, employees, jobs) {
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  return entries
    .filter((entry) => entry.status === 'clocked_in' && !entry.clockOut)
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

export function formatClockedInElapsed(clockIn, now = Date.now()) {
  const startedAt = Date.parse(clockIn ?? '');
  if (!Number.isFinite(startedAt)) return '0m';
  const totalMinutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}