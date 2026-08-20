import { requireSession } from './_lib/session.js';
import {
  generateId,
  getBudgetDivisionForBusiness,
  getBudgetForBusiness,
  listBudgetDivisionsForBusiness,
  listBudgetItemsForBusiness,
  listBudgetRatesForBusiness,
  listBudgetsForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listLabourBudgetPlansForBusiness,
  listMaterialCatalogItemsForBusiness,
} from './_lib/authRepo.js';
import { createDivisionPlanningItems, listBudgetPlanningItems, listDivisionPlanningItems } from './_lib/budgetDivisionPlanning.js';
import { appendImportedSortOrders, copyDivisionPlanAssumptions, DIVISION_PLAN_CATEGORIES, divisionPlanIdentity, normalizeLabourPlanAssumptions } from './_lib/budgetDivisionPlanningModel.js';

const LEGACY_DIVISION_ID = '__legacy_budget_wide__';
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const normalized = (value) => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';

function buildLabourDivisionMap({ sourceDivisionId, destinationDivisionId, sourceDivisions, destinationDivisions }) {
  const divisionIdMap = new Map([[sourceDivisionId, destinationDivisionId]]);
  const ambiguousSourceIds = new Set();
  for (const sourceDivision of sourceDivisions) {
    if (sourceDivision.id === sourceDivisionId) continue;
    const matches = destinationDivisions.filter((item) => normalized(item.name) === normalized(sourceDivision.name));
    if (matches.length === 1) divisionIdMap.set(sourceDivision.id, matches[0].id);
    else if (matches.length > 1) ambiguousSourceIds.add(sourceDivision.id);
  }
  return { divisionIdMap, ambiguousSourceIds };
}

function labourMappingError(item, divisionIdMap, ambiguousSourceIds) {
  const positiveAllocations = Array.isArray(item.divisionAllocations) ? item.divisionAllocations.filter((allocation) => (allocation.hours ?? allocation.percentage ?? 0) > 0) : [];
  if (positiveAllocations.some((allocation) => ambiguousSourceIds.has(allocation.divisionId))) return 'A source Labour allocation matches more than one destination Division name. Review the destination Divisions before importing.';
  if (positiveAllocations.some((allocation) => !divisionIdMap.has(allocation.divisionId))) return 'A source Labour allocation has no matching active destination Division. Create or rename the matching Division before importing.';
  return null;
}

function legacyItemsForCategory({ category, budget, budgetItems, budgetRates, labourPlans, equipmentAssets, employees, materials }) {
  if (category === 'labour') {
    return labourPlans.filter((plan) => plan.budgetId === budget.id).map((plan) => {
      const employee = employees.find((item) => item.id === plan.employeeId);
      return {
        sourceItemId: `labour:${plan.id}`, category, employeeId: plan.employeeId,
        name: employee?.name ?? plan.description ?? 'Labour plan', role: plan.description,
        compType: plan.compType, hourlyRate: plan.hourlyRate, annualSalary: plan.annualSalary,
        plannedHours: plan.hoursPerYear, billableHours: plan.billableHoursYear,
        labourClassification: 'billable', expectedBillablePct: plan.billablePct,
        unbillableHours: plan.unbillableHoursYear, overtimeHours: plan.overtimeHoursYear,
        overtimeMultiplier: plan.overtimeMultiplier, payrollBurdenPct: plan.payrollBurdenPct,
        labourBurdenPct: plan.labourBurdenPct, benefitsExtraCost: plan.benefitsExtraCost,
        bonus: plan.bonus, sortOrder: plan.sortOrder ?? 0,
      };
    });
  }
  if (category === 'equipment') {
    return budgetItems.filter((item) => item.budgetId === budget.id && item.category === 'equipment').map((item) => {
      const asset = equipmentAssets.find((value) => value.id === item.equipmentId);
      return {
        sourceItemId: `equipment:${item.id}`, category, equipmentId: item.equipmentId,
        name: asset?.name ?? item.description, description: item.description,
        costType: item.equipmentCostType, classification: item.equipmentClassification,
        equipmentPayment: item.equipmentPayment,
        paymentFrequencyPerYear: item.equipmentPaymentFrequencyPerYear,
        yearlyFuelCost: item.yearlyFuelCost, yearlyInsuranceCost: item.yearlyInsuranceCost,
        yearlyMaintenanceCost: item.yearlyMaintenanceCost, sellableHoursPerYear: item.sellableHoursPerYear,
        utilizationHours: item.sellableHoursPerYear, allocationMonths: item.monthsUsedPerYear,
        allocationPercent: item.equipmentCostAllocationPercent, plannedAmount: item.budgeted,
        sortOrder: item.sortOrder ?? 0, unavailable: !asset,
        unavailableReason: !asset ? 'Equipment Catalog asset is no longer available.' : undefined,
      };
    });
  }
  const rateCategory = category === 'materials' ? 'material' : 'subcontractor';
  const rates = budgetRates.filter((rate) => rate.budgetId === budget.id && rate.category === rateCategory);
  if (rates.length) return rates.map((rate) => {
    const material = category === 'materials' ? materials.find((item) => normalized(item.name) === normalized(rate.itemName)) : null;
    return {
      sourceItemId: `rate:${rate.id}`, category, name: rate.itemName, description: rate.description || rate.itemName,
      materialCatalogItemId: material?.id, unit: rate.unit, unitCost: category === 'materials' ? rate.unitCost : undefined,
      rate: category === 'subcontractors' ? rate.unitCost : undefined, plannedQuantity: 1,
      plannedAmount: rate.unitCost, sortOrder: rate.sortOrder ?? 0,
    };
  });
  return budgetItems.filter((item) => item.budgetId === budget.id && item.category === category).map((item) => ({
    sourceItemId: `budget-item:${item.id}`, category, name: item.description, description: item.description,
    unit: 'each', unitCost: category === 'materials' ? item.budgeted : undefined,
    rate: category === 'subcontractors' ? item.budgeted : undefined, plannedQuantity: 1,
    plannedAmount: item.budgeted, sortOrder: item.sortOrder ?? 0,
  }));
}

