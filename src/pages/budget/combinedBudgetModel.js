const BUDGET_CATEGORIES = ['revenue', 'labour', 'materials', 'equipment', 'subcontractors', 'overhead', 'marketing', 'insurance', 'other'];
const DEFAULT_WORKING_DAYS_YEAR = 260;

const normalizeEquipmentCostType = (value) => {
  if (value === 'financed' || value === 'leased' || value === 'owned') return value;
  return 'owned';
};

const compareBudgetItemsByCostCode = (a, b) => {
  const aCode = a.costCode?.trim() ?? '';
  const bCode = b.costCode?.trim() ?? '';

  if (!aCode && !bCode) {
    return a.description.localeCompare(b.description, undefined, { sensitivity: 'base' });
  }
  if (!aCode) return 1;
  if (!bCode) return -1;

  const byCode = aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
  if (byCode !== 0) return byCode;

  return a.description.localeCompare(b.description, undefined, { sensitivity: 'base' });
};

const toOptionLabel = (value) => value
  .split('_')
  .join(' ')
  .split(' ')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatBudgetTabLabel = (value) => {
  switch (value) {
    case 'analysis':
      return 'Analysis';
    case 'revenue':
      return 'Revenue';
    case 'labour':
      return 'Labour';
    case 'materials':
      return 'Materials';
    case 'equipment':
      return 'Equipment';
    case 'subcontractors':
      return 'Subcontractors';
    case 'overhead':
      return 'Overhead';
    default:
      return toOptionLabel(value);
  }
};

const isSalariedCompType = (value) => value === 'salaried' || value === 'salary';

const buildLabourPlanId = (budgetId, employeeId, year) => `${budgetId}-${employeeId}-${year}`;

const defaultLabourPlan = (budgetId, employeeId, year, hourlyRate, role) => ({
  id: buildLabourPlanId(budgetId, employeeId, year),
  budgetId,
  employeeId,
  year,
  compType: 'hourly',
  roleTitle: toOptionLabel(role),
  hoursPerYear: 1900,
  billablePct: 84,
  overtimeFactorPct: 0,
  payrollBurdenPct: 18,
  benefitsExtraCost: 0,
  bonus: 0,
  billableHoursYear: 1600,
  unbillableHoursYear: 300,
  overtimeHoursYear: 0,
  overtimeMultiplier: 1.5,
  hourlyRate,
  annualSalary: Math.round(hourlyRate * 2080),
  labourBurdenPct: 18,
});

const getLegacyScope = ({ budgets, budgetItems, labourBudgetPlans, revenueSalesGoals }) => {
  const hasAnyScopedBudgetData = budgetItems.some((item) => Boolean(item.budgetId))
    || labourBudgetPlans.some((plan) => Boolean(plan.budgetId))
    || revenueSalesGoals.some((goal) => Boolean(goal.budgetId));

  const legacyOwnerBudgetId = budgets.length === 0
    ? null
    : budgets
        .slice()
        .sort((a, b) => (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt))[0]?.id ?? null;

  return { hasAnyScopedBudgetData, legacyOwnerBudgetId };
};

const includeLegacyUnscopedData = ({ budgetId, legacyScope }) => {
  return Boolean(budgetId) && !legacyScope.hasAnyScopedBudgetData && budgetId === legacyScope.legacyOwnerBudgetId;
};

const getScopedBudgetItemsForBudget = ({ budgetId, budgetItems, legacyScope }) => {
  if (!budgetId) return [];
  const includeLegacy = includeLegacyUnscopedData({ budgetId, legacyScope });
  return budgetItems.filter((item) => item.budgetId === budgetId || (includeLegacy && !item.budgetId));
};

const getScopedLabourPlansForBudget = ({ budgetId, labourBudgetPlans, legacyScope }) => {
  if (!budgetId) return [];
  const includeLegacy = includeLegacyUnscopedData({ budgetId, legacyScope });
  return labourBudgetPlans.filter((plan) => plan.budgetId === budgetId || (includeLegacy && !plan.budgetId));
};

const getScopedRevenueGoalsForBudget = ({ budgetId, revenueSalesGoals, legacyScope }) => {
  if (!budgetId) return [];
  const includeLegacy = includeLegacyUnscopedData({ budgetId, legacyScope });
  return revenueSalesGoals.filter((goal) => goal.budgetId === budgetId || (includeLegacy && !goal.budgetId));
};

