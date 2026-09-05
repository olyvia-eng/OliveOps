import { calculateJobLabourSummary } from './jobLabourSummary.js';
import { getAuthoritativeContractValue, getInvoiceRevenueAmount, isIssuedInvoice } from './invoiceModel.js';

const CATEGORIES = ['labour', 'material', 'equipment', 'subcontractor'];
const CATEGORY_LABELS = { labour: 'Labour', equipment: 'Equipment', material: 'Materials', subcontractor: 'Subcontractors' };
const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const optionalNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const sum = (values) => values.reduce((total, value) => total + number(value), 0);
const margin = (profit, revenue) => revenue > 0 ? (profit / revenue) * 100 : null;

const expenseCategory = (category) => ({ materials: 'material', equipment: 'equipment', subcontractor: 'subcontractor' })[category] ?? null;
const costCategory = (category) => category === 'materials' ? 'material' : category;
const eligibleExpense = (expense, jobId) => expense?.jobId === jobId && (expense.status === 'approved' || expense.status === 'paid');

function scopeAreas(areas, scopeWorkAreaId) {
  if (!scopeWorkAreaId || scopeWorkAreaId === 'entire-job') return areas;
  if (scopeWorkAreaId === 'unallocated') return [];
  return areas.filter((area) => area.id === scopeWorkAreaId);
}

function snapshotAreasForJob(job) {
  if (!Array.isArray(job?.originalEstimateSnapshot?.workAreas)) return null;
  const operational = Array.isArray(job?.operationalWorkAreas) ? job.operationalWorkAreas : [];
  return job.originalEstimateSnapshot.workAreas.map((snapshotArea) => {
    const currentArea = operational.find((area) => area.id === snapshotArea.id
      || (area.sourceEstimateWorkAreaId && area.sourceEstimateWorkAreaId === snapshotArea.sourceEstimateWorkAreaId));
    return currentArea ? { ...snapshotArea, id: currentArea.id } : snapshotArea;
  });
}

function immutableLineCost(line) {
  const quantity = Math.max(0, number(line?.quantity));
  if (optionalNumber(line?.plannedCost) !== null) return Math.max(0, line.plannedCost);
  if (optionalNumber(line?.costRateAtEstimate) !== null) return quantity * Math.max(0, line.costRateAtEstimate);
  if (line?.category === 'labour' && optionalNumber(line?.averageLabourCost) !== null) return quantity * Math.max(0, line.averageLabourCost);
  if (optionalNumber(line?.directCostPerUnit) !== null) return quantity * Math.max(0, line.directCostPerUnit);
  return null;
}

function estimatedCategoryTotals(areas) {
  const totals = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  const unavailable = new Set();
  for (const area of areas) {
    for (const line of Array.isArray(area?.lineItems) ? area.lineItems : []) {
      if (!CATEGORIES.includes(line?.category)) continue;
      const cost = immutableLineCost(line);
      if (cost === null) unavailable.add(line.category);
      else totals[line.category] += cost;
    }
  }
  return Object.fromEntries(CATEGORIES.map((category) => [category, unavailable.has(category) ? null : totals[category]]));
}

function actualNonLabourCategory({ job, expenses, category, scoped }) {
  if (scoped) return { value: null, source: 'unavailable', reason: 'Actual non-labour costs are not linked to a Work Area.' };
  const recorded = (Array.isArray(job?.actualCosts) ? job.actualCosts : [])
    .filter((cost) => costCategory(cost?.category) === category);
  if (recorded.length) return { value: sum(recorded.map((cost) => cost.total)), source: 'recorded-job-cost', reason: 'Recorded Job cost entries.' };
  const approvedExpenses = (Array.isArray(expenses) ? expenses : [])
    .filter((expense) => eligibleExpense(expense, job.id) && expenseCategory(expense.category) === category);
  if (approvedExpenses.length) return { value: sum(approvedExpenses.map((expense) => expense.amount)), source: 'approved-expense', reason: 'Approved or paid Job expenses; pending expenses are excluded.' };
  return { value: null, source: 'unavailable', reason: 'No eligible actual cost records are available.' };
}

