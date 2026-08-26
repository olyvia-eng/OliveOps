import { annualLabourCost, buildOverheadRecoveryModel, grossMarginRate, labourDivisionShare, plannedBillableLabourHours, recoveryPerUnit } from './overheadRecoveryModel.js';
import { applyEmployeeCostInputs, calculateLabourCostFromInputs } from '../../utils/employeeLabourCost.js';

const number = (value) => {
  const result = Number(value ?? 0);
  return Number.isFinite(result) && result > 0 ? result : 0;
};

const optionalNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
};

const labourCost = (item) => {
  const calculated = calculateLabourCostFromInputs({
    compType: item.compType === 'salaried' ? 'salaried' : 'hourly',
    hourlyRate: number(item.hourlyRate),
    annualSalary: number(item.annualSalary),
    payrollBurdenPct: number(item.payrollBurdenPct ?? item.labourBurdenPct),
    benefitsExtraCost: number(item.benefitsExtraCost),
    bonus: number(item.bonus),
  }, {
    regularHours: number(item.plannedHours),
    overtimeHours: number(item.overtimeHours),
    overtimeMultiplier: Math.max(1, number(item.overtimeMultiplier) || 1.5),
    expectedBillablePct: Math.min(100, number(item.expectedBillablePct)),
    classification: item.labourClassification === 'overhead' ? 'overhead' : 'billable',
  });
  return { annual: calculated.annualLabourCost, units: calculated.expectedBillableHours, perUnit: calculated.directCostPerBillableHour };
};

const identity = (item) => {
  if (item.category === 'labour') return item.employeeId ? `labour:${item.employeeId}` : `labour:${item.id}`;
  if (item.category === 'equipment') return item.equipmentId ? `equipment:${item.equipmentId}` : `equipment:${item.id}`;
  if (item.category === 'materials') return item.materialCatalogItemId ? `materials:${item.materialCatalogItemId}` : `materials:${item.id}`;
  if (item.category === 'subcontractors') return item.vendorId ? `subcontractors:${item.vendorId}` : `subcontractors:${item.id}`;
  return `${item.category}:${item.id}`;
};

const typeForCategory = (category) => category === 'materials' ? 'material' : category === 'subcontractors' ? 'subcontractor' : category;
const labourClassItemId = (labourClassId) => `labour-class:${labourClassId}`;

export function prepareBudgetPricingInputs({ planningItems, employees = [] }) {
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  return planningItems.map((item) => applyEmployeeCostInputs(item, employeesById.get(item.employeeId)));
}

export function buildBudgetLabourPricingDiagnostics({ budget, divisions = [], planningItems, employees = [], labourClasses = [] }) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const activeClassIds = new Set(labourClasses.filter((labourClass) => labourClass.active !== false).map((labourClass) => labourClass.id));
  const activeDivisions = divisions.filter((division) => division.status === 'active');
  const planned = prepareBudgetPricingInputs({ planningItems, employees })
    .filter((item) => item.budgetId === budget.id && item.category === 'labour' && item.labourClassification !== 'overhead')
    .flatMap((item) => activeDivisions.flatMap((division) => {
      const share = labourDivisionShare(item, division.id);
      const allocatedHours = number(item.plannedHours) * share;
      const allocatedCost = annualLabourCost(item) * share;
      if (share <= 0 || (allocatedHours <= 0 && allocatedCost <= 0)) return [];
      const employee = employeeById.get(item.employeeId);
      const labourClassId = employee?.labourClassId;
      return [{
        employeeId: item.employeeId,
        employeeName: employee?.name || item.name || item.description || 'Unlinked labour plan',
        divisionId: division.id,
        divisionName: division.name,
        labourClassId,
        billableHours: plannedBillableLabourHours(item) * share,
        assigned: Boolean(labourClassId && activeClassIds.has(labourClassId)),
      }];
    }));
  const plannedEmployees = [...new Map(planned.map((item) => [item.employeeId || item.employeeName, item])).values()];
  const unassignedEmployees = plannedEmployees.filter((item) => !item.assigned);
  return {
    hasPlannedLabour: planned.length > 0,
    plannedEmployeeCount: plannedEmployees.length,
    hasAssignedProductiveLabour: planned.some((item) => item.assigned && item.billableHours > 0),
    unassignedEmployees,
  };
}

const divisionIdsForItem = (item) => {
  if (item.category === 'labour' && Array.isArray(item.divisionAllocations)) return item.divisionAllocations.filter((allocation) => number(allocation.hours ?? allocation.percentage) > 0).map((allocation) => allocation.divisionId);
  if (item.category === 'equipment' && Array.isArray(item.equipmentDivisionAllocations)) return item.equipmentDivisionAllocations.filter((allocation) => number(allocation.months) > 0).map((allocation) => allocation.divisionId);
  return item.divisionId ? [item.divisionId] : [];
};

