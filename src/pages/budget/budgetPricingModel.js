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

export function buildBudgetPricingRows({ budget, planningItems, budgetRates, companyOverhead = 0 }) {
  const uniqueItems = [...new Map(planningItems
    .filter((item) => item.budgetId === budget.id && ['labour', 'equipment', 'materials', 'subcontractors'].includes(item.category))
    .map((item) => [identity(item), item])).values()];
  const margin = Math.min(99, number(budget.targetMarginPct ?? 20));
  const allocation = budget.overheadRecoveryAllocation ?? { labourPercent: 50, equipmentPercent: 30, materialsPercent: 20, subcontractorsPercent: 0 };
  const units = { labour: 0, equipment: 0, materials: 0, subcontractors: 0 };
  const costs = new Map();

  for (const item of uniqueItems) {
    if (item.category === 'labour') {
      const calculated = labourCost(item);
      costs.set(item.id, calculated.perUnit);
      units.labour += calculated.units;
    } else if (item.category === 'equipment') {
      const hours = number(item.sellableHoursPerYear ?? item.utilizationHours);
      costs.set(item.id, hours > 0 ? number(item.plannedAmount) / hours : 0);
      units.equipment += hours;
    } else if (item.category === 'materials') {
      costs.set(item.id, number(item.unitCost));
      units.materials += number(item.plannedQuantity);
    } else {
      costs.set(item.id, number(item.rate));
      units.subcontractors += number(item.plannedQuantity);
    }
  }

  return uniqueItems.map((item) => {
    const type = typeForCategory(item.category);
    const categoryPercent = allocation[`${item.category === 'materials' ? 'materials' : item.category}Percent`] ?? 0;
    const overheadPerUnit = units[item.category] > 0 ? number(companyOverhead) * (number(categoryPercent) / 100) / units[item.category] : 0;
    const costRate = costs.get(item.id) ?? 0;
    const recommendedRate = costRate > 0 ? (costRate + overheadPerUnit) / (1 - margin / 100) : 0;
    const rate = budgetRates.find((candidate) => candidate.budgetId === budget.id && candidate.category === type && (
      candidate.budgetItemId === item.id
      || (item.employeeId && candidate.employeeId === item.employeeId)
      || (item.equipmentId && candidate.equipmentId === item.equipmentId)
      || (item.materialCatalogItemId && candidate.materialCatalogItemId === item.materialCatalogItemId)
      || (item.vendorId && candidate.vendorId === item.vendorId)
    ));
    return {
      item,
      type,
      rate,
      unit: item.unit || (type === 'labour' || type === 'equipment' ? 'hr' : 'unit'),
      costRate,
      overheadPerUnit,
      recommendedRate,
      approvedRate: number(rate?.defaultSellPrice),
      pricingStatus: number(rate?.defaultSellPrice) > 0 ? 'approved' : recommendedRate > 0 ? 'recommended_not_approved' : 'unavailable',
    };
  }).sort((left, right) => (left.item.name || left.item.description || '').localeCompare(right.item.name || right.item.description || ''));
}
