import { requireSession } from './_lib/session.js';
import {
  getBudgetForBusiness,
  getBudgetDivisionForBusiness,
  getEstimateForBusiness,
  listBudgetDivisionsForBusiness,
  listBudgetRatesForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listLabourClassesForBusiness,
  listMaterialCatalogItemsForBusiness,
} from './_lib/authRepo.js';
import { listDivisionPlanningItemsForBusiness } from './_lib/budgetDivisionPlanning.js';
import { buildEstimatePricingCatalog } from './_lib/estimatePricingCatalog.js';
import { enforceEstimateWorkAreaDivisionModel } from '../src/utils/estimateWorkAreaIdentity.js';

export function createEstimatePricingCatalogHandler(overrides = {}) {
  const deps = {
    requireSession,
    getBudgetForBusiness,
    getBudgetDivisionForBusiness,
    getEstimateForBusiness,
    listBudgetDivisionsForBusiness,
    listBudgetRatesForBusiness,
    listEmployeesForBusiness,
    listEquipmentAssetsForBusiness,
    listLabourClassesForBusiness,
    listMaterialCatalogItemsForBusiness,
    listDivisionPlanningItemsForBusiness,
    ...overrides,
  };

  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    const session = await deps.requireSession(req, res, ['owner', 'admin'], 'estimates');
    if (!session) return;
    const estimateId = req.query?.estimateId;
    if (typeof estimateId !== 'string' || !estimateId.trim()) {
      return res.status(400).json({ ok: false, error: 'Estimate is required.' });
    }

    try {
      const estimate = await deps.getEstimateForBusiness(session.businessId, estimateId);
      if (!estimate) return res.status(404).json({ ok: false, error: 'Estimate not found.' });
      const divisionResult = enforceEstimateWorkAreaDivisionModel(estimate, estimate);
      if (!divisionResult.ok) return res.status(409).json({ ok: false, error: divisionResult.error });
      const divisionId = divisionResult.estimate.divisionId;
      const budget = await deps.getBudgetForBusiness(session.businessId, estimate.pricingBudgetId);
      if (!budget) return res.status(404).json({ ok: false, error: 'Estimate Pricing Budget not found.' });
      if (budget.planningModel !== 'divisions_v1') {
        return res.status(409).json({ ok: false, error: 'This Pricing Budget uses the legacy pricing catalog.' });
      }
      if (!await deps.getBudgetDivisionForBusiness(session.businessId, budget.id, divisionId)) {
        return res.status(400).json({ ok: false, error: 'Estimate Division is invalid.' });
      }

      const [planningItems, budgetDivisions, budgetRates, employees, equipmentAssets, labourClasses, materialCatalogItems] = await Promise.all([
        deps.listDivisionPlanningItemsForBusiness(session.businessId),
        deps.listBudgetDivisionsForBusiness(session.businessId),
        deps.listBudgetRatesForBusiness(session.businessId),
        deps.listEmployeesForBusiness(session.businessId),
        deps.listEquipmentAssetsForBusiness(session.businessId),
        deps.listLabourClassesForBusiness(session.businessId),
        deps.listMaterialCatalogItemsForBusiness(session.businessId),
      ]);
      const catalog = buildEstimatePricingCatalog({
        budget,
        budgetId: budget.id,
        divisions: budgetDivisions.filter((division) => division.budgetId === budget.id),
        divisionId,
        planningItems,
        budgetRates,
        employees,
        equipmentAssets,
        labourClasses,
        materialCatalogItems,
      });
      return res.status(200).json({ ok: true, budget: { id: budget.id, name: budget.name }, catalog });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not load Estimate pricing.' });
    }
  };
}

export default createEstimatePricingCatalogHandler();