const DAY_MS = 24 * 60 * 60 * 1000;

export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalDayRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function getLocalWeekRange(now = new Date()) {
  const { start: dayStart } = getLocalDayRange(now);
  const mondayOffset = (dayStart.getDay() + 6) % 7;
  const start = new Date(dayStart.getTime() - mondayOffset * DAY_MS);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

export function resolveSessionEmployee({ employees = [], userId, email }) {
  const byUserId = employees.find((employee) => employee.active && employee.userId === userId);
  if (byUserId) return byUserId;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail) return null;
  return employees.find((employee) => employee.active && employee.email?.trim().toLowerCase() === normalizedEmail) ?? null;
}

export function getPersonalJobs({ jobs = [], crews = [], employeeId }) {
  if (!employeeId) return [];
  const crewIds = new Set(crews
    .filter((crew) => crew.active === true
      && (crew.leadEmployeeId === employeeId || (Array.isArray(crew.memberIds) && crew.memberIds.includes(employeeId))))
    .map((crew) => crew.id));
  return jobs.filter((job) => (Array.isArray(job.assignedEmployeeIds) && job.assignedEmployeeIds.includes(employeeId))
    || (job.crewId && crewIds.has(job.crewId)));
}

export function getPersonalTasks(tasks = [], userId) {
  return tasks.filter((task) => task.assignedUserId === userId);
}

export function filterTasksByRange(tasks, filter, now = new Date()) {
  const todayKey = localDateKey(now);
  const { start: weekStart, end: weekEnd } = getLocalWeekRange(now);
  const weekStartKey = localDateKey(weekStart);
  const weekEndKey = localDateKey(new Date(weekEnd.getTime() - 1));
  return tasks.filter((task) => {
    if (filter === 'completed') return task.status === 'completed';
    if (filter === 'today') return task.dueDate === todayKey && (task.status === 'open' || task.status === 'completed');
    if (task.status !== 'open') return false;
    if (filter === 'overdue') return Boolean(task.dueDate && task.dueDate < todayKey);
    if (filter === 'week') return Boolean(task.dueDate && task.dueDate >= weekStartKey && task.dueDate <= weekEndKey);
    return true;
  });
}

export function getTaskSummary(tasks, now = new Date()) {
  const dueToday = filterTasksByRange(tasks, 'today', now).filter((task) => task.status === 'open');
  const overdue = filterTasksByRange(tasks, 'overdue', now);
  return {
    dueToday: dueToday.length,
    highPriorityDueToday: dueToday.filter((task) => task.priority === 'high').length,
    overdue: overdue.length,
  };
}

function getJobWindow(job) {
  const startValue = job.scheduledStartAt || job.startDate;
  const endValue = job.scheduledEndAt || job.endDate || job.startDate;
  const start = new Date(startValue);
  let end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (!job.scheduledEndAt && /^\d{4}-\d{2}-\d{2}$/.test(endValue)) end = new Date(end.getTime() + DAY_MS);
  return { start, end };
}

export function getJobsThisWeek(jobs, now = new Date()) {
  const range = getLocalWeekRange(now);
  return jobs.filter((job) => {
    const window = getJobWindow(job);
    return job.status !== 'cancelled' && window && window.start < range.end && window.end > range.start;
  });
}

export function getHoursLoggedToday(timeEntries, employeeId, now = new Date()) {
  if (!employeeId) return 0;
  const range = getLocalDayRange(now);
  const totalMs = timeEntries
    .filter((entry) => entry.employeeId === employeeId)
    .reduce((sum, entry) => {
      const rawStart = new Date(entry.clockIn).getTime();
      const rawEnd = entry.clockOut ? new Date(entry.clockOut).getTime() : now.getTime();
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return sum;
      const start = Math.max(rawStart, range.start.getTime());
      const end = Math.min(rawEnd, range.end.getTime(), now.getTime());
      if (end <= start) return sum;
      const breakMs = Math.max(0, Number(entry.breakMinutes) || 0) * 60 * 1000;
      return sum + Math.max(0, end - start - breakMs);
    }, 0);
  return Math.round((totalMs / (60 * 60 * 1000)) * 100) / 100;
}

function formatCustomerAddress(address) {
  if (typeof address === 'string') return address;
  if (!address || typeof address !== 'object') return '';
  return [address.street, address.city, address.province, address.postalCode].filter(Boolean).join(', ');
}

export function buildUpcomingItems({ jobs = [], tasks = [], externalEvents = [], customers = [], now = new Date(), limit = 5 }) {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const items = [];
  for (const job of jobs) {
    const window = getJobWindow(job);
    if (!window || window.end <= now || job.status === 'cancelled') continue;
    const customer = customerById.get(job.customerId);
    items.push({ id: `job:${job.id}`, kind: 'job', title: job.title, start: window.start.toISOString(), end: window.end.toISOString(), location: job.propertyAddressSnapshot || formatCustomerAddress(customer?.address), jobId: job.id });
  }
  for (const task of tasks) {
    if (!task.dueDate || task.status !== 'open') continue;
    const due = new Date(`${task.dueDate}T12:00:00`);
    if (due < getLocalDayRange(now).start) continue;
    items.push({ id: `task:${task.id}`, kind: 'task', title: task.title, start: due.toISOString(), allDay: true, taskId: task.id });
  }
  for (const event of externalEvents) {
    const end = new Date(event.end);
    if (!Number.isFinite(end.getTime()) || end <= now) continue;
    items.push({ id: `external:${event.provider}:${event.externalEventId}`, kind: 'external', title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location, provider: event.provider });
  }
  return items.sort((left, right) => Date.parse(left.start) - Date.parse(right.start)).slice(0, limit);
}

export function buildRecentActivity({ jobs = [], tasks = [], timeEntries = [], corrections = [], employeeId, limit = 5 }) {
  const items = [
    ...tasks.map((task) => ({ id: `task:${task.id}`, kind: 'task', title: task.status === 'completed' ? `Completed ${task.title}` : `Task updated: ${task.title}`, timestamp: task.completedAt || task.updatedAt })),
    ...jobs.map((job) => ({ id: `job:${job.id}`, kind: 'job', title: `Job updated: ${job.title}`, timestamp: job.updatedAt })),
    ...timeEntries.filter((entry) => entry.employeeId === employeeId).map((entry) => ({ id: `time:${entry.id}`, kind: 'time', title: entry.status === 'clocked_in' ? 'Clocked in' : 'Time entry submitted', timestamp: entry.clockOut || entry.clockIn })),
    ...corrections.filter((correction) => correction.employeeId === employeeId).map((correction) => ({ id: `correction:${correction.id}`, kind: 'correction', title: `Time correction ${correction.status}`, timestamp: correction.reviewedAt || correction.updatedAt || correction.submittedAt })),
  ];
  return items.filter((item) => Number.isFinite(Date.parse(item.timestamp || '')))
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, limit);
}