function scopedInvoiceRevenue(job, invoices, scopeWorkAreaId) {
  const issued = (Array.isArray(invoices) ? invoices : []).filter((invoice) => invoice?.jobId === job.id && isIssuedInvoice(invoice));
  if (!scopeWorkAreaId || scopeWorkAreaId === 'entire-job') return sum(issued.map(getInvoiceRevenueAmount));
  if (scopeWorkAreaId === 'unallocated') return null;
  let hasUnlinkedLines = false;
  let revenue = 0;
  for (const invoice of issued) {
    if (!Array.isArray(invoice.lineItems) || invoice.lineItems.length === 0) {
      hasUnlinkedLines = true;
      continue;
    }
    for (const line of invoice.lineItems) {
      if (!line.sourceWorkAreaId) hasUnlinkedLines = true;
      if (line.sourceWorkAreaId === scopeWorkAreaId) {
        const preTaxAmount = optionalNumber(line.subtotal)
          ?? (optionalNumber(line.unitPriceBeforeTax) !== null ? number(line.quantity) * line.unitPriceBeforeTax : null);
        if (preTaxAmount === null) hasUnlinkedLines = true;
        else revenue += preTaxAmount;
      }
    }
  }
  return hasUnlinkedLines ? null : revenue;
}

export function calculateJobPerformance({
  job,
  employees = [],
  labourClasses = [],
  timeEntries = [],
  timeCorrections = [],
  invoices = [],
  expenses = [],
  scopeWorkAreaId = 'entire-job',
}) {
  const scoped = scopeWorkAreaId !== 'entire-job';
  const workAreaScoped = scoped && scopeWorkAreaId !== 'unallocated';
  const operationalAreas = Array.isArray(job?.operationalWorkAreas) ? job.operationalWorkAreas : [];
  const scopeValid = !workAreaScoped || operationalAreas.some((area) => area.id === scopeWorkAreaId);
  const snapshotAreas = snapshotAreasForJob(job);
  const baselineAvailable = snapshotAreas !== null;
  const areas = scopeAreas(baselineAvailable ? snapshotAreas : [], scopeWorkAreaId);
  const scopedBaselineAvailable = baselineAvailable && scopeValid && scopeWorkAreaId !== 'unallocated' && (!workAreaScoped || areas.length > 0);
  const labourJob = baselineAvailable
    ? { ...job, estimatedHours: 0, operationalWorkAreas: snapshotAreas }
    : { ...job, estimatedHours: 0, operationalWorkAreas: [] };
  const labour = calculateJobLabourSummary({
    job: labourJob,
    employees,
    labourClasses,
    timeEntries,
    timeCorrections,
    scopeWorkAreaId: scopeWorkAreaId === 'entire-job' ? undefined : scopeWorkAreaId,
  });
  const estimated = scopedBaselineAvailable ? estimatedCategoryTotals(areas) : null;
  const recordedLabour = workAreaScoped ? [] : (Array.isArray(job?.actualCosts) ? job.actualCosts : [])
    .filter((cost) => costCategory(cost?.category) === 'labour');
  const labourActual = labour.actual.hasData || recordedLabour.length === 0
    ? {
        value: labour.actual.cost,
        source: labour.actual.hasData ? 'time-entry' : 'time-entry-none',
        reason: labour.actual.costAvailable
          ? (labour.actual.hasData ? 'Closed Job Time Entries using historical cost snapshots before current compensation fallback.' : 'No eligible closed Job Time Entries.')
          : labour.actual.unavailableReason,
      }
    : {
        value: sum(recordedLabour.map((cost) => cost.total)),
        source: 'recorded-job-cost',
        reason: 'Recorded Job labour cost; no eligible closed Job Time Entries were available.',
      };

  const actual = {
    labour: labourActual,
    material: actualNonLabourCategory({ job, expenses, category: 'material', scoped: workAreaScoped }),
    equipment: actualNonLabourCategory({ job, expenses, category: 'equipment', scoped: workAreaScoped }),
    subcontractor: actualNonLabourCategory({ job, expenses, category: 'subcontractor', scoped: workAreaScoped }),
  };

  const categoryRows = CATEGORIES.map((category) => {
    const actualValue = actual[category].value;
    const estimatedValue = estimated?.[category] ?? null;
    return {
      category,
      estimatedCost: estimatedValue,
      actualCost: actualValue,
      variance: actualValue === null || estimatedValue === null ? null : actualValue - estimatedValue,
      source: actual[category].source,
      sourceDescription: actual[category].reason,
    };
  });
  const estimatedDirectCost = estimated && categoryRows.every((row) => row.estimatedCost !== null)
    ? sum(categoryRows.map((row) => row.estimatedCost))
    : null;
  const knownActualDirectCost = sum(categoryRows.map((row) => row.actualCost ?? 0));
  const actualDirectCostComplete = categoryRows.every((row) => row.actualCost !== null);

  const scopedRevenue = scopedBaselineAvailable
    ? (scoped ? sum(areas.map((area) => number(area.contractRevenue, area.estimatedRevenue))) : number(job.originalEstimateSnapshot.subtotal))
    : (scoped ? null : getAuthoritativeContractValue(job));
  const issuedRevenue = scopedInvoiceRevenue(job, invoices, scopeWorkAreaId);
  const estimatedGrossProfit = scopedRevenue !== null && estimatedDirectCost !== null ? scopedRevenue - estimatedDirectCost : null;

  const overheadExpenses = workAreaScoped ? [] : (Array.isArray(expenses) ? expenses : [])
    .filter((expense) => eligibleExpense(expense, job.id) && expense.category === 'overhead');
  const recordedOverhead = overheadExpenses.length ? sum(overheadExpenses.map((expense) => expense.amount)) : null;
  const estimatedOverhead = null;
  const knownActualCostIncludingOverhead = knownActualDirectCost + (recordedOverhead ?? 0);
  const actualCostComplete = actualDirectCostComplete && recordedOverhead !== null;
  const unavailableCategories = [
    ...categoryRows.filter((row) => row.actualCost === null).map((row) => CATEGORY_LABELS[row.category]),
    ...(recordedOverhead === null ? ['Overhead'] : []),
  ];

  const estimatedLines = areas.flatMap((area) => (area.lineItems ?? []).map((line) => ({
    id: line.id,
    workAreaId: area.id,
    workAreaName: area.name,
    description: line.description || line.itemName || 'Estimated item',
    category: line.category,
    estimatedQuantity: number(line.quantity),
    actualQuantity: null,
    unit: line.unit || '',
    estimatedCost: immutableLineCost(line),
    actualCost: null,
    variance: null,
    status: 'estimated-only',
  })));

  const eligibleExpenses = workAreaScoped ? [] : (Array.isArray(expenses) ? expenses : []).filter((expense) => eligibleExpense(expense, job.id));
  const supportingExpenses = eligibleExpenses.map((expense) => ({
    id: expense.id,
    vendor: expense.vendor,
    description: expense.description,
    category: expense.category,
    date: expense.expenseDate,
    amount: number(expense.amount),
    status: expense.status,
    receiptUrl: expense.receiptUrl,
    receiptFileId: expense.receiptFileId,
    countedInActuals: expense.category === 'overhead'
      ? recordedOverhead !== null
      : actualNonLabourCategory({ job, expenses, category: expenseCategory(expense.category), scoped: false }).source === 'approved-expense',
  }));
  const actualOnlyDetails = [];
  if (!workAreaScoped) {
    for (const cost of Array.isArray(job?.actualCosts) ? job.actualCosts : []) {
      const category = costCategory(cost?.category);
      if (!CATEGORIES.includes(category) || category === 'labour' && labour.actual.hasData) continue;
      actualOnlyDetails.push({
        id: `cost:${cost.id}`,
        workAreaId: 'unallocated',
        workAreaName: 'Unallocated',
        description: cost.description || 'Recorded Job cost',
        category,
        estimatedQuantity: null,
        actualQuantity: optionalNumber(cost.quantity),
        unit: cost.unit || '',
        estimatedCost: null,
        actualCost: number(cost.total),
        variance: null,
        status: 'actual-only',
      });
    }
    for (const expense of supportingExpenses.filter((item) => item.countedInActuals && expenseCategory(item.category))) {
      actualOnlyDetails.push({
        id: `expense:${expense.id}`,
        workAreaId: 'unallocated',
        workAreaName: 'Unallocated',
        description: expense.description || expense.vendor || 'Job expense',
        category: expenseCategory(expense.category),
        estimatedQuantity: null,
        actualQuantity: null,
        unit: '',
        estimatedCost: null,
        actualCost: expense.amount,
        variance: null,
        status: 'actual-only',
      });
    }
  }

  const percentOfRevenue = (value) => scopedRevenue !== null && scopedRevenue > 0 ? value / scopedRevenue * 100 : null;
  const estimatedChartSegments = scopedBaselineAvailable && scopedRevenue !== null
    ? [
        ...categoryRows.map((row) => ({ key: row.category, label: CATEGORY_LABELS[row.category], amount: row.estimatedCost ?? 0, percent: percentOfRevenue(row.estimatedCost ?? 0) })),
        { key: 'overhead', label: 'Overhead', amount: estimatedOverhead ?? 0, percent: percentOfRevenue(estimatedOverhead ?? 0) },
        { key: 'profit', label: 'Expected profit', amount: Math.max(0, estimatedGrossProfit ?? 0), percent: percentOfRevenue(Math.max(0, estimatedGrossProfit ?? 0)) },
      ]
    : [];
  const actualChartSegments = scopedRevenue !== null
    ? [
        ...categoryRows.map((row) => ({ key: row.category, label: CATEGORY_LABELS[row.category], amount: Math.max(0, row.actualCost ?? 0), percent: percentOfRevenue(Math.max(0, row.actualCost ?? 0)) })),
        { key: 'overhead', label: 'Recorded overhead', amount: Math.max(0, recordedOverhead ?? 0), percent: percentOfRevenue(Math.max(0, recordedOverhead ?? 0)) },
        { key: 'unspent', label: 'Unspent contract value', amount: Math.max(0, scopedRevenue - knownActualCostIncludingOverhead), percent: percentOfRevenue(Math.max(0, scopedRevenue - knownActualCostIncludingOverhead)) },
      ]
    : [];
  const estimatedVariance = estimatedDirectCost === null || !actualDirectCostComplete ? null : knownActualDirectCost - estimatedDirectCost;
  const statusMessage = estimatedDirectCost !== null && knownActualCostIncludingOverhead > estimatedDirectCost
    ? `This Job is currently $${(knownActualCostIncludingOverhead - estimatedDirectCost).toFixed(2)} over its total estimated cost.`
    : unavailableCategories.length
      ? `Actual cost data is incomplete for ${unavailableCategories.join(', ')}.`
      : estimatedVariance === null
      ? 'Cost position is unavailable until an accepted Estimate baseline exists.'
      : estimatedVariance > 0
        ? `This Job is currently ${estimatedVariance.toFixed(2)} over its total estimated cost.`
        : estimatedDirectCost > 0
          ? `${(knownActualCostIncludingOverhead / estimatedDirectCost * 100).toFixed(1)}% of the estimated cost has been used.`
          : 'This Job is currently on its estimated cost.';

  return {
    scopeWorkAreaId,
    scopeValid,
    scopeInvalidReason: scopeValid ? null : 'This Work Area is no longer available in the current Job plan.',
    labour,
    revenue: {
      contract: scopedRevenue,
      issued: issuedRevenue,
      taxTreatment: 'Revenue excludes sales tax.',
    },
    profit: {
      estimatedGross: estimatedGrossProfit,
      estimatedGrossMargin: estimatedGrossProfit === null || scopedRevenue === null ? null : margin(estimatedGrossProfit, scopedRevenue),
      estimatedNet: null,
      estimatedNetMargin: null,
      toDate: scopedRevenue === null ? null : scopedRevenue - knownActualCostIncludingOverhead,
      toDateMargin: scopedRevenue === null ? null : margin(scopedRevenue - knownActualCostIncludingOverhead, scopedRevenue),
      unavailableReason: actualCostComplete ? null : 'Incomplete actual cost data; margin after recorded costs is not final Job profit.',
    },
    costs: {
      categories: categoryRows,
      estimatedDirect: estimatedDirectCost,
      knownActualDirect: knownActualDirectCost,
      actualDirectComplete: actualDirectCostComplete,
      actualComplete: actualCostComplete,
      unavailableCategories,
      estimatedOverhead,
      actualOverhead: recordedOverhead,
      knownActualIncludingOverhead: knownActualCostIncludingOverhead,
      varianceConvention: 'Actual minus estimated. Positive is over budget; negative is under budget to date.',
    },
    baseline: {
      available: scopedBaselineAvailable && estimatedDirectCost !== null,
      source: scopedBaselineAvailable ? 'accepted-estimate-snapshot' : 'unavailable',
      unavailableReason: !scopeValid
        ? 'The selected Work Area is no longer available.'
        : scopeWorkAreaId === 'unallocated'
          ? 'Unallocated records have no accepted-estimate revenue or cost baseline.'
          : !baselineAvailable
            ? 'Accepted Estimate baseline unavailable for this Job.'
            : !scopedBaselineAvailable
              ? 'This Work Area has no accepted-estimate baseline.'
              : 'Historical internal cost was not captured for every category. Sell prices are not used as cost.',
    },
    economics: {
      estimatedChartSegments,
      actualChartSegments,
      chartTotal: Math.max(scopedRevenue ?? 0, knownActualCostIncludingOverhead, 1),
      knownActualCost: knownActualCostIncludingOverhead,
      actualCostComplete,
      marginAfterRecordedCosts: scopedRevenue === null ? null : scopedRevenue - knownActualCostIncludingOverhead,
      costConsumedPct: estimatedDirectCost !== null && estimatedDirectCost > 0 ? knownActualCostIncludingOverhead / estimatedDirectCost * 100 : null,
      overContractAmount: scopedRevenue === null ? 0 : Math.max(0, knownActualCostIncludingOverhead - scopedRevenue),
      statusMessage,
      forecastProfit: null,
      forecastMargin: null,
      forecastUnavailableReason: 'Forecast unavailable until sufficient actual cost information is recorded.',
    },
    details: [...estimatedLines, ...actualOnlyDetails],
    expenses: supportingExpenses,
  };
}
