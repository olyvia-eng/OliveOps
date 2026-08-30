import { requireSession } from './_lib/session.js';
import { generateId, getBudgetDivisionForBusiness, getBudgetForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getMaterialCatalogItemForBusiness, getSubcontractorCatalogItemForBusiness } from './_lib/authRepo.js';
import {
  createDivisionPlanningItem,
  deleteDivisionPlanningItem,
  listBudgetPlanningItems,
  listDivisionPlanningItems,
  reorderDivisionPlanningItems,
  saveEquipmentPlanningItemWithAsset,
  updateDivisionPlanningItem,
} from './_lib/budgetDivisionPlanning.js';
import { DIVISION_PLAN_CATEGORIES, divisionPlanIdentity, normalizeLabourPlanAssumptions } from './_lib/budgetDivisionPlanningModel.js';
import { calculateAnnualEquipmentCostModel } from '../src/utils/equipmentPricingModel.js';

const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isNonNegative = (value) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

function validate(item) {
  if (!DIVISION_PLAN_CATEGORIES.includes(item.category)) return 'Planning category is invalid.';
  if (!isText(item.name) && !isText(item.description) && !(item.category === 'equipment' && isText(item.equipmentId))) return 'A planning item name or description is required.';
  if (!divisionPlanIdentity(item)) return 'A planning item identity is required.';
  for (const field of ['sortOrder', 'hourlyRate', 'annualSalary', 'plannedHours', 'billableHours', 'unbillableHours', 'expectedBillablePct', 'overtimeHours', 'overtimeMultiplier', 'payrollBurdenPct', 'labourBurdenPct', 'benefitsExtraCost', 'bonus', 'equipmentPayment', 'equipmentPaymentFrequencyPerYear', 'paymentFrequencyPerYear', 'yearlyFuelCost', 'yearlyInsuranceCost', 'yearlyMaintenanceCost', 'expectedReplacementCost', 'expectedResaleValue', 'remainingUsefulMonths', 'sellableHoursPerYear', 'equipmentHoursPerDay', 'utilizationHours', 'allocationMonths', 'allocationPercent', 'plannedAmount', 'unitCost', 'plannedQuantity', 'rate', 'rentalCost']) {
    if (!isNonNegative(item[field])) return `${field} must be zero or greater.`;
  }
  if (item.category === 'equipment' && !isText(item.equipmentId)) return 'Equipment must reference a catalog asset.';
  if (item.category === 'equipment' && item.expectedReplacementCost !== undefined && item.expectedResaleValue !== undefined && item.expectedResaleValue > item.expectedReplacementCost) return 'Expected resale value cannot exceed expected replacement cost.';
  if (item.category === 'equipment' && item.costType === 'owned' && item.expectedReplacementCost !== undefined && item.expectedResaleValue !== undefined && item.remainingUsefulMonths !== undefined && item.remainingUsefulMonths <= 0) return 'Remaining useful months must be greater than zero.';
  if (item.category === 'equipment' && item.costType === 'rental' && (!isNonNegative(item.rentalCost) || !['hr', 'day', 'week', 'month'].includes(item.rentalUnit))) return 'Rental equipment requires a rental cost and unit.';
  if (item.allocationMonths !== undefined && item.allocationMonths > 12) return 'Equipment allocation months cannot exceed 12.';
  if (item.allocationPercent !== undefined && item.allocationPercent > 100) return 'Equipment allocation percent cannot exceed 100.';
  if (item.category === 'labour') {
    if (!['billable', 'overhead'].includes(item.labourClassification)) return 'Labour classification is invalid.';
    if (item.expectedBillablePct > 100) return 'Expected billable percent cannot exceed 100.';
    if (item.overtimeMultiplier < 1) return 'Overtime multiplier must be at least 1.';
    if (!Array.isArray(item.divisionAllocations) || item.divisionAllocations.length === 0) return 'Labour must be allocated across Divisions.';
    if (new Set(item.divisionAllocations.map((allocation) => allocation.divisionId)).size !== item.divisionAllocations.length) return 'Each Division can appear only once in Labour allocation.';
    const usesLegacyPercentages = !(item.plannedHours > 0) && item.divisionAllocations.every((allocation) => Number.isFinite(allocation.percentage));
    if (item.divisionAllocations.some((allocation) => !isText(allocation.divisionId) || !isNonNegative(usesLegacyPercentages ? allocation.percentage : allocation.hours))) return 'Division allocation hours must be zero or greater.';
    const allocationTotal = item.divisionAllocations.reduce((sum, allocation) => sum + (usesLegacyPercentages ? allocation.percentage : allocation.hours), 0);
    if (Math.abs(allocationTotal - (usesLegacyPercentages ? 100 : item.plannedHours)) > 0.001) return usesLegacyPercentages ? 'Legacy Division allocation must total 100%.' : 'Division allocation hours must equal planned hours.';
  }
  if (item.category === 'equipment' && item.equipmentDivisionAllocations !== undefined) {
    if (!Array.isArray(item.equipmentDivisionAllocations) || item.equipmentDivisionAllocations.length === 0) return 'Equipment must be allocated across Divisions.';
    if (new Set(item.equipmentDivisionAllocations.map((allocation) => allocation.divisionId)).size !== item.equipmentDivisionAllocations.length) return 'Each Division can appear only once in Equipment allocation.';
    if (item.equipmentDivisionAllocations.some((allocation) => !isText(allocation.divisionId) || !isNonNegative(allocation.months) || allocation.months > 12)) return 'Equipment allocation months must be between 0 and 12.';
    if (item.equipmentDivisionAllocations.some((allocation) => allocation.sellableHours !== undefined && !isNonNegative(allocation.sellableHours))) return 'Equipment allocation sellable hours must be zero or greater.';
    const allocationTotal = item.equipmentDivisionAllocations.reduce((sum, allocation) => sum + allocation.months, 0);
    if (Math.abs(allocationTotal - 12) > 0.001) return 'Equipment allocation must total 12 months.';
  }
  if (item.category === 'overhead') {
    if (!Array.isArray(item.overheadDivisionAllocations) || item.overheadDivisionAllocations.length === 0) return 'Overhead must be allocated across Divisions.';
    if (new Set(item.overheadDivisionAllocations.map((allocation) => allocation.divisionId)).size !== item.overheadDivisionAllocations.length) return 'Each Division can appear only once in Overhead allocation.';
    if (item.overheadDivisionAllocations.some((allocation) => !isText(allocation.divisionId) || !isNonNegative(allocation.percentage) || allocation.percentage > 100)) return 'Overhead allocation percentages must be between 0 and 100.';
    const allocationTotal = item.overheadDivisionAllocations.reduce((sum, allocation) => sum + allocation.percentage, 0);
    if (Math.abs(allocationTotal - 100) > 0.001) return 'Overhead Division allocations must total 100%.';
  }
  return null;
}

