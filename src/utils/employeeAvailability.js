export function dateRangesOverlapInclusive(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function exclusiveEndDateKey(inclusiveEndDate) {
  const [year, month, day] = inclusiveEndDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getCrewEmployeeIds(crewId, crews) {
  if (!crewId) return [];
  const crew = crews.find((item) => item.id === crewId);
  if (!crew) return [];
  return [...new Set([crew.leadEmployeeId, ...(crew.memberIds ?? [])].filter(Boolean))];
}

export function getEmployeeTimeOffConflicts({ employeeIds, crewId, crews = [], startDate, endDate, approvedTimeOff = [] }) {
  if (!startDate || !endDate || endDate < startDate) return [];
  const selectedIds = new Set([...employeeIds, ...getCrewEmployeeIds(crewId, crews)]);
  return approvedTimeOff
    .filter((request) => request.status === 'approved'
      && selectedIds.has(request.employeeId)
      && dateRangesOverlapInclusive(request.startDate, request.endDate, startDate, endDate))
    .map((request) => ({
      requestId: request.id,
      employeeId: request.employeeId,
      employeeName: request.employeeName,
      requestType: request.requestType,
      startDate: request.startDate,
      endDate: request.endDate,
      fromCrew: !employeeIds.includes(request.employeeId) && getCrewEmployeeIds(crewId, crews).includes(request.employeeId),
    }));
}

export function getJobTimeOffConflicts(job, approvedTimeOff, crews = []) {
  return getEmployeeTimeOffConflicts({
    employeeIds: job.assignedEmployeeIds ?? [],
    crewId: job.crewId,
    crews,
    startDate: job.startDate,
    endDate: job.endDate || job.startDate,
    approvedTimeOff,
  });
}

export function normalizeTimeOffScheduleEntry(request, employee, divisionIds = []) {
  return {
    source: 'time_off',
    timeOffRequestId: request.id,
    title: `${employee?.name ?? request.employeeName ?? 'Employee'} — ${formatTimeOffType(request.requestType)}`,
    summary: 'Approved Time Off',
    timeLabel: '',
    status: 'approved',
    start: request.startDate,
    end: request.endDate,
    startKey: request.startDate,
    endKey: request.endDate,
    allDay: true,
    crew: null,
    division: null,
    divisionIds,
    employeeIds: [request.employeeId],
    equipmentIds: [],
    timeOffRequest: request,
  };
}

export function formatTimeOffType(value) {
  return String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}