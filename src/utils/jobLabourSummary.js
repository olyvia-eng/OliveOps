import { calculateEmployeeLabourCost } from './employeeLabourCost.js';
import { buildEffectiveTimeEntries } from '../../api/_lib/timeCorrections.js';

const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const optionalNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const uniqueStrings = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()))];

const entryJobIds = (entry) => uniqueStrings(Array.isArray(entry.jobIds) && entry.jobIds.length ? entry.jobIds : entry.jobId ? [entry.jobId] : []);

const durationHours = (startValue, endValue, breakMinutes = 0) => {
  const start = Date.parse(startValue ?? '');
  const end = Date.parse(endValue ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, (end - start) / 3600000 - number(breakMinutes) / 60);
};

const scheduleOccurrences = (job) => {
  if (Array.isArray(job.scheduleOccurrences) && job.scheduleOccurrences.length) return job.scheduleOccurrences;
  if (job.scheduleConfirmed !== true) return [];
  return [{
    id: `job:${job.id}`,
    scheduledStartAt: job.scheduledStartAt,
    scheduledEndAt: job.scheduledEndAt,
    scheduleAllDay: job.scheduleAllDay,
    assignedEmployeeIds: job.assignedEmployeeIds,
  }];
};

const employeeCostRate = (employee) => {
  if (!employee) return null;
  const calculated = calculateEmployeeLabourCost(employee);
  return optionalNumber(calculated.labourCostPerPaidHour);
};

const classIdentity = (labourClassId, labourClassName, classById) => {
  if (!labourClassId) return { id: 'unassigned', name: labourClassName || 'Unassigned' };
  return { id: labourClassId, name: labourClassName || classById.get(labourClassId)?.name || 'Inactive Labour Class' };
};

const addBreakdown = (map, identity, values) => {
  const current = map.get(identity.id) ?? { id: identity.id, name: identity.name, estimatedHours: 0, estimatedCost: 0, estimatedRevenue: 0, scheduledHours: 0, scheduledCost: 0, scheduledCostAvailable: true, actualHours: 0, actualCost: 0, actualCostAvailable: true };
  for (const [key, value] of Object.entries(values)) current[key] += value;
  map.set(identity.id, current);
};

const totals = (hours, cost, revenue, hasData, costAvailable = true, hoursAvailable = true, reason) => ({
  hours,
  cost: costAvailable ? cost : null,
  ...(revenue !== undefined ? { revenue } : {}),
  hasData,
  hoursAvailable,
  costAvailable,
  ...(reason ? { unavailableReason: reason } : {}),
});

const variance = (comparison, baseline) => ({
  hours: comparison.hoursAvailable && baseline.hoursAvailable ? comparison.hours - baseline.hours : null,
  cost: comparison.cost !== null && baseline.cost !== null ? comparison.cost - baseline.cost : null,
});