const CATALOG_PATCH_FIELDS = new Set(['name', 'type', 'equipmentClassification', 'costType']);

function validateCatalogPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'Catalog details are required.';
  const unsupported = Object.keys(patch).find((field) => !CATALOG_PATCH_FIELDS.has(field));
  if (unsupported) return `Catalog field ${unsupported} cannot be changed from Budget planning.`;
  if (!isText(patch.name)) return 'Equipment name is required.';
  if (!isText(patch.type)) return 'Equipment type is required.';
  if (!['billable', 'overhead'].includes(patch.equipmentClassification)) return 'Equipment classification is invalid.';
  if (!['financed', 'leased', 'owned', 'rental'].includes(patch.costType)) return 'Equipment ownership / source is invalid.';
  return null;
}

const withCalculatedEquipmentAmount = (item, costType) => item.category === 'equipment'
  ? { ...item, plannedAmount: calculateAnnualEquipmentCostModel({ ...item, costType: costType ?? item.costType, plannedAmount: undefined }) }
  : item;

async function validateReferences(businessId, item, { skipEquipment = false } = {}) {
  if (item.employeeId && !await getEmployeeForBusiness(businessId, item.employeeId)) return 'Employee must belong to this business.';
  if (!skipEquipment && item.equipmentId && !await getEquipmentAssetForBusiness(businessId, item.equipmentId)) return 'Equipment must belong to this business.';
  if (item.materialCatalogItemId && !await getMaterialCatalogItemForBusiness(businessId, item.materialCatalogItemId)) return 'Material must belong to this business.';
  const subcontractorId = item.subcontractorCatalogItemId ?? item.vendorId;
  if (item.category === 'subcontractors' && subcontractorId && !await getSubcontractorCatalogItemForBusiness(businessId, subcontractorId)) return 'Subcontractor must belong to this business.';
  if (item.category === 'labour') {
    const divisions = await Promise.all(item.divisionAllocations.map((allocation) => getBudgetDivisionForBusiness(businessId, item.budgetId, allocation.divisionId)));
    if (divisions.some((division) => !division)) return 'Every Labour allocation Division must belong to this Budget.';
  }
  if (item.category === 'equipment' && Array.isArray(item.equipmentDivisionAllocations)) {
    const divisions = await Promise.all(item.equipmentDivisionAllocations.map((allocation) => getBudgetDivisionForBusiness(businessId, item.budgetId, allocation.divisionId)));
    if (divisions.some((division) => !division)) return 'Every Equipment allocation Division must belong to this Budget.';
  }
  if (item.category === 'overhead') {
    const divisions = await Promise.all(item.overheadDivisionAllocations.map((allocation) => getBudgetDivisionForBusiness(businessId, item.budgetId, allocation.divisionId)));
    if (divisions.some((division) => !division)) return 'Every Overhead allocation Division must belong to this Budget.';
  }
  return null;
}

