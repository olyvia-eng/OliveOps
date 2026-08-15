const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value, days) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getDataCenterDateRange(preset, now = new Date(), customStart = '', customEnd = '') {
  const today = startOfLocalDay(now);

  if (preset === 'quarter') {
    const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
    return { start: new Date(today.getFullYear(), quarterMonth, 1), end: new Date(today.getFullYear(), quarterMonth + 3, 1) };
  }
  if (preset === 'ytd') {
    return { start: new Date(today.getFullYear(), 0, 1), end: addDays(today, 1) };
  }
  if (preset === 'last_year') {
    return { start: new Date(today.getFullYear() - 1, 0, 1), end: new Date(today.getFullYear(), 0, 1) };
  }
  if (preset === 'custom') {
    const parsedStart = parseDate(customStart) ?? today;
    const parsedEnd = parseDate(customEnd) ?? parsedStart;
    return { start: startOfLocalDay(parsedStart), end: addDays(startOfLocalDay(parsedEnd), 1) };
  }

  return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 1, 1) };
}

export function isInDataCenterDateRange(value, range) {
  const date = parseDate(value);
  return Boolean(date && date >= range.start && date < range.end);
}

function overlapsRange(startValue, endValue, range) {
  const start = parseDate(startValue);
  const rawEnd = parseDate(endValue || startValue);
  if (!start || !rawEnd) return false;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endValue || startValue)
    ? new Date(rawEnd.getTime() + DAY_MS)
    : rawEnd;
  return start < range.end && end >= range.start;
}

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resolveBudgetDivisionId(budget, divisions) {
  if (!budget) return '';
  const divisionValue = normalized(budget.division);
  return divisions.find((division) => division.id === budget.division
    || normalized(division.name) === divisionValue
    || normalized(division.normalizedName) === divisionValue)?.id ?? '';
}

function jobDivisionId(job, budgetById, divisions) {
  if (job.divisionId) return job.divisionId;
  return resolveBudgetDivisionId(budgetById.get(job.pricingBudgetId), divisions);
}

function estimateDivisionId(estimate, budgetById, divisions) {
  return resolveBudgetDivisionId(budgetById.get(estimate.pricingBudgetId), divisions);
}

export function getTimeEntryHours(entry, range, now = new Date()) {
  const rawStart = parseDate(entry.clockIn);
  const rawEnd = parseDate(entry.clockOut) ?? now;
  if (!rawStart || !rawEnd) return 0;
  const start = Math.max(rawStart.getTime(), range.start.getTime());
  const end = Math.min(rawEnd.getTime(), range.end.getTime(), now.getTime());
  if (end <= start) return 0;
  const breakMs = Math.max(0, Number(entry.breakMinutes) || 0) * 60 * 1000;
  return Math.max(0, end - start - breakMs) / (60 * 60 * 1000);
}

export function getEstimateValue(estimate) {
  const subtotal = (Array.isArray(estimate.lineItems) ? estimate.lineItems : [])
    .reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  return subtotal * (1 + (Number(estimate.taxRate) || 0) / 100);
}

export function filterDataCenterRecords(input) {
  const {
    divisionId = 'all', range, divisions = [], budgets = [], customers = [], estimates = [], jobs = [],
    invoices = [], expenses = [], employees = [], timeEntries = [], equipmentAssets = [],
  } = input;
  const budgetById = new Map(budgets.map((budget) => [budget.id, budget]));
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const matchesDivision = (candidateDivisionId) => divisionId === 'all' || candidateDivisionId === divisionId;
  const divisionJobIds = new Set(jobs
    .filter((job) => matchesDivision(jobDivisionId(job, budgetById, divisions)))
    .map((job) => job.id));

  const filteredJobs = jobs.filter((job) => job.status !== 'cancelled'
    && overlapsRange(job.scheduledStartAt || job.startDate, job.scheduledEndAt || job.endDate || job.startDate, range)
    && divisionJobIds.has(job.id));
  const filteredJobIds = new Set(filteredJobs.map((job) => job.id));

  const filteredEstimates = estimates.filter((estimate) => isInDataCenterDateRange(estimate.createdAt, range)
    && matchesDivision(estimateDivisionId(estimate, budgetById, divisions)));
  const filteredInvoices = invoices.filter((invoice) => isInDataCenterDateRange(invoice.issueDate || invoice.createdAt, range)
    && (divisionId === 'all' || divisionJobIds.has(invoice.jobId)));
  const filteredExpenses = expenses.filter((expense) => isInDataCenterDateRange(expense.expenseDate || expense.createdAt, range)
    && (divisionId === 'all' || (expense.jobId && divisionJobIds.has(expense.jobId))));
  const filteredTimeEntries = timeEntries.filter((entry) => {
    if (getTimeEntryHours(entry, range) <= 0) return false;
    if (divisionId === 'all') return true;
    const entryJobIds = Array.isArray(entry.jobIds) && entry.jobIds.length > 0 ? entry.jobIds : [entry.jobId].filter(Boolean);
    return entryJobIds.some((jobId) => divisionJobIds.has(jobId));
  });

  const equipmentIds = new Set(filteredJobs.flatMap((job) => Array.isArray(job.assignedEquipmentIds) ? job.assignedEquipmentIds : []));
  const filteredEquipment = equipmentAssets.filter((asset) => equipmentIds.has(asset.id));
  const activeEmployeeIds = new Set(filteredTimeEntries.map((entry) => entry.employeeId));
  const filteredEmployees = employees.filter((employee) => activeEmployeeIds.has(employee.id));
  const activeCustomerIds = new Set([
    ...filteredJobs.map((job) => job.customerId),
    ...filteredEstimates.map((estimate) => estimate.customerId),
    ...filteredInvoices.map((invoice) => invoice.customerId),
  ]);
  const filteredCustomers = customers.filter((customer) => activeCustomerIds.has(customer.id)
    || (divisionId === 'all' && isInDataCenterDateRange(customer.createdAt, range)));

  return {
    customers: filteredCustomers,
    estimates: filteredEstimates,
    jobs: filteredJobs,
    invoices: filteredInvoices,
    expenses: filteredExpenses,
    employees: filteredEmployees,
    timeEntries: filteredTimeEntries,
    equipmentAssets: filteredEquipment,
    jobById,
  };
}
