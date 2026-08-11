const ENTITY_READ_ROLES = {
  budgets: ['owner', 'admin', 'foreman', 'crew_member'],
  'budget-groups': ['owner', 'admin', 'foreman', 'crew_member'],
  'equipment-budget-allocations': ['owner', 'admin', 'foreman'],
  customers: ['owner', 'admin', 'foreman', 'crew_member'],
  jobs: ['owner', 'admin', 'foreman', 'crew_member'],
  estimates: ['owner', 'admin', 'foreman'],
  templates: ['owner', 'admin', 'foreman'],
  invoices: ['owner', 'admin', 'foreman'],
  expenses: ['owner', 'admin', 'foreman'],
  forms: ['owner', 'admin', 'foreman', 'crew_member'],
  'form-fields': ['owner', 'admin', 'foreman'],
  'form-submissions': ['owner', 'admin', 'foreman', 'crew_member'],
  'form-responses': ['owner', 'admin', 'foreman', 'crew_member'],
  budget: ['owner', 'admin', 'foreman'],
  'budget-rates': ['owner', 'admin', 'foreman'],
  'labour-budget-plans': ['owner', 'admin', 'foreman'],
  'labour-hours-sales-goals': ['owner', 'admin', 'foreman'],
  'revenue-sales-goals': ['owner', 'admin', 'foreman'],
  employees: ['owner', 'admin', 'foreman', 'crew_member'],
  'equipment-assets': ['owner', 'admin', 'foreman'],
  'material-catalog-items': ['owner', 'admin', 'foreman'],
  'unbillable-time-categories': ['owner', 'admin', 'foreman', 'crew_member'],
  feedback: ['owner', 'admin', 'foreman', 'crew_member'],
  tasks: ['owner', 'admin', 'foreman', 'crew_member'],
  'time-entries': ['owner', 'admin', 'foreman', 'crew_member'],
  'time-corrections': ['owner', 'admin', 'crew_member'],
  'audit-events': ['owner', 'admin'],
};

const ENTITY_WRITE_ROLES = {
  budgets: ['owner', 'admin', 'foreman'],
  'budget-groups': ['owner', 'admin', 'foreman'],
  'equipment-budget-allocations': ['owner', 'admin', 'foreman'],
  customers: ['owner', 'admin', 'foreman'],
  jobs: ['owner', 'admin', 'foreman'],
  estimates: ['owner', 'admin', 'foreman'],
  templates: ['owner', 'admin'],
  invoices: ['owner', 'admin'],
  expenses: ['owner', 'admin', 'foreman'],
  forms: ['owner', 'admin'],
  'form-fields': ['owner', 'admin'],
  'form-submissions': ['owner', 'admin', 'foreman', 'crew_member'],
  'form-responses': ['owner', 'admin', 'foreman', 'crew_member'],
  budget: ['owner', 'admin', 'foreman'],
  'budget-rates': ['owner', 'admin'],
  'labour-budget-plans': ['owner', 'admin'],
  'labour-hours-sales-goals': ['owner', 'admin'],
  'revenue-sales-goals': ['owner', 'admin'],
  employees: ['owner', 'admin', 'foreman'],
  'equipment-assets': ['owner', 'admin', 'foreman'],
  'material-catalog-items': ['owner', 'admin', 'foreman'],
  'unbillable-time-categories': ['owner', 'admin'],
  feedback: ['owner', 'admin', 'foreman', 'crew_member'],
  tasks: ['owner', 'admin', 'foreman', 'crew_member'],
  'time-entries': ['owner', 'admin', 'foreman'],
  'time-corrections': ['owner', 'admin', 'crew_member'],
  'audit-events': ['owner', 'admin'],
};

function normalizeRole(role) {
  if (role === 'employee') return 'crew_member';
  if (role === 'worker' || role === 'subcontractor') return 'crew_member';
  return role;
}

export function canReadEntity(entity, role) {
  const normalizedRole = normalizeRole(role);
  return !!ENTITY_READ_ROLES[entity]?.includes(normalizedRole);
}

export function canWriteEntity(entity, role) {
  const normalizedRole = normalizeRole(role);
  return !!ENTITY_WRITE_ROLES[entity]?.includes(normalizedRole);
}

export function authorizeRecordAccess(session, entity, record) {
  if (!session || !record) return false;
  const role = normalizeRole(session.role);

  if (entity === 'time-corrections') {
    if (role === 'owner' || role === 'admin') return true;
    if (!session.employeeId) return false;
    return record.employeeId === session.employeeId;
  }

  if (role === 'owner' || role === 'admin') return true;
  if (role === 'foreman') return true;

  if (entity === 'employees') {
    return record.id === session.employeeId;
  }

  if (entity === 'time-entries' || entity === 'form-submissions' || entity === 'form-responses') {
    return record.employeeId === session.employeeId;
  }

  if (entity === 'jobs') {
    const assignedEmployeeIds = Array.isArray(record.assignedEmployeeIds)
      ? record.assignedEmployeeIds
      : [];
    return assignedEmployeeIds.includes(session.employeeId);
  }

  if (entity === 'tasks') {
    return record.assignedUserId === session.id || record.createdByUserId === session.id;
  }

  if (entity === 'feedback') {
    return record.submittedByUserId === session.id;
  }

  return false;
}

export function canClockForEmployee(session, employeeId) {
  if (!session || typeof employeeId !== 'string') return false;

  const role = normalizeRole(session.role);
  if (role === 'owner' || role === 'admin') return true;
  if (role !== 'crew_member') return false;

  return typeof session.employeeId === 'string' && session.employeeId === employeeId;
}

export function filterRecordsForSession(session, entity, records) {
  if (!Array.isArray(records)) return [];
  const role = normalizeRole(session.role);

  if (entity === 'time-corrections') {
    if (role === 'owner' || role === 'admin') return records;
    if (!session.employeeId) return [];
    return records.filter((record) => record.employeeId === session.employeeId);
  }

  if (role === 'owner' || role === 'admin' || role === 'foreman') return records;

  return records.filter((record) => authorizeRecordAccess(session, entity, record));
}