const groupBudgetItemsByCategory = (items) => {
  return BUDGET_CATEGORIES.reduce((acc, category) => {
    acc[category] = items.filter((item) => item.category === category);
    return acc;
  }, {});
};

const buildTotalsByCategory = (grouped) => {
  const sum = (category) => ({
    budgeted: grouped[category].reduce((value, item) => value + item.budgeted, 0),
    actual: grouped[category].reduce((value, item) => value + item.actual, 0),
  });

  return {
    revenue: sum('revenue'),
    labour: sum('labour'),
    materials: sum('materials'),
    equipment: sum('equipment'),
    subcontractors: sum('subcontractors'),
    overhead: {
      budgeted: grouped.overhead.reduce((value, item) => value + item.budgeted, 0)
        + grouped.marketing.reduce((value, item) => value + item.budgeted, 0)
        + grouped.insurance.reduce((value, item) => value + item.budgeted, 0)
        + grouped.other.reduce((value, item) => value + item.budgeted, 0),
      actual: grouped.overhead.reduce((value, item) => value + item.actual, 0)
        + grouped.marketing.reduce((value, item) => value + item.actual, 0)
        + grouped.insurance.reduce((value, item) => value + item.actual, 0)
        + grouped.other.reduce((value, item) => value + item.actual, 0),
    },
  };
};

const buildCategoryRows = (grouped) => {
  return BUDGET_CATEGORIES.map((category) => {
    const catItems = grouped[category];
    const budgeted = catItems.reduce((sum, item) => sum + item.budgeted, 0);
    const actual = catItems.reduce((sum, item) => sum + item.actual, 0);
    const variance = category === 'revenue' ? actual - budgeted : budgeted - actual;
    return { category, budgeted, actual, variance, count: catItems.length };
  }).filter((row) => row.count > 0);
};

const buildEquipmentByCostType = (equipmentItems) => {
  const totalFor = (costType) => ({
    budgeted: equipmentItems
      .filter((item) => normalizeEquipmentCostType(item.equipmentCostType) === costType)
      .reduce((sum, item) => sum + item.budgeted, 0),
    actual: equipmentItems
      .filter((item) => normalizeEquipmentCostType(item.equipmentCostType) === costType)
      .reduce((sum, item) => sum + item.actual, 0),
  });

  return {
    financed: totalFor('financed'),
    leased: totalFor('leased'),
    owned: totalFor('owned'),
  };
};

const buildLabourPlannerRowsForBudget = ({ budget, year, employees, scopedLabourPlans }) => {
  return employees
    .filter((employee) => employee.active)
    .map((employee) => {
      const plan = scopedLabourPlans.find((value) => value.employeeId === employee.id && value.year === year)
        ?? defaultLabourPlan(budget.id, employee.id, year, employee.hourlyRate, employee.role);
      const isSalariedEmployee = isSalariedCompType(plan.compType) || employee.compensationType === 'salary';
      const hoursPerYear = Math.max(0, Number.isFinite(plan.hoursPerYear ?? 0) ? (plan.hoursPerYear ?? 0) : 0);
      const fallbackBillablePct = (plan.billableHoursYear / Math.max(1, plan.billableHoursYear + plan.unbillableHoursYear + plan.overtimeHoursYear)) * 100;
      const billablePct = Math.max(0, Math.min(100, Number.isFinite(plan.billablePct ?? fallbackBillablePct) ? (plan.billablePct ?? fallbackBillablePct) : 0));
      const annualBillableHours = hoursPerYear * (billablePct / 100);
      const hourlyWage = Math.max(0, Number.isFinite(plan.hourlyRate) ? plan.hourlyRate : 0);
      const annualSalary = Math.max(0, Number.isFinite(plan.annualSalary) ? plan.annualSalary : (employee.compensationType === 'salary' ? employee.hourlyRate : 0));
      const annualBasePay = isSalariedEmployee ? annualSalary : hourlyWage * hoursPerYear;
      const overtimeHoursYear = Math.max(0, Math.min(hoursPerYear, Number.isFinite(plan.overtimeHoursYear ?? 0) ? (plan.overtimeHoursYear ?? 0) : 0));
      const overtimeMultiplier = Math.max(1, Number.isFinite(plan.overtimeMultiplier ?? 1.5) ? (plan.overtimeMultiplier ?? 1.5) : 1.5);
      const overtimeCost = isSalariedEmployee ? 0 : hourlyWage * overtimeHoursYear * (overtimeMultiplier - 1);
      const payrollBurdenPct = Math.max(0, Number.isFinite(plan.payrollBurdenPct ?? plan.labourBurdenPct ?? 0) ? (plan.payrollBurdenPct ?? plan.labourBurdenPct ?? 0) : 0);
      const benefitsExtraCost = Math.max(0, Number.isFinite(plan.benefitsExtraCost ?? 0) ? (plan.benefitsExtraCost ?? 0) : 0);
      const bonus = Math.max(0, Number.isFinite(plan.bonus ?? 0) ? (plan.bonus ?? 0) : 0);
      const payrollBurdenAmount = (annualBasePay + overtimeCost) * (payrollBurdenPct / 100);
      const totalEmployeeCostPerYear = annualBasePay + overtimeCost + payrollBurdenAmount + benefitsExtraCost + bonus;

      return {
        budgetId: budget.id,
        budgetName: budget.name,
        budgetDivision: budget.division,
        employee,
        plan,
        roleTitle: plan.roleTitle?.trim() || toOptionLabel(employee.role),
        hoursPerYear,
        billablePct,
        annualBillableHours,
        overtimeHoursYear,
        payrollBurdenPct,
        totalEmployeeCostPerYear,
      };
    });
};