export function calculateJobLabourSummary({ job, employees = [], labourClasses = [], timeEntries = [], timeCorrections = [] }) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const classById = new Map(labourClasses.map((labourClass) => [labourClass.id, labourClass]));
  const byClass = new Map();
  const scheduledByEmployee = new Map();
  const actualByEmployee = new Map();

  let estimatedHours = 0;
  let estimatedCost = 0;
  let estimatedRevenue = 0;
  const estimatedLines = (job.operationalWorkAreas ?? []).flatMap((area) => area.lineItems ?? []).filter((line) => line.category === 'labour');
  for (const line of estimatedLines) {
    const hours = Math.max(0, number(line.quantity));
    const costRate = optionalNumber(line.averageLabourCost) ?? Math.max(0, number(line.unitCost));
    const cost = optionalNumber(line.estimatedCost) ?? hours * costRate;
    const revenue = optionalNumber(line.estimatedSell) ?? optionalNumber(line.total) ?? hours * Math.max(0, number(line.sellPrice));
    estimatedHours += hours;
    estimatedCost += cost;
    estimatedRevenue += revenue;
    addBreakdown(byClass, classIdentity(line.labourClassId, line.labourClassName || line.employeeName || line.itemName, classById), {
      estimatedHours: hours,
      estimatedCost: cost,
      estimatedRevenue: revenue,
    });
  }

  let scheduledHours = 0;
  let scheduledCost = 0;
  let scheduledCostAvailable = true;
  let scheduledDurationUnavailable = false;
  for (const occurrence of scheduleOccurrences(job)) {
    if (occurrence.scheduleAllDay !== false) {
      scheduledDurationUnavailable = true;
      scheduledCostAvailable = false;
      continue;
    }
    const hours = durationHours(occurrence.scheduledStartAt, occurrence.scheduledEndAt, occurrence.breakMinutes);
    if (hours === null) {
      scheduledDurationUnavailable = true;
      scheduledCostAvailable = false;
      continue;
    }
    for (const employeeId of uniqueStrings(occurrence.assignedEmployeeIds)) {
      const employee = employeeById.get(employeeId);
      const costRate = employeeCostRate(employee);
      const cost = costRate === null ? 0 : hours * costRate;
      scheduledHours += hours;
      scheduledCost += cost;
      if (costRate === null) scheduledCostAvailable = false;
      const identity = classIdentity(employee?.labourClassId, undefined, classById);
      addBreakdown(byClass, identity, { scheduledHours: hours, scheduledCost: cost });
      if (costRate === null) byClass.get(identity.id).scheduledCostAvailable = false;
      const row = scheduledByEmployee.get(employeeId) ?? { employeeId, employeeName: employee?.name ?? 'Unknown Employee', labourClassId: identity.id, labourClassName: identity.name, hours: 0, cost: 0, costRate, costAvailable: costRate !== null };
      row.hours += hours;
      row.cost += cost;
      row.costAvailable = row.costAvailable && costRate !== null;
      scheduledByEmployee.set(employeeId, row);
    }
  }

  let actualHours = 0;
  let actualCost = 0;
  let actualCostAvailable = true;
  const effectiveEntries = buildEffectiveTimeEntries(timeEntries, timeCorrections);
  for (const entry of effectiveEntries) {
    if (entry.status !== 'clocked_out' || entry.workType !== 'job' || !entry.clockOut) continue;
    const jobIds = entryJobIds(entry);
    if (!jobIds.includes(job.id)) continue;
    const fullHours = durationHours(entry.clockIn, entry.clockOut, entry.breakMinutes);
    if (fullHours === null) continue;
    const divisor = jobIds.length || 1;
    const hours = fullHours / divisor;
    const employee = employeeById.get(entry.employeeId);
    const fallbackRate = employeeCostRate(employee);
    const snapshotRate = optionalNumber(entry.labourCostRateSnapshot);
    const snapshotTotal = optionalNumber(entry.labourCostTotalSnapshot);
    const costRate = snapshotRate ?? (snapshotTotal !== null && fullHours > 0 ? snapshotTotal / fullHours : fallbackRate);
    const cost = snapshotRate !== null
      ? hours * snapshotRate
      : snapshotTotal !== null
        ? snapshotTotal / divisor
        : fallbackRate !== null ? hours * fallbackRate : 0;
    actualHours += hours;
    actualCost += cost;
    if (snapshotTotal === null && costRate === null) actualCostAvailable = false;
    const identity = classIdentity(employee?.labourClassId, undefined, classById);
    addBreakdown(byClass, identity, { actualHours: hours, actualCost: cost });
    if (snapshotTotal === null && costRate === null) byClass.get(identity.id).actualCostAvailable = false;
    const row = actualByEmployee.get(entry.employeeId) ?? { employeeId: entry.employeeId, employeeName: employee?.name ?? 'Unknown Employee', labourClassId: identity.id, labourClassName: identity.name, hours: 0, cost: 0, costRate, costAvailable: snapshotTotal !== null || costRate !== null };
    row.hours += hours;
    row.cost += cost;
    row.costAvailable = row.costAvailable && (snapshotTotal !== null || costRate !== null);
    actualByEmployee.set(entry.employeeId, row);
  }

  const estimated = totals(estimatedHours, estimatedCost, estimatedRevenue, estimatedLines.length > 0);
  const scheduled = totals(scheduledHours, scheduledCost, undefined, scheduleOccurrences(job).length > 0, scheduledCostAvailable, !scheduledDurationUnavailable, scheduledDurationUnavailable ? 'Scheduled duration is unavailable for one or more occurrences.' : undefined);
  const actual = totals(actualHours, actualCost, undefined, actualHours > 0, actualCostAvailable, true, actualCostAvailable ? undefined : 'Employee labour cost is unavailable for one or more Time Entries.');
  return {
    estimated,
    scheduled,
    actual,
    variance: {
      scheduledVsEstimated: variance(scheduled, estimated),
      actualVsEstimated: variance(actual, estimated),
      actualVsScheduled: variance(actual, scheduled),
    },
    byLabourClass: [...byClass.values()].sort((left, right) => left.name.localeCompare(right.name)),
    scheduledEmployees: [...scheduledByEmployee.values()].sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
    actualEmployees: [...actualByEmployee.values()].sort((left, right) => left.employeeName.localeCompare(right.employeeName)),
  };
}