async function loadPreview({ businessId, sourceBudget, sourceDivisionId, category }) {
  if (sourceDivisionId !== LEGACY_DIVISION_ID) {
    const division = await getBudgetDivisionForBusiness(businessId, sourceBudget.id, sourceDivisionId);
    if (!division) return null;
    const items = await listDivisionPlanningItems({ businessId, budgetId: sourceBudget.id, divisionId: sourceDivisionId, category });
    return { sourceDivision: division, items: items.map((item) => ({ ...item, sourceItemId: `plan:${item.id}` })) };
  }
  const [budgetItems, budgetRates, labourPlans, equipmentAssets, employees, materials] = await Promise.all([
    listBudgetItemsForBusiness(businessId), listBudgetRatesForBusiness(businessId),
    listLabourBudgetPlansForBusiness(businessId), listEquipmentAssetsForBusiness(businessId),
    listEmployeesForBusiness(businessId), listMaterialCatalogItemsForBusiness(businessId),
  ]);
  return {
    sourceDivision: { id: LEGACY_DIVISION_ID, budgetId: sourceBudget.id, name: 'Legacy Budget-wide plan' },
    items: legacyItemsForCategory({ category, budget: sourceBudget, budgetItems, budgetRates, labourPlans, equipmentAssets, employees, materials }),
  };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res, ['owner', 'admin'], 'budget-divisions');
  if (!session) return;
  const input = req.method === 'GET' ? req.query ?? {} : req.body ?? {};
  const { budgetId, divisionId, category, sourceBudgetId, sourceDivisionId } = input;
  if (!isText(budgetId) || !isText(divisionId) || !DIVISION_PLAN_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: 'Destination Budget, Division, and category are required.' });
  }
  try {
    const [destinationBudget, destinationDivision, budgets, divisions] = await Promise.all([
      getBudgetForBusiness(session.businessId, budgetId),
      getBudgetDivisionForBusiness(session.businessId, budgetId, divisionId),
      listBudgetsForBusiness(session.businessId),
      listBudgetDivisionsForBusiness(session.businessId),
    ]);
    if (!destinationBudget || !destinationDivision) return res.status(404).json({ ok: false, error: 'Destination Budget Division not found.' });
    const sourceBudgets = budgets.filter((budget) => budget.id !== budgetId).sort((left, right) => {
      const leftMatch = divisions.some((item) => item.budgetId === left.id && normalized(item.name) === normalized(destinationDivision.name));
      const rightMatch = divisions.some((item) => item.budgetId === right.id && normalized(item.name) === normalized(destinationDivision.name));
      if (leftMatch !== rightMatch) return leftMatch ? -1 : 1;
      const leftPrior = Number(left.fiscalYear) <= Number(destinationBudget.fiscalYear) ? Number(left.fiscalYear) : 0;
      const rightPrior = Number(right.fiscalYear) <= Number(destinationBudget.fiscalYear) ? Number(right.fiscalYear) : 0;
      return rightPrior - leftPrior || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
    if (!sourceBudgetId) {
      return res.status(200).json({
        ok: true,
        sourceBudgets: sourceBudgets.map((budget) => ({ ...budget, divisions: budget.planningModel === 'divisions_v1'
          ? divisions.filter((item) => item.budgetId === budget.id && item.status !== 'archived')
          : [{ id: LEGACY_DIVISION_ID, budgetId: budget.id, name: 'Legacy Budget-wide plan' }] })),
        recommendedSourceBudgetId: sourceBudgets[0]?.id,
        destination: { budget: destinationBudget, division: destinationDivision },
      });
    }
    const sourceBudget = sourceBudgets.find((budget) => budget.id === sourceBudgetId);
    if (!sourceBudget) return res.status(404).json({ ok: false, error: 'Source Budget not found.' });
    const selectedSourceDivisionId = isText(sourceDivisionId)
      ? sourceDivisionId
      : (sourceBudget.planningModel === 'divisions_v1'
        ? divisions.find((item) => item.budgetId === sourceBudget.id && normalized(item.name) === normalized(destinationDivision.name))?.id
        : LEGACY_DIVISION_ID);
    if (!selectedSourceDivisionId) return res.status(400).json({ ok: false, error: 'Source Division is required.' });
    const preview = await loadPreview({ businessId: session.businessId, sourceBudget, sourceDivisionId: selectedSourceDivisionId, category });
    if (!preview) return res.status(404).json({ ok: false, error: 'Source Division not found.' });
    const [currentEquipment, currentEmployees, currentMaterials] = await Promise.all([
      category === 'equipment' ? listEquipmentAssetsForBusiness(session.businessId) : [],
      category === 'labour' ? listEmployeesForBusiness(session.businessId) : [],
      category === 'materials' ? listMaterialCatalogItemsForBusiness(session.businessId) : [],
    ]);
    const equipmentIds = new Set(currentEquipment.map((item) => item.id));
    const employeeIds = new Set(currentEmployees.map((item) => item.id));
    const materialIds = new Set(currentMaterials.map((item) => item.id));
    const sourceDivisions = divisions.filter((item) => item.budgetId === sourceBudget.id && item.status === 'active');
    const destinationDivisions = divisions.filter((item) => item.budgetId === budgetId && item.status === 'active');
    const labourMapping = buildLabourDivisionMap({ sourceDivisionId: selectedSourceDivisionId, destinationDivisionId: divisionId, sourceDivisions, destinationDivisions });
    preview.items = preview.items.map((item) => {
      if (item.equipmentId && !equipmentIds.has(item.equipmentId)) return { ...item, unavailable: true, unavailableReason: 'Equipment Catalog asset is no longer available.' };
      if (item.employeeId && !employeeIds.has(item.employeeId)) return { ...item, unavailable: true, unavailableReason: 'Employee is no longer available.' };
      if (item.materialCatalogItemId && !materialIds.has(item.materialCatalogItemId)) return { ...item, materialCatalogItemId: undefined };
      if (category === 'labour') {
        const unavailableReason = labourMappingError(item, labourMapping.divisionIdMap, labourMapping.ambiguousSourceIds);
        if (unavailableReason) return { ...item, unavailable: true, unavailableReason };
      }
      return item;
    });
    const existing = category === 'labour'
      ? await listBudgetPlanningItems({ businessId: session.businessId, budgetId, category })
      : await listDivisionPlanningItems({ businessId: session.businessId, budgetId, divisionId, category });
    const existingIdentities = new Set(existing.map(divisionPlanIdentity));
    const previewItems = preview.items.map((item) => ({ ...item, alreadyAdded: existingIdentities.has(divisionPlanIdentity(item)) }));
    if (req.method === 'GET') return res.status(200).json({ ok: true, source: { budget: sourceBudget, division: preview.sourceDivision }, destination: { budget: destinationBudget, division: destinationDivision }, items: previewItems });

    const selectedIds = new Set(Array.isArray(input.sourceItemIds) ? input.sourceItemIds : []);
    const selectedIdentities = new Set();
    const selected = previewItems.filter((item) => {
      if (!selectedIds.has(item.sourceItemId) || item.alreadyAdded || item.unavailable) return false;
      const identity = divisionPlanIdentity(item);
      if (selectedIdentities.has(identity)) return false;
      selectedIdentities.add(identity);
      return true;
    });
    if (!selected.length) return res.status(400).json({ ok: false, error: 'Select at least one available item to import.' });
    const copied = appendImportedSortOrders(existing, selected.map((item) => normalizeLabourPlanAssumptions(copyDivisionPlanAssumptions(item, { budgetId, divisionId, divisionIdMap: labourMapping.divisionIdMap }, generateId))));
    const imported = await createDivisionPlanningItems({ businessId: session.businessId, items: copied });
    const skipped = selectedIds.size - imported.length;
    return res.status(200).json({ ok: true, items: imported, importedCount: imported.length, skippedCount: skipped, source: { budget: sourceBudget, division: preview.sourceDivision }, destination: { budget: destinationBudget, division: destinationDivision } });
  } catch (error) {
    if (error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException') {
      return res.status(409).json({ ok: false, error: 'One or more planning items were already added. Refresh the preview and try again.' });
    }
    if (error instanceof Error && error.message.includes('50 planning items')) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    return res.status(500).json({ ok: false, error: 'Could not import Division planning items.' });
  }
}