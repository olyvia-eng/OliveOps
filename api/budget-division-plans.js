import { requireSession } from './_lib/session.js';
import { generateId, getBudgetDivisionForBusiness, getBudgetForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getMaterialCatalogItemForBusiness } from './_lib/authRepo.js';
import {
  createDivisionPlanningItem,
  deleteDivisionPlanningItem,
  listBudgetPlanningItems,
  listDivisionPlanningItems,
  reorderDivisionPlanningItems,
  updateDivisionPlanningItem,
} from './_lib/budgetDivisionPlanning.js';
import { DIVISION_PLAN_CATEGORIES, divisionPlanIdentity, normalizeLabourPlanAssumptions } from './_lib/budgetDivisionPlanningModel.js';

const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isNonNegative = (value) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

function validate(item) {
  if (!DIVISION_PLAN_CATEGORIES.includes(item.category)) return 'Planning category is invalid.';
  if (!isText(item.name) && !isText(item.description)) return 'A planning item name or description is required.';
  if (!divisionPlanIdentity(item)) return 'A planning item identity is required.';
  for (const field of ['sortOrder', 'hourlyRate', 'annualSalary', 'plannedHours', 'billableHours', 'unbillableHours', 'expectedBillablePct', 'overtimeHours', 'overtimeMultiplier', 'payrollBurdenPct', 'labourBurdenPct', 'benefitsExtraCost', 'bonus', 'equipmentPayment', 'equipmentPaymentFrequencyPerYear', 'paymentFrequencyPerYear', 'yearlyFuelCost', 'yearlyInsuranceCost', 'yearlyMaintenanceCost', 'sellableHoursPerYear', 'equipmentHoursPerDay', 'utilizationHours', 'allocationMonths', 'allocationPercent', 'plannedAmount', 'unitCost', 'plannedQuantity', 'rate']) {
    if (!isNonNegative(item[field])) return `${field} must be zero or greater.`;
  }
  if (item.category === 'equipment' && !isText(item.equipmentId)) return 'Equipment must reference a catalog asset.';
  if (item.allocationMonths !== undefined && item.allocationMonths > 12) return 'Equipment allocation months cannot exceed 12.';
  if (item.allocationPercent !== undefined && item.allocationPercent > 100) return 'Equipment allocation percent cannot exceed 100.';
  if (item.category === 'labour') {
    if (!['billable', 'overhead'].includes(item.labourClassification)) return 'Labour classification is invalid.';
    if (item.expectedBillablePct > 100) return 'Expected billable percent cannot exceed 100.';
    if (item.overtimeMultiplier < 1) return 'Overtime multiplier must be at least 1.';
    if (!Array.isArray(item.divisionAllocations) || item.divisionAllocations.length === 0) return 'Labour must be allocated across Divisions.';
    if (new Set(item.divisionAllocations.map((allocation) => allocation.divisionId)).size !== item.divisionAllocations.length) return 'Each Division can appear only once in Labour allocation.';
    if (item.divisionAllocations.some((allocation) => !isText(allocation.divisionId) || !isNonNegative(allocation.percentage) || allocation.percentage > 100)) return 'Division allocation percentages must be between 0 and 100.';
    const allocationTotal = item.divisionAllocations.reduce((sum, allocation) => sum + allocation.percentage, 0);
    if (Math.abs(allocationTotal - 100) > 0.001) return 'Division allocation must total 100%.';
  }
  if (item.category === 'equipment' && item.equipmentDivisionAllocations !== undefined) {
    if (!Array.isArray(item.equipmentDivisionAllocations) || item.equipmentDivisionAllocations.length === 0) return 'Equipment must be allocated across Divisions.';
    if (new Set(item.equipmentDivisionAllocations.map((allocation) => allocation.divisionId)).size !== item.equipmentDivisionAllocations.length) return 'Each Division can appear only once in Equipment allocation.';
    if (item.equipmentDivisionAllocations.some((allocation) => !isText(allocation.divisionId) || !isNonNegative(allocation.months) || allocation.months > 12)) return 'Equipment allocation months must be between 0 and 12.';
    const allocationTotal = item.equipmentDivisionAllocations.reduce((sum, allocation) => sum + allocation.months, 0);
    if (Math.abs(allocationTotal - 12) > 0.001) return 'Equipment allocation must total 12 months.';
  }
  return null;
}

