import { buildBudgetPricingRows } from '../budget/budgetPricingModel.js';

export function buildLabourClassCatalog({ labourClasses, employees, budgets, divisions, planningItems, budgetRates, equipmentAssets = [] }) {
  return labourClasses.map((labourClass) => {
    const classEmployees = employees.filter((employee) => employee.labourClassId === labourClass.id);
    const pricing = [];

    for (const budget of budgets.filter((item) => item.status === 'active')) {
      const budgetDivisions = divisions.filter((division) => division.budgetId === budget.id && division.status === 'active');
      const budgetRows = buildBudgetPricingRows({
        budget,
        divisions: budgetDivisions,
        planningItems: planningItems.filter((item) => item.budgetId === budget.id),
        budgetRates,
        employees,
        equipmentAssets,
        labourClasses,
      });

      for (const division of budgetDivisions) {
        const classRow = budgetRows.find((row) => row.item.labourClassId === labourClass.id && row.divisionId === division.id);
        const contributors = (classRow?.contributors ?? []).map((item) => ({
          employeeId: item.employeeId,
          employeeName: item.name,
          plannedBillableHours: item.billableHours,
          annualLabourCost: item.annualCost,
        }));
        const plannedBillableHoursTotal = classRow?.billableHours ?? 0;
        const annualLabourCostTotal = classRow?.annualCost ?? 0;
        const averageLabourCost = classRow?.costRate || null;
        const overheadRecovery = classRow?.divisionOverheadPerUnit ?? null;
        const breakeven = classRow?.breakeven ?? null;
        const calculatedRate = classRow?.pricingAvailable ? classRow.calculatedRate : null;
        const customRate = classRow?.customRate ?? labourClass.customRates?.[division.id] ?? null;
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
          targetMarginPct: classRow?.targetMarginPct ?? null,
          profit: classRow?.pricingAvailable ? classRow.profit : null,
          calculatedRate,
          customRate,
          estimateRate: customRate ?? calculatedRate,
          pricingAvailable: calculatedRate !== null,
          unavailableReason: plannedBillableHoursTotal <= 0
            ? 'No planned billable hours for this Labour Class in this Division.'
            : classRow?.recoveryUnavailable
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