const sumLabourPlannerRows = (rows) => {
  return rows.reduce((acc, row) => ({
    annualLabourCost: acc.annualLabourCost + row.totalEmployeeCostPerYear,
    annualRevenueGenerated: acc.annualRevenueGenerated + 0,
    grossProfitGenerated: acc.grossProfitGenerated + 0,
    billableHoursYear: acc.billableHoursYear + row.annualBillableHours,
  }), {
    annualLabourCost: 0,
    annualRevenueGenerated: 0,
    grossProfitGenerated: 0,
    billableHoursYear: 0,
  });
};

const buildCategoryAnalysisRows = ({ categoryRows, labourBudgeted, labourCount }) => {
  const rows = [...categoryRows];
  const labourIndex = rows.findIndex((row) => row.category === 'labour');

  if (labourIndex >= 0) {
    rows[labourIndex] = {
      ...rows[labourIndex],
      budgeted: labourBudgeted,
      count: Math.max(rows[labourIndex].count, labourCount),
    };
    return rows;
  }

  if (labourBudgeted > 0 || labourCount > 0) {
    rows.push({
      category: 'labour',
      budgeted: labourBudgeted,
      actual: 0,
      variance: labourBudgeted,
      count: labourCount,
    });
  }

  return rows;
};

export function buildCombinedBudgetViewModel({ budgetIds, budgets, budgetItems, labourBudgetPlans, revenueSalesGoals, employees }) {
  const selectedIds = Array.from(new Set((budgetIds ?? []).map((value) => String(value).trim()).filter(Boolean)));
  if (selectedIds.length === 0) {
    return { ok: false, code: 'NO_IDS', error: 'Select at least two budgets to view a combined budget.' };
  }

  const selectedBudgets = selectedIds.map((id) => budgets.find((budget) => budget.id === id)).filter(Boolean);
  if (selectedBudgets.length !== selectedIds.length) {
    return { ok: false, code: 'MISSING_BUDGET', error: 'One or more selected budgets could not be found.' };
  }

  if (selectedBudgets.length < 2) {
    return { ok: false, code: 'TOO_FEW', error: 'Combined Budget requires at least two budgets.' };
  }

  const fiscalYears = [...new Set(selectedBudgets.map((budget) => budget.fiscalYear))];
  if (fiscalYears.length !== 1) {
    return { ok: false, code: 'MIXED_FISCAL_YEARS', error: 'Combined budgets must use the same fiscal year.' };
  }

  const year = fiscalYears[0];
  const legacyScope = getLegacyScope({ budgets, budgetItems, labourBudgetPlans, revenueSalesGoals });

  const budgetContexts = selectedBudgets.map((budget) => {
    const scopedItems = getScopedBudgetItemsForBudget({ budgetId: budget.id, budgetItems, legacyScope })
      .filter((item) => item.period.startsWith(`${year}-`));
    const scopedLabourPlans = getScopedLabourPlansForBudget({ budgetId: budget.id, labourBudgetPlans, legacyScope })
      .filter((plan) => plan.year === year);
    const scopedRevenueGoals = getScopedRevenueGoalsForBudget({ budgetId: budget.id, revenueSalesGoals, legacyScope })
      .filter((goal) => goal.scopeType === 'year' && goal.scopeValue === year);

    return {
      budget,
      scopedItems: scopedItems.slice().sort(compareBudgetItemsByCostCode),
      scopedLabourPlans,
      scopedRevenueGoals,
    };
  });

  const combinedItems = budgetContexts.flatMap(({ budget, scopedItems }) => scopedItems.map((item) => ({
    ...item,
    sourceBudgetId: budget.id,
    sourceBudgetName: budget.name,
    sourceBudgetDivision: budget.division,
  })));

  const grouped = groupBudgetItemsByCategory(combinedItems);
  const totalsByCategory = buildTotalsByCategory(grouped);
  const categoryRows = buildCategoryRows(grouped);
  const equipmentByCostType = buildEquipmentByCostType(grouped.equipment);

  const labourPlannerRows = budgetContexts.flatMap(({ budget, scopedLabourPlans }) => buildLabourPlannerRowsForBudget({
    budget,
    year,
    employees,
    scopedLabourPlans,
  }));
  const labourTotals = sumLabourPlannerRows(labourPlannerRows);
  const categoryAnalysisRows = buildCategoryAnalysisRows({
    categoryRows,
    labourBudgeted: labourTotals.annualLabourCost,
    labourCount: labourPlannerRows.length,
  });

  const combinedRevenueBudgeted = categoryAnalysisRows
    .filter((row) => row.category === 'revenue')
    .reduce((sum, row) => sum + row.budgeted, 0);
  const combinedExpenseBudgeted = categoryAnalysisRows
    .filter((row) => row.category !== 'revenue')
    .reduce((sum, row) => sum + row.budgeted, 0);
  const combinedGrossProfit = combinedRevenueBudgeted - combinedExpenseBudgeted;
  const combinedGrossMargin = combinedRevenueBudgeted > 0 ? (combinedGrossProfit / combinedRevenueBudgeted) * 100 : 0;

  const revenueGoalRows = budgetContexts.map(({ budget, scopedItems, scopedRevenueGoals }) => {
    const fallbackGoalRevenue = scopedItems
      .filter((item) => item.category === 'revenue')
      .reduce((sum, item) => sum + item.budgeted, 0);
    const sourceGoal = scopedRevenueGoals[0] ?? {
      goalRevenue: fallbackGoalRevenue,
      workingDays: DEFAULT_WORKING_DAYS_YEAR,
    };

    return {
      budgetId: budget.id,
      budgetName: budget.name,
      budgetDivision: budget.division,
      goalRevenue: sourceGoal.goalRevenue,
      workingDays: sourceGoal.workingDays,
    };
  });

  const combinedRevenueGoal = revenueGoalRows.reduce((sum, row) => sum + row.goalRevenue, 0);
  const uniqueWorkingDays = [...new Set(revenueGoalRows.map((row) => row.workingDays).filter((value) => Number.isFinite(value) && value > 0))];
  const sharedWorkingDays = uniqueWorkingDays.length === 1 ? uniqueWorkingDays[0] : null;
  const revenuePerDayNeeded = sharedWorkingDays ? combinedRevenueGoal / sharedWorkingDays : null;

  const includesCompanyWideBudget = selectedBudgets.some((budget) => budget.division === 'company_wide');
  const includesDivisionBudget = selectedBudgets.some((budget) => budget.division !== 'company_wide');

  return {
    ok: true,
    fiscalYear: year,
    selectedBudgets,
    categoryRows,
    categoryAnalysisRows,
    totalsByCategory,
    equipmentByCostType,
    combinedItems,
    grouped,
    labourPlannerRows,
    labourTotals,
    revenueGoalRows,
    combinedRevenueBudgeted,
    combinedExpenseBudgeted,
    combinedGrossProfit,
    combinedGrossMargin,
    combinedRevenueGoal,
    sharedWorkingDays,
    revenuePerDayNeeded,
    hasPotentialOverlapWarning: includesCompanyWideBudget && includesDivisionBudget,
  };
}

export {
  BUDGET_CATEGORIES,
  DEFAULT_WORKING_DAYS_YEAR,
  compareBudgetItemsByCostCode,
  formatBudgetTabLabel,
  normalizeEquipmentCostType,
  toOptionLabel,
  isSalariedCompType,
};