const matchingRate = (budgetRates, budgetId, item, type, divisionId) => {
  const matchesIdentity = (candidate) => candidate.budgetItemId === item.id
    || (item.employeeId && candidate.employeeId === item.employeeId)
    || (item.equipmentId && candidate.equipmentId === item.equipmentId)
    || (item.materialCatalogItemId && candidate.materialCatalogItemId === item.materialCatalogItemId)
    || (item.vendorId && candidate.vendorId === item.vendorId);
  const candidates = budgetRates.filter((candidate) => candidate.budgetId === budgetId && candidate.category === type && matchesIdentity(candidate));
  return candidates.find((candidate) => candidate.pricingVersion === 2 && candidate.divisionId === divisionId)
    ?? candidates.find((candidate) => candidate.pricingVersion !== 2 && !candidate.divisionId);
};

const buildLegacyRows = ({ budget, uniqueItems, budgetRates }) => {
  const margin = Math.min(99, number(budget.targetMarginPct ?? 20));
  const costs = new Map();

  for (const item of uniqueItems) {
    if (item.category === 'labour') {
      const calculated = labourCost(item);
      costs.set(item.id, calculated.perUnit);
    } else if (item.category === 'equipment') {
      const hours = number(item.sellableHoursPerYear ?? item.utilizationHours);
      costs.set(item.id, hours > 0 ? number(item.plannedAmount) / hours : 0);
    } else if (item.category === 'materials') {
      costs.set(item.id, number(item.unitCost));
    } else {
      costs.set(item.id, number(item.rate));
    }
  }

  return uniqueItems.map((item) => {
    const type = typeForCategory(item.category);
    const overheadPerUnit = 0;
    const costRate = costs.get(item.id) ?? 0;
    const recommendedRate = costRate > 0 ? (costRate + overheadPerUnit) / (1 - margin / 100) : 0;
    const rate = matchingRate(budgetRates, budget.id, item, type);
    return {
      item,
      key: item.id,
      divisionId: undefined,
      type,
      rate,
      unit: item.unit || (type === 'labour' || type === 'equipment' ? 'hr' : 'unit'),
      costRate,
      overheadPerUnit,
      divisionOverheadPerUnit: 0,
      recoveredCostPerUnit: costRate + overheadPerUnit,
      targetMarginPct: margin,
      recommendedRate,
      calculatedRate: recommendedRate,
      pricingAvailable: recommendedRate > 0,
      approvedRate: number(rate?.defaultSellPrice),
      pricingStatus: number(rate?.defaultSellPrice) > 0 ? 'approved' : recommendedRate > 0 ? 'recommended_not_approved' : 'unavailable',
    };
  }).sort((left, right) => (left.item.name || left.item.description || '').localeCompare(right.item.name || right.item.description || ''));
};

