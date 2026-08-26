import { buildBudgetPricingRows, prepareBudgetPricingInputs } from '../budget/budgetPricingModel.js';
import { annualLabourCost, labourDivisionShare, plannedBillableLabourHours } from '../budget/overheadRecoveryModel.js';

export function buildLabourClassCatalog({ labourClasses, employees, budgets, divisions, planningItems, budgetRates }) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  return labourClasses.map((labourClass) => {
    const classEmployees = employees.filter((employee) => employee.labourClassId === labourClass.id);
    const classEmployeeIds = new Set(classEmployees.map((employee) => employee.id));
    const pricing = [];

    for (const budget of budgets.filter((item) => item.status === 'active')) {
      const budgetDivisions = divisions.filter((division) => division.budgetId === budget.id && division.status === 'active');
      const budgetItems = prepareBudgetPricingInputs({
        planningItems: planningItems.filter((item) => item.budgetId === budget.id),
        employees,
      });
      const budgetRows = buildBudgetPricingRows({ budget, divisions: budgetDivisions, planningItems: budgetItems, budgetRates, employees });

      for (const division of budgetDivisions) {
        const contributors = budgetItems
          .filter((item) => item.category === 'labour' && classEmployeeIds.has(item.employeeId) && item.labourClassification !== 'overhead')
          .map((item) => {
            const share = labourDivisionShare(item, division.id);
            return {
              employeeId: item.employeeId,
              employeeName: employeeById.get(item.employeeId)?.name ?? item.name ?? 'Employee',
              plannedBillableHours: plannedBillableLabourHours(item) * share,
              annualLabourCost: annualLabourCost(item) * share,
            };
          })
          .filter((item) => item.plannedBillableHours > 0);
        const plannedBillableHoursTotal = contributors.reduce((sum, item) => sum + item.plannedBillableHours, 0);
        const annualLabourCostTotal = contributors.reduce((sum, item) => sum + item.annualLabourCost, 0);
        const averageLabourCost = plannedBillableHoursTotal > 0 ? annualLabourCostTotal / plannedBillableHoursTotal : null;
        const averageRow = budgetRows.find((row) => row.aggregateLabour && row.divisionId === division.id);
        const overheadRecovery = averageLabourCost !== null && averageRow ? averageRow.divisionOverheadPerUnit : null;
        const breakeven = averageLabourCost !== null && overheadRecovery !== null ? averageLabourCost + overheadRecovery : null;
        const calculatedRate = breakeven !== null && averageRow && !averageRow.recoveryUnavailable
          ? breakeven / (1 - averageRow.targetMarginPct / 100)
          : null;
        const customRate = labourClass.customRates?.[division.id] ?? null;
        pricing.push({
          budgetId: budget.id,
          budgetName: budget.name,
          divisionId: division.id,
          divisionName: division.name,
          employeeCount: new Set(contributors.map((item) => item.employeeId)).size,
          contributors,
          plannedBillableHours: plannedBillableHoursTotal,
          annualLabourCost: annualLabourCostTotal,
          averageLabourCost,
          overheadRecovery,
          breakeven,
          targetMarginPct: averageRow?.targetMarginPct ?? null,
          profit: calculatedRate !== null && breakeven !== null ? calculatedRate - breakeven : null,
          calculatedRate,
          customRate,
          estimateRate: customRate ?? calculatedRate,
          pricingAvailable: calculatedRate !== null,
          unavailableReason: plannedBillableHoursTotal <= 0
            ? 'No planned billable hours for this Labour Class in this Division.'
            : averageRow?.recoveryUnavailable
              ? 'Overhead recovery cannot be calculated for this Division.'
              : undefined,
        });
      }
    }

    const representedDivisionIds = new Set(pricing.filter((item) => item.plannedBillableHours > 0).map((item) => item.divisionId));
    const weightedHours = pricing.reduce((sum, item) => sum + item.plannedBillableHours, 0);
    const weightedCost = pricing.reduce((sum, item) => sum + item.annualLabourCost, 0);
    return {
      ...labourClass,
      employees: classEmployees,
      employeeCount: classEmployees.length,
      divisionCount: representedDivisionIds.size,
      averageLabourCost: weightedHours > 0 ? weightedCost / weightedHours : null,
      pricing,
    };
  });
}
