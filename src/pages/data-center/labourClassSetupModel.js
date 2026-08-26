export function normalizeLabourClassName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
}

export function suggestLabourClassName(employee) {
  if (!employee || employee.active === false || employee.labourType === 'overhead') return null;
  if (employee.role === 'foreman') return 'Foreman';
  if (employee.role === 'crew_member') return 'Labourer';
  return null;
}

export function shouldOfferLabourClassSetup({ employees = [], labourClasses = [], planningItems = [] }) {
  const activeEmployees = employees.filter((employee) => employee.active !== false);
  if (activeEmployees.length === 0) return false;

  const activeClassIds = new Set(
    labourClasses.filter((labourClass) => labourClass.active !== false).map((labourClass) => labourClass.id),
  );
  const hasFieldEmployees = activeEmployees.some((employee) => employee.labourType !== 'overhead');
  if (hasFieldEmployees && activeClassIds.size === 0) return true;

  const employeeById = new Map(activeEmployees.map((employee) => [employee.id, employee]));
  return planningItems.some((item) => {
    if (item.category !== 'labour' || !item.employeeId) return false;
    const employee = employeeById.get(item.employeeId);
    return Boolean(employee && (!employee.labourClassId || !activeClassIds.has(employee.labourClassId)));
  });
}

export function buildLabourClassSetupDraft({ employees = [], labourClasses = [] }) {
  const activeClassIds = new Set(
    labourClasses.filter((labourClass) => labourClass.active !== false).map((labourClass) => labourClass.id),
  );
  const activeClassesByName = new Map(
    labourClasses
      .filter((labourClass) => labourClass.active !== false)
      .map((labourClass) => [normalizeLabourClassName(labourClass.name), labourClass]),
  );
  const classes = [];
  const assignments = {};

  for (const employee of employees.filter((item) => item.active !== false && (!item.labourClassId || !activeClassIds.has(item.labourClassId)))) {
    const suggestion = suggestLabourClassName(employee);
    if (!suggestion) {
      assignments[employee.id] = null;
      continue;
    }
    const normalizedName = normalizeLabourClassName(suggestion);
    const existing = activeClassesByName.get(normalizedName);
    const classKey = existing ? `existing:${existing.id}` : `new:${normalizedName}`;
    if (!classes.some((item) => item.key === classKey)) {
      classes.push({ key: classKey, id: existing?.id ?? null, name: existing?.name ?? suggestion });
    }
    assignments[employee.id] = classKey;
  }

  return { classes, assignments };
}

export function mergeLabourClassSetupGroups(classes) {
  const seen = new Map();
  return classes.reduce((groups, labourClass) => {
    const normalizedName = normalizeLabourClassName(labourClass.name);
    if (!normalizedName || seen.has(normalizedName)) return groups;
    seen.set(normalizedName, labourClass.key);
    groups.push({ ...labourClass, name: labourClass.name.trim().replace(/\s+/g, ' ') });
    return groups;
  }, []);
}