export function buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates, employees = [], labourClasses = [] }) {
  const preparedPlanningItems = prepareBudgetPricingInputs({ planningItems, employees });
  const uniqueItems = [...new Map(preparedPlanningItems
    .filter((item) => item.budgetId === budget.id && ['labour', 'equipment', 'materials', 'subcontractors'].includes(item.category))
    .map((item) => [identity(item), item])).values()];
  if (!Array.isArray(divisions)) return buildLegacyRows({ budget, uniqueItems, budgetRates });

  const margin = Math.min(99, number(budget.targetMarginPct ?? 20));
  const recovery = buildOverheadRecoveryModel({ budget, divisions, planningItems: preparedPlanningItems });
  const costs = new Map();
  for (const item of uniqueItems) {
    if (item.category === 'labour') costs.set(item.id, labourCost(item).perUnit);
    else if (item.category === 'equipment') {
      const hours = number(item.sellableHoursPerYear ?? item.utilizationHours);
      costs.set(item.id, hours > 0 ? number(item.plannedAmount) / hours : 0);
    } else if (item.category === 'materials') costs.set(item.id, number(item.unitCost));
    else costs.set(item.id, number(item.rate));
  }

  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const labourItems = uniqueItems.filter((item) => item.category === 'labour' && item.labourClassification !== 'overhead');
  const labourRows = labourClasses.filter((labourClass) => labourClass.active !== false).flatMap((labourClass) => {
    const classItems = labourItems.filter((item) => employeeById.get(item.employeeId)?.labourClassId === labourClass.id);
    return divisions.filter((division) => division.status === 'active').flatMap((division) => {
      const contributors = classItems.map((item) => {
        const share = labourDivisionShare(item, division.id);
        return {
          id: item.id,
          employeeId: item.employeeId,
          name: employeeById.get(item.employeeId)?.name || item.name || item.description || 'Employee',
          billableHours: plannedBillableLabourHours(item) * share,
          annualCost: annualLabourCost(item) * share,
        };
      }).filter((item) => item.billableHours > 0);
      if (contributors.length === 0) return [];
      const billableHours = contributors.reduce((sum, item) => sum + item.billableHours, 0);
      const annualCost = contributors.reduce((sum, item) => sum + item.annualCost, 0);
      const costRate = billableHours > 0 ? annualCost / billableHours : 0;
      const scope = recovery.divisions[division.id];
      const divisionOverheadPerUnit = recoveryPerUnit(scope, 'labour', costRate);
      const recoveredCostPerUnit = costRate + divisionOverheadPerUnit;
      const recoveryConfigurationUnavailable = Boolean(scope && !scope.valid && scope.totalOverhead > 0);
      const recoveryDenominatorUnavailable = Boolean(scope?.valid && (scope.pools.labour ?? 0) > 0 && (scope.denominators.labour ?? 0) <= 0);
      const recoveryUnavailable = recoveryConfigurationUnavailable || recoveryDenominatorUnavailable;
      const calculatedRate = recoveryUnavailable ? 0 : grossMarginRate(recoveredCostPerUnit, margin);
      const customRate = optionalNumber(labourClass.customRates?.[division.id]);
      const item = { id: labourClassItemId(labourClass.id), labourClassId: labourClass.id, budgetId: budget.id, divisionId: division.id, category: 'labour', name: labourClass.name };
      return [{
        item,
        key: `${division.id}:${item.id}`,
        divisionId: division.id,
        divisionName: division.name,
        type: 'labour',
        unit: 'hr',
        costRate,
        overheadPerUnit: divisionOverheadPerUnit,
        divisionOverheadPerUnit,
        recoveredCostPerUnit,
        breakeven: recoveredCostPerUnit,
        targetMarginPct: margin,
        profit: calculatedRate - recoveredCostPerUnit,
        recommendedRate: calculatedRate,
        calculatedRate,
        customRate,
        estimateRate: customRate ?? calculatedRate,
        pricingAvailable: calculatedRate > 0,
        billableHours,
        annualCost,
        divisionOverhead: scope?.totalOverhead ?? 0,
        recoveryAllocationPct: scope?.allocation.labourPercent ?? 0,
        overheadPool: scope?.pools.labour ?? 0,
        recoveryDenominator: scope?.denominators.labour ?? 0,
        recoveryRate: scope?.rates.labour ?? 0,
        recoveryUnavailable,
        recoveryUnavailableReason: recoveryConfigurationUnavailable ? 'configuration' : recoveryDenominatorUnavailable ? 'denominator' : undefined,
        contributors,
        labourClassPricing: true,
      }];
    });
  });

  const itemRows = uniqueItems
    .filter((item) => item.category !== 'labour'
      && item.labourClassification !== 'overhead'
      && item.classification !== 'overhead')
    .flatMap((item) => divisionIdsForItem(item).map((divisionId) => {
      const type = typeForCategory(item.category);
      const costRate = costs.get(item.id) ?? 0;
      const scope = recovery.divisions[divisionId];
      const divisionOverheadPerUnit = recoveryPerUnit(scope, item.category, costRate);
      const recoveredCostPerUnit = costRate + divisionOverheadPerUnit;
      const recoveryConfigurationUnavailable = Boolean(scope && !scope.valid && scope.totalOverhead > 0);
      const recoveryDenominatorUnavailable = Boolean(scope?.valid && (scope.pools[item.category] ?? 0) > 0 && (scope.denominators[item.category] ?? 0) <= 0);
      const recoveryUnavailable = recoveryConfigurationUnavailable || recoveryDenominatorUnavailable;
      const recommendedRate = recoveryUnavailable ? 0 : grossMarginRate(recoveredCostPerUnit, margin);
      const rate = matchingRate(budgetRates, budget.id, item, type, divisionId);
      const customRate = optionalNumber(rate?.customRate);
      const division = divisions.find((value) => value.id === divisionId);
      return {
        item,
        key: `${divisionId}:${item.id}`,
        divisionId,
        divisionName: division?.name ?? 'Division',
        type,
        rate,
        unit: item.unit || (type === 'labour' || type === 'equipment' ? 'hr' : 'unit'),
        costRate,
        overheadPerUnit: divisionOverheadPerUnit,
        divisionOverheadPerUnit,
        recoveredCostPerUnit,
        breakeven: recoveredCostPerUnit,
        targetMarginPct: margin,
        profit: recommendedRate - recoveredCostPerUnit,
        recommendedRate,
        calculatedRate: recommendedRate,
        customRate,
        estimateRate: customRate ?? recommendedRate,
        pricingAvailable: recommendedRate > 0,
        divisionOverhead: scope?.totalOverhead ?? 0,
        recoveryAllocationPct: scope?.allocation[`${item.category}Percent`] ?? 0,
        overheadPool: scope?.pools[item.category] ?? 0,
        recoveryDenominator: scope?.denominators[item.category] ?? 0,
        recoveryRate: scope?.rates[item.category] ?? 0,
        recoveryUnavailable,
        recoveryUnavailableReason: recoveryConfigurationUnavailable ? 'configuration' : recoveryDenominatorUnavailable ? 'denominator' : undefined,
        approvedRate: number(rate?.defaultSellPrice),
        pricingStatus: number(rate?.defaultSellPrice) > 0 ? 'approved' : recommendedRate > 0 ? 'recommended_not_approved' : 'unavailable',
      };
    }));
  return [...labourRows, ...itemRows]
    .sort((left, right) => left.divisionName.localeCompare(right.divisionName) || (left.item.name || left.item.description || '').localeCompare(right.item.name || right.item.description || ''));
}