async function validateReferences(businessId, item) {
  if (item.employeeId && !await getEmployeeForBusiness(businessId, item.employeeId)) return 'Employee must belong to this business.';
  if (item.equipmentId && !await getEquipmentAssetForBusiness(businessId, item.equipmentId)) return 'Equipment must belong to this business.';
  if (item.materialCatalogItemId && !await getMaterialCatalogItemForBusiness(businessId, item.materialCatalogItemId)) return 'Material must belong to this business.';
  if (item.category === 'labour') {
    const divisions = await Promise.all(item.divisionAllocations.map((allocation) => getBudgetDivisionForBusiness(businessId, item.budgetId, allocation.divisionId)));
    if (divisions.some((division) => !division)) return 'Every Labour allocation Division must belong to this Budget.';
  }
  if (item.category === 'equipment' && Array.isArray(item.equipmentDivisionAllocations)) {
    const divisions = await Promise.all(item.equipmentDivisionAllocations.map((allocation) => getBudgetDivisionForBusiness(businessId, item.budgetId, allocation.divisionId)));
    if (divisions.some((division) => !division)) return 'Every Equipment allocation Division must belong to this Budget.';
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
    const budgetItems = category === 'labour'
      ? await listBudgetPlanningItems({ businessId: session.businessId, budgetId, category })
      : await listDivisionPlanningItems({ businessId: session.businessId, budgetId, divisionId, category });
    const items = category === 'labour'
      ? budgetItems.filter((item) => item.divisionAllocations.some((allocation) => allocation.divisionId === divisionId && allocation.percentage > 0))
      : budgetItems;
    if (req.method === 'GET') return res.status(200).json({ ok: true, items: items.sort((a, b) => a.sortOrder - b.sortOrder) });
    if (req.method === 'PUT') {
      if (category === 'labour') return res.status(400).json({ ok: false, error: 'Shared Labour items cannot be reordered within one Division.' });
      const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
      if (orderedIds.length !== items.length || new Set(orderedIds).size !== items.length || orderedIds.some((id) => !items.some((item) => item.id === id))) {
        return res.status(400).json({ ok: false, error: 'Planning order must include every item exactly once.' });
      }
      const reordered = await reorderDivisionPlanningItems({ businessId: session.businessId, items: orderedIds.map((id) => items.find((item) => item.id === id)) });
      return res.status(200).json({ ok: true, items: reordered });
    }
    const itemId = req.query?.id;
    if (req.method === 'POST') {
      const now = new Date().toISOString();
      const item = normalizeLabourPlanAssumptions({ ...req.body?.data, id: generateId(), budgetId, divisionId, category, sortOrder: budgetItems.length, createdAt: now, updatedAt: now });
      const error = validate(item);
      if (error) return res.status(400).json({ ok: false, error });
      const referenceError = await validateReferences(session.businessId, item);
      if (referenceError) return res.status(400).json({ ok: false, error: referenceError });
      const saved = await createDivisionPlanningItem({ businessId: session.businessId, item });
      return res.status(200).json({ ok: true, item: saved });
    }
    const existing = budgetItems.find((item) => item.id === itemId);
    if (!existing) return res.status(404).json({ ok: false, error: 'Planning item not found.' });
    if (req.method === 'DELETE') {
      await deleteDivisionPlanningItem({ businessId: session.businessId, item: existing });
      return res.status(200).json({ ok: true });
    }
    const next = normalizeLabourPlanAssumptions({ ...existing, ...req.body?.data, id: existing.id, budgetId, divisionId: existing.divisionId, category, updatedAt: new Date().toISOString() });
    const error = validate(next);
    if (error) return res.status(400).json({ ok: false, error });
    const referenceError = await validateReferences(session.businessId, next);
    if (referenceError) return res.status(400).json({ ok: false, error: referenceError });
    const saved = await updateDivisionPlanningItem({ businessId: session.businessId, previous: existing, item: next });
    return res.status(200).json({ ok: true, item: saved });
  } catch (error) {
    const duplicate = error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException';
    return res.status(duplicate ? 409 : 500).json({ ok: false, error: duplicate ? (category === 'labour' ? 'This employee is already in the Budget.' : 'This planning item is already added to the Division.') : 'Could not save Division planning.' });
  }
}
