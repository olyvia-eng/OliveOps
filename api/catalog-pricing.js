import { requireSession } from './_lib/session.js';
import {
  getBudgetForBusiness,
  getBusinessProfile,
  createBudgetRateForBusiness,
  generateId,
  getLabourClassForBusiness,
  listBudgetDivisionsForBusiness,
  listBudgetRatesForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listLabourClassesForBusiness,
  listMaterialCatalogItemsForBusiness,
  updateBudgetRateForBusiness,
  updateLabourClassForBusiness,
} from './_lib/authRepo.js';
import { listDivisionPlanningItemsForBusiness } from './_lib/budgetDivisionPlanning.js';
import { buildEstimatePricingCatalog } from './_lib/estimatePricingCatalog.js';
import { buildBudgetLabourPricingDiagnostics } from '../src/pages/budget/budgetPricingModel.js';

export function createCatalogPricingHandler(overrides = {}) {
  const deps = {
    requireSession,
    getBusinessProfile,
    getBudgetForBusiness,
    createBudgetRateForBusiness,
    generateId,
    getLabourClassForBusiness,
    listBudgetDivisionsForBusiness,
    listBudgetRatesForBusiness,
    listEmployeesForBusiness,
    listEquipmentAssetsForBusiness,
    listLabourClassesForBusiness,
    listMaterialCatalogItemsForBusiness,
    listDivisionPlanningItemsForBusiness,
    updateBudgetRateForBusiness,
    updateLabourClassForBusiness,
    ...overrides,
  };

  const load = async (businessId) => {
    const business = await deps.getBusinessProfile(businessId);
    if (!business?.pricingBudgetId) return { status: 'unconfigured' };
    const budget = await deps.getBudgetForBusiness(businessId, business.pricingBudgetId);
    if (!budget || budget.status !== 'active' || budget.planningModel !== 'divisions_v1' || budget.budgetType !== 'operating') {
      return { status: 'invalid', pricingBudgetId: business.pricingBudgetId };
    }
    const [planningItems, allDivisions, budgetRates, employees, equipmentAssets, labourClasses, materialCatalogItems] = await Promise.all([
      deps.listDivisionPlanningItemsForBusiness(businessId), deps.listBudgetDivisionsForBusiness(businessId),
      deps.listBudgetRatesForBusiness(businessId), deps.listEmployeesForBusiness(businessId),
      deps.listEquipmentAssetsForBusiness(businessId), deps.listLabourClassesForBusiness(businessId),
      deps.listMaterialCatalogItemsForBusiness(businessId),
    ]);
    const divisions = allDivisions.filter((division) => division.budgetId === budget.id && division.status === 'active');
    const budgetPlanningItems = planningItems.filter((item) => item.budgetId === budget.id);
    const catalog = buildEstimatePricingCatalog({ budget, budgetId: budget.id, divisions, includeAllDivisions: true, planningItems: budgetPlanningItems, budgetRates, employees, equipmentAssets, labourClasses, materialCatalogItems });
    const labourDiagnostics = buildBudgetLabourPricingDiagnostics({ budget, divisions, planningItems: budgetPlanningItems, employees, labourClasses });
    return { status: 'ready', budget, catalog, labourDiagnostics };
  };

  return async function handler(req, res) {
    if (!['GET', 'PATCH'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PATCH');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    const session = await deps.requireSession(req, res, req.method === 'PATCH' ? ['owner', 'admin'] : ['owner', 'admin', 'foreman'], 'labour-classes');
    if (!session) return;

    try {
      const loaded = await load(session.businessId);
      if (loaded.status !== 'ready') return res.status(200).json({ ok: true, ...loaded });
      const { budget, catalog, labourDiagnostics } = loaded;
      if (req.method === 'PATCH') {
        const category = req.body?.category;
        const sourceEntityId = typeof req.body?.sourceEntityId === 'string' ? req.body.sourceEntityId : '';
        const divisionId = typeof req.body?.divisionId === 'string' ? req.body.divisionId : '';
        const customRate = req.body?.customRate === null || req.body?.customRate === '' ? null : Number(req.body?.customRate);
        if (!['labour', 'equipment', 'material', 'subcontractor'].includes(category) || !sourceEntityId || !divisionId || (customRate !== null && (!Number.isFinite(customRate) || customRate < 0))) {
          return res.status(400).json({ ok: false, error: 'Catalog custom pricing is invalid.' });
        }
        const collection = category === 'material' ? catalog.materials : category === 'subcontractor' ? catalog.subcontractors : catalog[category];
        const pricing = collection.find((item) => item.sourceEntityId === sourceEntityId && item.divisionId === divisionId);
        if (!pricing) return res.status(404).json({ ok: false, error: 'Catalog pricing item not found in the selected Pricing Budget.' });

        if (category === 'labour') {
          const labourClass = await deps.getLabourClassForBusiness(session.businessId, sourceEntityId);
          if (!labourClass?.active) return res.status(404).json({ ok: false, error: 'Labour Class not found.' });
          await deps.updateLabourClassForBusiness({ businessId: session.businessId, labourClass: { ...labourClass, customRates: { ...(labourClass.customRates ?? {}), [divisionId]: customRate } } });
        } else {
          const existingRate = pricing.sourceRateId ? loaded.catalog && (await deps.listBudgetRatesForBusiness(session.businessId)).find((rate) => rate.id === pricing.sourceRateId) : null;
          const instant = new Date().toISOString();
          const rate = {
            ...(existingRate ?? {}), id: existingRate?.id ?? deps.generateId(), budgetId: budget.id, category,
            itemName: pricing.name, description: pricing.description ?? '', unit: pricing.unit,
            unitCost: pricing.costRate ?? 0, budgetItemId: pricing.budgetItemId, divisionId,
            equipmentId: category === 'equipment' ? sourceEntityId : undefined,
            materialCatalogItemId: category === 'material' ? sourceEntityId : undefined,
            vendorId: category === 'subcontractor' ? sourceEntityId : undefined,
            pricingVersion: 2, directCostPerUnit: pricing.directCostPerUnit,
            divisionOverheadRecoveryPerUnit: pricing.divisionOverheadRecoveryPerUnit,
            companyOverheadRecoveryPerUnit: 0, recoveredCostPerUnit: pricing.recoveredCostPerUnit,
            targetMarginPercent: pricing.targetMarginPct, recommendedSellPrice: pricing.calculatedRate,
            customRate, defaultMarkupPercent: 0, defaultSellPrice: 0, active: true,
            sortOrder: existingRate?.sortOrder ?? 0, createdAt: existingRate?.createdAt ?? instant, updatedAt: instant,
          };
          if (existingRate) await deps.updateBudgetRateForBusiness({ businessId: session.businessId, budgetRate: rate });
          else await deps.createBudgetRateForBusiness({ businessId: session.businessId, budgetRate: rate });
        }
        const refreshed = await load(session.businessId);
        return res.status(200).json({ ok: true, ...refreshed, budget: refreshed.budget ? { id: refreshed.budget.id, name: refreshed.budget.name } : undefined });
      }
      return res.status(200).json({
        ok: true,
        status: 'ready',
        budget: { id: budget.id, name: budget.name },
        catalog,
        labourDiagnostics,
      });
    } catch (error) {
      console.error('Catalog pricing failed', error);
      return res.status(500).json({ ok: false, error: 'Catalog pricing could not be loaded.' });
    }
  };
}

export default createCatalogPricingHandler();