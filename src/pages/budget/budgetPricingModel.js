import { buildOverheadRecoveryModel, grossMarginRate, recoveryPerUnit } from './overheadRecoveryModel.js';

const number = (value) => {
  const result = Number(value ?? 0);
  return Number.isFinite(result) && result > 0 ? result : 0;
};

const labourCost = (item) => {
  const hours = number(item.plannedHours);
  const regular = item.compType === 'salaried' ? number(item.annualSalary) : number(item.hourlyRate) * hours;
  const overtime = item.compType === 'salaried' ? 0 : number(item.hourlyRate) * number(item.overtimeHours) * Math.max(1, number(item.overtimeMultiplier) || 1.5);
  const burden = (regular + overtime) * (number(item.payrollBurdenPct ?? item.labourBurdenPct) / 100);
  const annual = regular + overtime + burden + number(item.benefitsExtraCost) + number(item.bonus);
  const billableHours = item.labourClassification === 'overhead' ? 0 : hours * Math.min(100, number(item.expectedBillablePct)) / 100;
  return { annual, units: billableHours, perUnit: billableHours > 0 ? annual / billableHours : 0 };
};

const identity = (item) => {
  if (item.category === 'labour') return item.employeeId ? `labour:${item.employeeId}` : `labour:${item.id}`;
  if (item.category === 'equipment') return item.equipmentId ? `equipment:${item.equipmentId}` : `equipment:${item.id}`;
  if (item.category === 'materials') return item.materialCatalogItemId ? `materials:${item.materialCatalogItemId}` : `materials:${item.id}`;
  if (item.category === 'subcontractors') return item.vendorId ? `subcontractors:${item.vendorId}` : `subcontractors:${item.id}`;
  return `${item.category}:${item.id}`;
};

const typeForCategory = (category) => category === 'materials' ? 'material' : category === 'subcontractors' ? 'subcontractor' : category;

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
      approvedRate: number(rate?.defaultSellPrice),
      pricingStatus: number(rate?.defaultSellPrice) > 0 ? 'approved' : recommendedRate > 0 ? 'recommended_not_approved' : 'unavailable',
    };
  }).sort((left, right) => (left.item.name || left.item.description || '').localeCompare(right.item.name || right.item.description || ''));
};

export function buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates }) {
  const uniqueItems = [...new Map(planningItems
    .filter((item) => item.budgetId === budget.id && ['labour', 'equipment', 'materials', 'subcontractors'].includes(item.category))
    .map((item) => [identity(item), item])).values()];
  if (!Array.isArray(divisions)) return buildLegacyRows({ budget, uniqueItems, budgetRates });

  const margin = Math.min(99, number(budget.targetMarginPct ?? 20));
  const recovery = buildOverheadRecoveryModel({ budget, divisions, planningItems });
  const costs = new Map();
  for (const item of uniqueItems) {
    if (item.category === 'labour') costs.set(item.id, labourCost(item).perUnit);
    else if (item.category === 'equipment') {
      const hours = number(item.sellableHoursPerYear ?? item.utilizationHours);
      costs.set(item.id, hours > 0 ? number(item.plannedAmount) / hours : 0);
    } else if (item.category === 'materials') costs.set(item.id, number(item.unitCost));
    else costs.set(item.id, number(item.rate));
  }

  return uniqueItems
    .filter((item) => item.labourClassification !== 'overhead' && item.classification !== 'overhead')
    .flatMap((item) => divisionIdsForItem(item).map((divisionId) => {
      const type = typeForCategory(item.category);
      const costRate = costs.get(item.id) ?? 0;
      const divisionOverheadPerUnit = recoveryPerUnit(recovery.divisions[divisionId], item.category, costRate);
      const recoveredCostPerUnit = costRate + divisionOverheadPerUnit;
      const recommendedRate = grossMarginRate(recoveredCostPerUnit, margin);
      const rate = matchingRate(budgetRates, budget.id, item, type, divisionId);
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
        targetMarginPct: margin,
        recommendedRate,
        approvedRate: number(rate?.defaultSellPrice),
        pricingStatus: number(rate?.defaultSellPrice) > 0 ? 'approved' : recommendedRate > 0 ? 'recommended_not_approved' : 'unavailable',
      };
    }))
    .sort((left, right) => left.divisionName.localeCompare(right.divisionName) || (left.item.name || left.item.description || '').localeCompare(right.item.name || right.item.description || ''));
}
