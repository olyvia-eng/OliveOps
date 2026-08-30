export const JOB_PLANNING_SNAPSHOT_VERSION = 1;

const CATEGORIES = ['labour', 'equipment', 'material', 'subcontractor'];

const number = (value, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const nonNegative = (value, fallback = 0) => Math.max(0, number(value, fallback));

const categoryTotals = () => ({
  labour: 0,
  equipment: 0,
  material: 0,
  subcontractor: 0,
});

export function calculateJobPlanLine(rawLine, { contractRevenue } = {}) {
  const quantity = nonNegative(rawLine?.quantity);
  const unitCost = nonNegative(rawLine?.unitCost);
  const plannedCost = quantity * unitCost;
  const preservedContractRevenue = nonNegative(
    contractRevenue,
    nonNegative(rawLine?.contractRevenue, nonNegative(rawLine?.total, nonNegative(rawLine?.estimatedSell))),
  );

  return {
    ...rawLine,
    quantity,
    unitCost,
    plannedCost,
    estimatedCost: plannedCost,
    contractRevenue: preservedContractRevenue,
    total: preservedContractRevenue,
  };
}

export function calculateJobPlan(workAreas = []) {
  const totalsByCategory = categoryTotals();
  let currentPlannedCost = 0;
  let currentContractRevenue = 0;

  const operationalWorkAreas = workAreas.map((rawArea, index) => {
    const lineItems = (Array.isArray(rawArea?.lineItems) ? rawArea.lineItems : [])
      .map((line) => calculateJobPlanLine(line));
    const plannedByCategory = categoryTotals();

    for (const line of lineItems) {
      if (!CATEGORIES.includes(line.category)) continue;
      plannedByCategory[line.category] += line.plannedCost;
      totalsByCategory[line.category] += line.plannedCost;
    }

    const plannedCost = lineItems.reduce((sum, line) => sum + line.plannedCost, 0);
    const contractRevenue = lineItems.reduce((sum, line) => sum + line.contractRevenue, 0);
    currentPlannedCost += plannedCost;
    currentContractRevenue += contractRevenue;

    return {
      ...rawArea,
      sortOrder: number(rawArea?.sortOrder, index),
      lineItems,
      plannedCost,
      contractRevenue,
      expectedMargin: contractRevenue - plannedCost,
      plannedByCategory,
      estimatedCost: plannedCost,
      estimatedRevenue: contractRevenue,
      estimatedMargin: contractRevenue - plannedCost,
      estimatedByCategory: { ...plannedByCategory },
    };
  });

  const currentExpectedProfit = currentContractRevenue - currentPlannedCost;
  return {
    operationalWorkAreas,
    currentPlannedCost,
    currentContractRevenue,
    currentExpectedProfit,
    currentExpectedMarginPct: currentContractRevenue > 0
      ? (currentExpectedProfit / currentContractRevenue) * 100
      : 0,
    plannedByCategory: totalsByCategory,
  };
}

export function createJobOnlyPlanLine(rawLine) {
  return calculateJobPlanLine({
    ...rawLine,
    contractRevenue: 0,
    total: 0,
  }, { contractRevenue: 0 });
}

export function cloneJobPlan(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}