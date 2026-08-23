const METRIC_KEYS = ['revenue', 'labourCost', 'equipmentCost', 'materialCost', 'subcontractorCost', 'overhead', 'netProfit', 'netProfitMargin'];

const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const inPeriod = (value, period) => {
  const date = dateOnly(value);
  return date !== null && date >= period.startDate && date <= period.endDate;
};
const isoDate = (date) => date.toISOString().slice(0, 10);

export function buildBudgetMonthPeriods(budget) {
  const start = dateOnly(budget.startDate) ?? `${budget.fiscalYear}-01-01`;
  const end = dateOnly(budget.endDate) ?? `${budget.fiscalYear}-12-31`;
  if (end < start) return [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00.000Z`);
  const endMonth = end.slice(0, 7);
  const periods = [];
  while (isoDate(cursor).slice(0, 7) <= endMonth) {
    const key = isoDate(cursor).slice(0, 7);
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const calendarEnd = new Date(next.getTime() - 86400000);
    periods.push({
      key,
      label: cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      shortLabel: cursor.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      startDate: key === start.slice(0, 7) ? start : `${key}-01`,
      endDate: key === end.slice(0, 7) ? end : isoDate(calendarEnd),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const duplicateLabels = new Set(periods.filter((period, index) => periods.some((other, otherIndex) => otherIndex !== index && other.shortLabel === period.shortLabel)).map((period) => period.shortLabel));
  return periods.map((period) => ({ ...period, tabLabel: duplicateLabels.has(period.shortLabel) ? period.label : period.shortLabel }));
}

const entryJobIds = (entry) => Array.isArray(entry.jobIds) && entry.jobIds.length > 0 ? [...new Set(entry.jobIds)] : entry.jobId ? [entry.jobId] : [];
const durationHours = (entry) => {
  if (!entry.clockOut) return 0;
  const start = new Date(entry.clockIn).getTime();
  const end = new Date(entry.clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, (end - start) / 3600000 - number(entry.breakMinutes) / 60);
};

const categoryForMetric = {
  equipmentCost: 'equipment',
  materialCost: 'material',
  subcontractorCost: 'subcontractor',
};

function recordedJobCost(job, category, period) {
  return (job.actualCosts ?? []).filter((cost) => cost.category === category && inPeriod(cost.date, period)).reduce((sum, cost) => sum + number(cost.total), 0);
}

function expenseCost(expenses, jobId, category, period) {
  const expenseCategory = category === 'material' ? 'materials' : category;
  return expenses.filter((expense) => expense.jobId === jobId && expense.category === expenseCategory && expense.status !== 'pending' && inPeriod(expense.expenseDate, period)).reduce((sum, expense) => sum + number(expense.amount), 0);
}

function trackedLabourCost({ job, period, timeEntries, employeeRates }) {
  return timeEntries.reduce((sum, entry) => {
    if (entry.workType !== 'job' || !inPeriod(entry.clockIn, period)) return sum;
    const jobIds = entryJobIds(entry);
    if (!jobIds.includes(job.id)) return sum;
    return sum + durationHours(entry) * (employeeRates.get(entry.employeeId) ?? 0) / jobIds.length;
  }, 0);
}

function metricTotal(values) {
  return values.some((value) => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
}

export function calculateDivisionMonthlyFinancials({ budget, divisionId, jobs, invoices, timeEntries, employees, expenses = [] }) {
  const periods = buildBudgetMonthPeriods(budget);
  const divisionJobs = jobs.filter((job) => job.pricingBudgetId === budget.id && job.divisionId === divisionId);
  const jobIds = new Set(divisionJobs.map((job) => job.id));
  const employeeRates = new Map(employees.map((employee) => [employee.id, number(employee.hourlyRate)]));
  const hasLinkedOverhead = expenses.some((expense) => jobIds.has(expense.jobId) && expense.category === 'overhead' && expense.status !== 'pending' && periods.some((period) => inPeriod(expense.expenseDate, period)));
  const sourceStatus = {
    revenue: { availability: 'available', note: 'Issued invoices for Jobs in this Budget Division.' },
    labourCost: { availability: 'partial', note: 'Recorded Job labour costs; closed time entries at base hourly wage are used when recorded labour is absent.' },
    equipmentCost: { availability: 'partial', note: 'Recorded Job equipment costs or Job-linked approved/paid expenses only.' },
    materialCost: { availability: 'partial', note: 'Recorded Job material costs or Job-linked approved/paid expenses only.' },
    subcontractorCost: { availability: 'partial', note: 'Recorded Job subcontractor costs or Job-linked approved/paid expenses only.' },
    overhead: hasLinkedOverhead
      ? { availability: 'partial', note: 'Job-linked approved/paid overhead expenses only; unlinked company overhead cannot be allocated to a Division.' }
      : { availability: 'unavailable', note: 'Actual data unavailable. Overhead is planned annually and unlinked expenses cannot be allocated to a Division.' },
  };

  const months = periods.map((period) => {
    const revenue = invoices.filter((invoice) => jobIds.has(invoice.jobId) && invoice.status !== 'draft' && inPeriod(invoice.issueDate, period)).reduce((sum, invoice) => sum + number(invoice.amount), 0);
    const labourCost = divisionJobs.reduce((sum, job) => {
      const recorded = recordedJobCost(job, 'labour', period);
      return sum + (recorded > 0 ? recorded : trackedLabourCost({ job, period, timeEntries, employeeRates }));
    }, 0);
    const categoryValues = Object.fromEntries(Object.entries(categoryForMetric).map(([metric, category]) => [metric, divisionJobs.reduce((sum, job) => {
      const recorded = recordedJobCost(job, category, period);
      return sum + (recorded > 0 ? recorded : expenseCost(expenses, job.id, category, period));
    }, 0)]));
    const overhead = hasLinkedOverhead ? divisionJobs.reduce((sum, job) => sum + expenseCost(expenses, job.id, 'overhead', period), 0) : null;
    const totalCosts = metricTotal([labourCost, categoryValues.equipmentCost, categoryValues.materialCost, categoryValues.subcontractorCost, overhead]);
    const netProfit = totalCosts === null ? null : revenue - totalCosts;
    const netProfitMargin = netProfit !== null && revenue > 0 ? netProfit / revenue * 100 : null;
    return { ...period, revenue, labourCost, ...categoryValues, overhead, netProfit, netProfitMargin };
  });

  return { periods, months, sourceStatus };
}

export function aggregateDivisionFinancialPeriods(months, endIndex) {
  const included = months.slice(0, Math.max(0, endIndex) + 1);
  const result = { key: 'ytd', label: 'YTD', shortLabel: 'YTD', tabLabel: 'YTD', startDate: included[0]?.startDate ?? '', endDate: included.at(-1)?.endDate ?? '' };
  for (const key of METRIC_KEYS.filter((metric) => metric !== 'netProfitMargin')) result[key] = metricTotal(included.map((month) => month[key]));
  result.netProfitMargin = result.netProfit !== null && result.revenue > 0 ? result.netProfit / result.revenue * 100 : null;
  return result;
}

export function compareDivisionFinancialPeriods(selected, previous) {
  return Object.fromEntries(METRIC_KEYS.map((key) => {
    if (!previous || selected[key] === null || previous[key] === null) return [key, null];
    if (key === 'netProfitMargin') return [key, selected[key] - previous[key]];
    if (previous[key] === 0) return [key, selected[key] === 0 ? 0 : null];
    return [key, (selected[key] - previous[key]) / Math.abs(previous[key]) * 100];
  }));
}

export { METRIC_KEYS };