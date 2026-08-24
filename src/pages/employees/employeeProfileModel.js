export function scopeEmployeeProfileRecords({ employeeId, timeEntries, timeCorrections, formSubmissions, files = [] }) {
  return {
    timeEntries: timeEntries.filter((entry) => entry.employeeId === employeeId),
    timeCorrections: timeCorrections.filter((correction) => correction.employeeId === employeeId),
    formSubmissions: formSubmissions.filter((submission) => submission.employeeId === employeeId && submission.status !== 'draft'),
    files: files.filter((file) => file.entityType === 'employee' && file.entityId === employeeId),
  };
}

export function getEmployeeRangeStart(range, now = new Date()) {
  if (range === 'year-to-date') return new Date(now.getFullYear(), 0, 1);
  const start = new Date(now);
  start.setDate(start.getDate() - (range === '90-days' ? 89 : 29));
  start.setHours(0, 0, 0, 0);
  return start;
}