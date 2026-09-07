import { calculateJobLabourSummary } from './jobLabourSummary.js';

export const JOB_COST_CATEGORIES = ['labour', 'equipment', 'material', 'subcontractor'];
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function immutableLineCost(line) {
  const quantity = Math.max(0, Number(line?.quantity) || 0);
  if (finite(line?.plannedCost)) return Math.max(0, line.plannedCost);
  if (finite(line?.costRateAtEstimate)) return quantity * Math.max(0, line.costRateAtEstimate);
  if (line?.category === 'labour' && finite(line?.averageLabourCost)) return quantity * Math.max(0, line.averageLabourCost);
  if (finite(line?.directCostPerUnit)) return quantity * Math.max(0, line.directCostPerUnit);
  if (finite(line?.estimatedCost)) return Math.max(0, line.estimatedCost);
  return null;
}

export function calculateJobBill(input, kind) {
  const lineItems = (Array.isArray(input?.lineItems) ? input.lineItems : []).map((line, index) => {
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unitCost);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Line ${index + 1} quantity must be greater than zero.`);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`Line ${index + 1} unit cost cannot be negative.`);
    return { ...line, quantity, unitCost: money(unitCost), lineTotal: money(quantity * unitCost) };
  });
  if (!lineItems.length) throw new Error('At least one bill line is required.');
  const taxRate = Number(input.taxRate ?? 0);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error('Tax rate must be between 0 and 100.');
  const subtotal = money(lineItems.reduce((total, line) => total + line.lineTotal, 0));
  const taxAmount = money(subtotal * taxRate / 100);
  return { ...input, kind, lineItems, taxRate, subtotal, taxAmount, total: money(subtotal + taxAmount) };
}

function snapshotAreas(job) {
  return Array.isArray(job?.originalEstimateSnapshot?.workAreas) ? job.originalEstimateSnapshot.workAreas : null;
}

export function calculateJobCostAnalysis({ job, employees = [], labourClasses = [], timeEntries = [], timeCorrections = [], equipmentUsage = [], vendorBills = [], subcontractorBills = [], scopeWorkAreaId = 'entire-job' }) {
  const areas = snapshotAreas(job);
  const scopedAreaIds = scopeWorkAreaId === 'entire-job' ? null : new Set(scopeWorkAreaId === 'unallocated' ? [] : [scopeWorkAreaId]);
  const includedAreas = areas?.filter((area) => !scopedAreaIds || scopedAreaIds.has(area.id)) ?? [];
  const estimated = Object.fromEntries(JOB_COST_CATEGORIES.map((category) => [category, 0]));
  const unavailable = new Set();
  for (const area of includedAreas) for (const line of area.lineItems ?? []) {
    if (!JOB_COST_CATEGORIES.includes(line.category)) continue;
    const cost = immutableLineCost(line);
    if (cost === null) unavailable.add(line.category); else estimated[line.category] += cost;
  }
  const scopedJob = areas ? { ...job, estimatedHours: 0, operationalWorkAreas: areas } : job;
  const labour = calculateJobLabourSummary({ job: scopedJob, employees, labourClasses, timeEntries, timeCorrections, scopeWorkAreaId: scopeWorkAreaId === 'entire-job' ? undefined : scopeWorkAreaId });
  const recordInScope = (record) => scopeWorkAreaId === 'entire-job' || (scopeWorkAreaId === 'unallocated' ? !record.workAreaId : record.workAreaId === scopeWorkAreaId);
  const billCost = (bills) => money(bills.reduce((total, bill) => {
    const taxMultiplier = 1 + Number(bill.taxRate || 0) / 100;
    return total + bill.lineItems.filter(recordInScope).reduce((lineTotal, line) => lineTotal + Number(line.lineTotal || 0) * taxMultiplier, 0);
  }, 0));
  const actual = {
    labour: labour.actual.costAvailable ? money(labour.actual.cost) : null,
    equipment: money(equipmentUsage.filter(recordInScope).reduce((total, usage) => total + Number(usage.cost || 0), 0)),
    material: billCost(vendorBills),
    subcontractor: billCost(subcontractorBills),
  };
  const materialComparisonsById = new Map();
  const estimateKeysByCatalogId = new Map();
  for (const area of includedAreas) for (const [lineIndex, line] of (area.lineItems ?? []).entries()) {
    if (line.category !== 'material') continue;
    const estimateMaterialSnapshotId = line.id || `legacy:${area.id}:${lineIndex}`;
    const key = `estimate:${estimateMaterialSnapshotId}`;
    const current = materialComparisonsById.get(key) ?? {
      estimateMaterialSnapshotId,
      materialCatalogItemId: line.materialCatalogItemId,
      description: line.itemName || line.description || 'Material',
      workAreaId: area.id,
      workAreaName: area.name,
      unit: line.unit || 'ea',
      estimatedQuantity: 0,
      estimatedTotalCost: 0,
      actualQuantity: 0,
      actualTotalCost: 0,
    };
    current.estimatedQuantity += Number(line.quantity || 0);
    current.estimatedTotalCost += immutableLineCost(line) ?? 0;
    materialComparisonsById.set(key, current);
    if (line.materialCatalogItemId) {
      const estimateKeys = estimateKeysByCatalogId.get(line.materialCatalogItemId) ?? [];
      estimateKeys.push(key);
      estimateKeysByCatalogId.set(line.materialCatalogItemId, estimateKeys);
    }
  }
  for (const bill of vendorBills) for (const line of bill.lineItems ?? []) {
    if (!recordInScope(line) || (!line.estimateMaterialSnapshotId && !line.materialCatalogItemId)) continue;
    const legacyEstimateKeys = line.materialCatalogItemId ? estimateKeysByCatalogId.get(line.materialCatalogItemId) ?? [] : [];
    const key = line.estimateMaterialSnapshotId
      ? `estimate:${line.estimateMaterialSnapshotId}`
      : legacyEstimateKeys.length === 1
        ? legacyEstimateKeys[0]
        : `catalog:${line.materialCatalogItemId}`;
    const current = materialComparisonsById.get(key) ?? {
      estimateMaterialSnapshotId: line.estimateMaterialSnapshotId,
      materialCatalogItemId: line.materialCatalogItemId,
      description: line.description || 'Material',
      workAreaId: line.workAreaId,
      workAreaName: areas?.find((area) => area.id === line.workAreaId)?.name,
      unit: line.unit || 'ea',
      estimatedQuantity: 0,
      estimatedTotalCost: 0,
      actualQuantity: 0,
      actualTotalCost: 0,
    };
    current.actualQuantity += Number(line.quantity || 0);
    current.actualTotalCost += Number(line.lineTotal || 0);
    if (!current.description || current.description === 'Material') current.description = line.description || 'Material';
    materialComparisonsById.set(key, current);
  }
  const materialComparisons = [...materialComparisonsById.values()].map((item) => ({
    ...item,
    estimatedQuantity: money(item.estimatedQuantity),
    estimatedUnitCost: item.estimatedQuantity > 0 ? money(item.estimatedTotalCost / item.estimatedQuantity) : null,
    estimatedTotalCost: money(item.estimatedTotalCost),
    actualQuantity: money(item.actualQuantity),
    actualUnitCost: item.actualQuantity > 0 ? money(item.actualTotalCost / item.actualQuantity) : null,
    actualTotalCost: money(item.actualTotalCost),
    remainingQuantity: money(item.estimatedQuantity - item.actualQuantity),
    quantityVariance: money(item.actualQuantity - item.estimatedQuantity),
    costVariance: money(item.actualTotalCost - item.estimatedTotalCost),
  })).sort((left, right) => left.description.localeCompare(right.description));
  const categories = JOB_COST_CATEGORIES.map((category) => ({
    category,
    estimated: areas && !unavailable.has(category) && scopeWorkAreaId !== 'unallocated' ? money(estimated[category]) : null,
    actual: actual[category],
    variance: areas && !unavailable.has(category) && scopeWorkAreaId !== 'unallocated' && actual[category] !== null ? money(estimated[category] - actual[category]) : null,
  }));
  const estimatedTotal = categories.every((row) => row.estimated !== null) ? money(categories.reduce((total, row) => total + row.estimated, 0)) : null;
  const actualTotal = categories.every((row) => row.actual !== null) ? money(categories.reduce((total, row) => total + row.actual, 0)) : null;
  const revenue = scopeWorkAreaId === 'entire-job' ? Number(job?.originalEstimateSnapshot?.subtotal ?? job?.originalContractRevenue ?? 0) : scopeWorkAreaId === 'unallocated' ? null : Number(includedAreas[0]?.contractRevenue ?? includedAreas[0]?.estimatedRevenue ?? 0);
  const remaining = estimatedTotal !== null && actualTotal !== null ? money(estimatedTotal - actualTotal) : null;
  return {
    scopeWorkAreaId,
    baselineAvailable: Boolean(areas && estimatedTotal !== null),
    categories,
    labour,
    equipmentUsage: equipmentUsage.filter(recordInScope),
    vendorBills: vendorBills.filter((bill) => scopeWorkAreaId === 'entire-job' || bill.lineItems.some(recordInScope)),
    subcontractorBills: subcontractorBills.filter((bill) => scopeWorkAreaId === 'entire-job' || bill.lineItems.some(recordInScope)),
    materialComparisons,
    summary: {
      estimatedTotalCost: estimatedTotal,
      actualCostToDate: actualTotal,
      remainingEstimatedCost: remaining,
      costConsumedPercent: estimatedTotal && actualTotal !== null ? actualTotal / estimatedTotal * 100 : null,
      contractRevenue: revenue,
      estimatedGrossProfit: revenue !== null && estimatedTotal !== null ? money(revenue - estimatedTotal) : null,
      estimatedGrossMargin: revenue && estimatedTotal !== null ? (revenue - estimatedTotal) / revenue * 100 : null,
      grossProfitAfterRecordedCosts: revenue !== null && actualTotal !== null ? money(revenue - actualTotal) : null,
      grossMarginAfterRecordedCosts: revenue && actualTotal !== null ? (revenue - actualTotal) / revenue * 100 : null,
      projectionBasis: 'contract_revenue_less_cost_to_date_not_final_profit',
    },
  };
}