async function resolveDestination(session, budgetId, divisionId) {
  const [budget, division] = await Promise.all([
    getBudgetForBusiness(session.businessId, budgetId),
    getBudgetDivisionForBusiness(session.businessId, budgetId, divisionId),
  ]);
  return budget && division ? { budget, division } : null;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, PUT, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res, ['owner', 'admin'], 'budget-divisions');
  if (!session) return;
  const budgetId = req.query?.budgetId ?? req.body?.budgetId ?? req.body?.data?.budgetId;
  const divisionId = req.query?.divisionId ?? req.body?.divisionId ?? req.body?.data?.divisionId;
  const category = req.query?.category ?? req.body?.category ?? req.body?.data?.category;
  if (!isText(budgetId) || !isText(divisionId) || !DIVISION_PLAN_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: 'Budget, Division, and planning category are required.' });
  }
  try {
    if (!await resolveDestination(session, budgetId, divisionId)) return res.status(404).json({ ok: false, error: 'Budget Division not found.' });
    const budgetItems = category === 'labour' || category === 'equipment' || category === 'overhead'
      ? await listBudgetPlanningItems({ businessId: session.businessId, budgetId, category })
      : await listDivisionPlanningItems({ businessId: session.businessId, budgetId, divisionId, category });
    const items = category === 'labour'
      ? budgetItems.filter((item) => item.divisionAllocations.some((allocation) => allocation.divisionId === divisionId && (allocation.hours ?? allocation.percentage ?? 0) > 0))
      : category === 'equipment'
        ? budgetItems.filter((item) => item.divisionId === divisionId || item.equipmentDivisionAllocations?.some((allocation) => allocation.divisionId === divisionId && allocation.months > 0))
        : category === 'overhead'
          ? budgetItems.filter((item) => item.overheadDivisionAllocations?.some((allocation) => allocation.divisionId === divisionId && allocation.percentage > 0))
        : budgetItems;
    if (req.method === 'GET') return res.status(200).json({ ok: true, items: items.sort((a, b) => a.sortOrder - b.sortOrder) });
    if (req.method === 'PUT') {
      const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
      const reorderItems = category === 'labour' || category === 'equipment' || category === 'overhead' ? budgetItems : items;
      if (orderedIds.length !== reorderItems.length || new Set(orderedIds).size !== reorderItems.length || orderedIds.some((id) => !reorderItems.some((item) => item.id === id))) {
        return res.status(400).json({ ok: false, error: 'Planning order must include every item exactly once.' });
      }
      if (category === 'labour') {
        await Promise.all(reorderItems.map((item) => updateDivisionPlanningItem({ businessId: session.businessId, previous: item, item })));
      }
      const reordered = await reorderDivisionPlanningItems({ businessId: session.businessId, items: orderedIds.map((id) => reorderItems.find((item) => item.id === id)) });
      return res.status(200).json({ ok: true, items: reordered });
    }
    const itemId = req.query?.id;
    if (req.method === 'POST') {
      const now = new Date().toISOString();
      const catalogPatch = req.body?.catalogPatch;
      const createEquipmentAsset = category === 'equipment' && req.body?.createEquipmentAsset === true;
      const equipmentId = createEquipmentAsset ? generateId() : req.body?.data?.equipmentId;
      let item = normalizeLabourPlanAssumptions({ ...req.body?.data, equipmentId, id: generateId(), budgetId, divisionId, category, sortOrder: budgetItems.length, createdAt: now, updatedAt: now });
      const effectiveItem = category === 'equipment' && catalogPatch ? { ...item, costType: catalogPatch.costType } : item;
      const error = validate(effectiveItem);
      if (error) return res.status(400).json({ ok: false, error });
      item = withCalculatedEquipmentAmount(item, catalogPatch?.costType);
      if (category === 'equipment' && catalogPatch) {
        const catalogError = validateCatalogPatch(catalogPatch);
        if (catalogError) return res.status(400).json({ ok: false, error: catalogError });
      }
      const referenceError = await validateReferences(session.businessId, item, { skipEquipment: createEquipmentAsset });
      if (referenceError) return res.status(400).json({ ok: false, error: referenceError });
      if (category === 'equipment' && catalogPatch) {
        const currentAsset = createEquipmentAsset ? null : await getEquipmentAssetForBusiness(session.businessId, equipmentId);
        if (!createEquipmentAsset && !currentAsset) return res.status(404).json({ ok: false, error: 'Equipment must belong to this business.' });
        const equipmentAsset = createEquipmentAsset
          ? { id: equipmentId, ...catalogPatch, status: 'available', serialNumber: '', hourlyCost: 0, notes: '', createdAt: now, updatedAt: now }
          : { ...currentAsset, ...catalogPatch, id: currentAsset.id, updatedAt: now };
        const saved = await saveEquipmentPlanningItemWithAsset({ businessId: session.businessId, equipmentAsset, createEquipmentAsset, item });
        return res.status(200).json({ ok: true, ...saved });
      }
      const saved = await createDivisionPlanningItem({ businessId: session.businessId, item });
      return res.status(200).json({ ok: true, item: saved });
    }
    const existing = budgetItems.find((item) => item.id === itemId);
    if (!existing) return res.status(404).json({ ok: false, error: 'Planning item not found.' });
    if (req.method === 'DELETE') {
      await deleteDivisionPlanningItem({ businessId: session.businessId, item: existing });
      return res.status(200).json({ ok: true });
    }
    let next = normalizeLabourPlanAssumptions({ ...existing, ...req.body?.data, id: existing.id, budgetId, divisionId: existing.divisionId, category, updatedAt: new Date().toISOString() });
    if (category === 'equipment' && next.equipmentId !== existing.equipmentId) return res.status(400).json({ ok: false, error: 'Linked equipment cannot be changed after the planning item is created.' });
    const effectiveNext = category === 'equipment' && req.body?.catalogPatch ? { ...next, costType: req.body.catalogPatch.costType } : next;
    const error = validate(effectiveNext);
    if (error) return res.status(400).json({ ok: false, error });
    next = withCalculatedEquipmentAmount(next, req.body?.catalogPatch?.costType);
    const referenceError = await validateReferences(session.businessId, next);
    if (referenceError) return res.status(400).json({ ok: false, error: referenceError });
    if (category === 'equipment' && req.body?.catalogPatch) {
      const catalogError = validateCatalogPatch(req.body.catalogPatch);
      if (catalogError) return res.status(400).json({ ok: false, error: catalogError });
      const existingAsset = await getEquipmentAssetForBusiness(session.businessId, next.equipmentId);
      if (!existingAsset) return res.status(404).json({ ok: false, error: 'Equipment must belong to this business.' });
      const equipmentAsset = { ...existingAsset, ...req.body.catalogPatch, id: existingAsset.id, updatedAt: next.updatedAt };
      const saved = await saveEquipmentPlanningItemWithAsset({ businessId: session.businessId, equipmentAsset, createEquipmentAsset: false, previous: existing, item: next });
      return res.status(200).json({ ok: true, ...saved });
    }
    const saved = await updateDivisionPlanningItem({ businessId: session.businessId, previous: existing, item: next });
    return res.status(200).json({ ok: true, item: saved });
  } catch (error) {
    const duplicate = error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException';
    return res.status(duplicate ? 409 : 500).json({ ok: false, error: duplicate ? (category === 'labour' ? 'This employee is already in the Budget.' : 'This planning item is already added to the Division.') : 'Could not save Division planning.' });
  }
}
