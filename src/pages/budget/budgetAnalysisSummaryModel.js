const nonNegative = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

export const normalizeTargetMargin = (value) => Math.min(95, nonNegative(value ?? 20));

export const formatTargetMarginPercent = (value) => `${Number(nonNegative(value).toFixed(2))}%`;

export function targetMarginFromDollars(targetProfit, plannedCosts) {
  const profit = nonNegative(targetProfit);
  const costs = nonNegative(plannedCosts);
  return profit + costs > 0 ? normalizeTargetMargin(profit / (profit + costs) * 100) : 0;
}

export function buildBudgetAnalysisSummary(financials, targetMarginPct) {
  const revenue = nonNegative(financials.revenue);
  const labourCost = nonNegative(financials.directLabour);
  const equipmentCost = nonNegative(financials.directEquipment);
  const materialCost = nonNegative(financials.materials);
  const subcontractorCost = nonNegative(financials.subcontractors);
  const overheadCost = nonNegative(financials.totalOverhead);
  const totalPlannedCosts = labourCost + equipmentCost + materialCost + subcontractorCost + overheadCost;
  const currentProfit = revenue - totalPlannedCosts;
  const currentProfitMarginPct = revenue > 0 ? currentProfit / revenue * 100 : null;
  const targetNetProfitPct = normalizeTargetMargin(targetMarginPct);
  const requiredRevenue = totalPlannedCosts / (1 - targetNetProfitPct / 100);
  const targetNetProfit = requiredRevenue - totalPlannedCosts;
  const shortfall = Math.max(0, requiredRevenue - revenue);
  const surplusAfterTarget = Math.max(0, revenue - requiredRevenue);
  const chartTotal = Math.max(revenue, requiredRevenue, 1);
  const percentOfRevenue = (amount) => revenue > 0 ? amount / revenue * 100 : null;
  const lines = [
    { key: 'revenue', label: 'Revenue', amount: revenue, percentOfRevenue: revenue > 0 ? 100 : null },
    { key: 'labour', label: 'Labour Cost', amount: labourCost, percentOfRevenue: percentOfRevenue(labourCost) },
    { key: 'equipment', label: 'Equipment Cost', amount: equipmentCost, percentOfRevenue: percentOfRevenue(equipmentCost) },
    { key: 'materials', label: 'Material Cost', amount: materialCost, percentOfRevenue: percentOfRevenue(materialCost) },
    { key: 'subcontractors', label: 'Subcontractor Cost', amount: subcontractorCost, percentOfRevenue: percentOfRevenue(subcontractorCost) },
    { key: 'overhead', label: 'Overhead Cost', amount: overheadCost, percentOfRevenue: percentOfRevenue(overheadCost) },
    { key: 'targetProfit', label: 'Net Profit', amount: targetNetProfit, percentOfRevenue: targetNetProfitPct },
  ];
  const chartSegments = lines.slice(1).map((line) => ({ ...line, widthPct: line.amount / chartTotal * 100 }));

  return {
    revenue,
    lines,
    chartSegments,
    chartTotal,
    revenueMarkerPct: revenue / chartTotal * 100,
    totalPlannedCosts,
    currentProfit,
    currentProfitMarginPct,
    targetNetProfit,
    targetNetProfitPct,
    requiredRevenue,
    shortfall,
    surplusAfterTarget,
    feasible: shortfall <= 0,
  };
}