import { calculateJobLabourSummary } from './jobLabourSummary.js';
import { getAuthoritativeContractValue, getInvoiceRevenueAmount, isIssuedInvoice } from './invoiceModel.js';

const CATEGORIES = ['labour', 'material', 'equipment', 'subcontractor'];
const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const optionalNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const sum = (values) => values.reduce((total, value) => total + number(value), 0);
const margin = (profit, revenue) => revenue > 0 ? (profit / revenue) * 100 : null;

const expenseCategory = (category) => ({ materials: 'material', equipment: 'equipment', subcontractor: 'subcontractor' })[category] ?? null;
const costCategory = (category) => category === 'materials' ? 'material' : category;
const eligibleExpense = (expense, jobId) => expense?.jobId === jobId && (expense.status === 'approved' || expense.status === 'paid');

function scopeAreas(job, scopeWorkAreaId) {
  const areas = Array.isArray(job?.operationalWorkAreas) ? job.operationalWorkAreas : [];
  if (!scopeWorkAreaId || scopeWorkAreaId === 'entire-job') return areas;
  if (scopeWorkAreaId === 'unallocated') return [];
  return areas.filter((area) => area.id === scopeWorkAreaId);
}

function estimatedCategoryTotals(areas) {
  const totals = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const area of areas) {
    for (const line of Array.isArray(area?.lineItems) ? area.lineItems : []) {
      if (!CATEGORIES.includes(line?.category)) continue;
      totals[line.category] += Math.max(0, number(line.plannedCost, number(line.estimatedCost, number(line.quantity) * number(line.unitCost))));
    }
  }
  return totals;
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
  const areas = scopeAreas(job, scopeWorkAreaId);
  const labour = calculateJobLabourSummary({
    job,
    employees,
    labourClasses,
    timeEntries,
    timeCorrections,
    scopeWorkAreaId: scopeWorkAreaId === 'entire-job' ? undefined : scopeWorkAreaId,
  });
  const estimated = estimatedCategoryTotals(areas);
  estimated.labour = labour.estimated.cost ?? estimated.labour;
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
    return {
      category,
      estimatedCost: estimated[category],
      actualCost: actualValue,
      variance: actualValue === null ? null : actualValue - estimated[category],
      source: actual[category].source,
      sourceDescription: actual[category].reason,
    };
  });
  const estimatedDirectCost = sum(categoryRows.map((row) => row.estimatedCost));
  const knownActualDirectCost = sum(categoryRows.map((row) => row.actualCost ?? 0));
  const actualDirectCostComplete = categoryRows.every((row) => row.actualCost !== null);

  const scopedRevenue = scoped
    ? sum(areas.map((area) => number(area.contractRevenue, area.estimatedRevenue)))
    : getAuthoritativeContractValue(job);
  const issuedRevenue = scopedInvoiceRevenue(job, invoices, scopeWorkAreaId);
  const estimatedGrossProfit = scopedRevenue - estimatedDirectCost;

  const overheadExpenses = workAreaScoped ? [] : (Array.isArray(expenses) ? expenses : [])
    .filter((expense) => eligibleExpense(expense, job.id) && expense.category === 'overhead');
  const recordedOverhead = overheadExpenses.length ? sum(overheadExpenses.map((expense) => expense.amount)) : null;
  const estimatedOverhead = null;
  const knownActualCostIncludingOverhead = knownActualDirectCost + (recordedOverhead ?? 0);

  const estimatedLines = areas.flatMap((area) => (area.lineItems ?? []).map((line) => ({
    id: line.id,
    workAreaId: area.id,
    workAreaName: area.name,
    description: line.description || line.itemName || 'Estimated item',
    category: line.category,
    estimatedQuantity: number(line.quantity),
    actualQuantity: null,
    unit: line.unit || '',
    estimatedCost: Math.max(0, number(line.plannedCost, number(line.estimatedCost, number(line.quantity) * number(line.unitCost)))),
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

  return {
    scopeWorkAreaId,
    labour,
    revenue: {
      contract: scopedRevenue,
      issued: issuedRevenue,
      taxTreatment: 'Revenue excludes sales tax.',
    },
    profit: {
      estimatedGross: estimatedGrossProfit,
      estimatedGrossMargin: margin(estimatedGrossProfit, scopedRevenue),
      estimatedNet: estimatedOverhead === null ? null : estimatedGrossProfit - estimatedOverhead,
      estimatedNetMargin: estimatedOverhead === null ? null : margin(estimatedGrossProfit - estimatedOverhead, scopedRevenue),
      toDate: actualDirectCostComplete && recordedOverhead !== null ? scopedRevenue - knownActualCostIncludingOverhead : null,
      toDateMargin: actualDirectCostComplete && recordedOverhead !== null ? margin(scopedRevenue - knownActualCostIncludingOverhead, scopedRevenue) : null,
      unavailableReason: actualDirectCostComplete && recordedOverhead !== null ? null : 'Incomplete actual cost or overhead data; profit to date is not presented as confirmed.',
    },
    costs: {
      categories: categoryRows,
      estimatedDirect: estimatedDirectCost,
      knownActualDirect: knownActualDirectCost,
      actualDirectComplete: actualDirectCostComplete,
      estimatedOverhead,
      actualOverhead: recordedOverhead,
      knownActualIncludingOverhead: knownActualCostIncludingOverhead,
      varianceConvention: 'Actual minus estimated. Positive is over budget; negative is under budget to date.',
    },
    details: [...estimatedLines, ...actualOnlyDetails],
    expenses: supportingExpenses,
  };
}
