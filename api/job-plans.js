import { requireSession } from './_lib/session.js';
import {
  generateId,
  getBudgetDivisionForBusiness,
  getBudgetForBusiness,
  getEstimateForBusiness,
  getJobForBusiness,
  initializeJobPlanForBusiness,
  listBudgetDivisionsForBusiness,
  listBudgetRatesForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listLabourClassesForBusiness,
  listMaterialCatalogItemsForBusiness,
  listSubcontractorCatalogItemsForBusiness,
  updateJobPlanForBusiness,
} from './_lib/authRepo.js';
import { listDivisionPlanningItemsForBusiness } from './_lib/budgetDivisionPlanning.js';
import { applyAuthoritativeEstimatePricing, buildEstimatePricingCatalog } from './_lib/estimatePricingCatalog.js';
import { buildJobWorkAreasFromEstimate, buildOriginalEstimateSnapshot } from './estimates.js';
import {
  JOB_PLANNING_SNAPSHOT_VERSION,
  calculateJobPlan,
  cloneJobPlan,
  createJobOnlyPlanLine,
} from '../src/utils/jobPlanModel.js';

const EDIT_ROLES = new Set(['owner', 'admin', 'foreman']);
const FINANCIAL_ROLES = new Set(['owner', 'admin']);
const WORK_AREA_STATUSES = new Set(['not_started', 'in_progress', 'complete', 'on_hold']);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isNonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const planFields = (job, plan, originalEstimateSnapshot = job.originalEstimateSnapshot ?? null) => ({
  operationalWorkAreas: plan.operationalWorkAreas,
  originalEstimateSnapshot,
  planningSnapshotVersion: JOB_PLANNING_SNAPSHOT_VERSION,
  planningRevision: job.planningRevision ?? 1,
  currentPlannedCost: plan.currentPlannedCost,
  estimatedCost: plan.currentPlannedCost,
  originalContractRevenue: job.originalContractRevenue
    ?? originalEstimateSnapshot?.subtotal
    ?? job.contractValue
    ?? 0,
  currentContractRevenue: job.currentContractRevenue
    ?? job.originalContractRevenue
    ?? originalEstimateSnapshot?.subtotal
    ?? job.contractValue
    ?? 0,
  updatedAt: new Date().toISOString(),
});

function cloneSnapshotAsOperational(workAreas) {
  return cloneJobPlan(workAreas).map((area, areaIndex) => ({
    ...area,
    id: generateId(),
    sourceEstimateWorkAreaId: area.sourceEstimateWorkAreaId ?? area.id,
    status: area.status ?? 'not_started',
    sortOrder: area.sortOrder ?? areaIndex,
    lineItems: (area.lineItems ?? []).map((line) => ({
      ...line,
      id: generateId(),
      sourceEstimateLineItemId: line.sourceEstimateLineItemId ?? line.id,
      sourceEstimateWorkAreaId: line.sourceEstimateWorkAreaId ?? area.sourceEstimateWorkAreaId ?? area.id,
    })),
  }));
}

async function buildInitialPlan(deps, businessId, job) {
  let originalEstimateSnapshot = job.originalEstimateSnapshot ?? null;
  let operationalWorkAreas;

  if (Array.isArray(job.operationalWorkAreas)) {
    operationalWorkAreas = cloneJobPlan(job.operationalWorkAreas);
  } else if (Array.isArray(originalEstimateSnapshot?.workAreas)) {
    operationalWorkAreas = cloneSnapshotAsOperational(originalEstimateSnapshot.workAreas);
  } else if (isNonEmptyString(job.sourceEstimateId)) {
    const estimate = await deps.getEstimateForBusiness(businessId, job.sourceEstimateId);
    if (!estimate) throw new Error('SOURCE_ESTIMATE_NOT_FOUND');
    operationalWorkAreas = buildJobWorkAreasFromEstimate(estimate);
    originalEstimateSnapshot = buildOriginalEstimateSnapshot(estimate, operationalWorkAreas);
  } else {
    operationalWorkAreas = (Array.isArray(job.workAreas) ? job.workAreas : [])
      .filter(isNonEmptyString)
      .map((name, sortOrder) => ({
        id: generateId(),
        name: name.trim(),
        description: '',
        status: 'not_started',
        sortOrder,
        lineItems: [],
      }));
  }

  return planFields(job, calculateJobPlan(operationalWorkAreas), originalEstimateSnapshot);
}

async function loadPricingCatalog(deps, businessId, job) {
  const budget = await deps.getBudgetForBusiness(businessId, job.pricingBudgetId);
  if (!budget || budget.planningModel !== 'divisions_v1') throw new Error('PRICING_CONTEXT_UNAVAILABLE');
  const divisionId = job.divisionId
    ?? job.operationalWorkAreas?.flatMap((area) => area.lineItems ?? []).find((line) => isNonEmptyString(line.divisionId))?.divisionId;
  if (!isNonEmptyString(divisionId) || !await deps.getBudgetDivisionForBusiness(businessId, budget.id, divisionId)) {
    throw new Error('PRICING_CONTEXT_UNAVAILABLE');
  }
  const [planningItems, divisions, budgetRates, employees, equipmentAssets, labourClasses, materials, subcontractors] = await Promise.all([
    deps.listDivisionPlanningItemsForBusiness(businessId),
    deps.listBudgetDivisionsForBusiness(businessId),
    deps.listBudgetRatesForBusiness(businessId),
    deps.listEmployeesForBusiness(businessId),
    deps.listEquipmentAssetsForBusiness(businessId),
    deps.listLabourClassesForBusiness(businessId),
    deps.listMaterialCatalogItemsForBusiness(businessId),
    deps.listSubcontractorCatalogItemsForBusiness(businessId),
  ]);
  return buildEstimatePricingCatalog({
    budget,
    budgetId: budget.id,
    divisions: divisions.filter((division) => division.budgetId === budget.id),
    divisionId,
    planningItems,
    budgetRates,
    employees,
    equipmentAssets,
    labourClasses,
    materialCatalogItems: materials,
    subcontractorCatalogItems: subcontractors,
  });
}

function updatePlan(job, body, role) {
  const areas = cloneJobPlan(job.operationalWorkAreas ?? []);
  const area = areas.find((item) => item.id === body.workAreaId);
  const isFinancial = FINANCIAL_ROLES.has(role);

  if (body.action === 'add-work-area') {
    if (!isFinancial) return { error: 'Only owners and admins can add Job Work Areas.', status: 403 };
    areas.push({ id: generateId(), name: isNonEmptyString(body.name) ? body.name.trim() : `Work Area ${areas.length + 1}`, description: '', status: 'not_started', sortOrder: areas.length, lineItems: [] });
  } else if (body.action === 'update-work-area') {
    if (!area) return { error: 'Job Work Area not found.', status: 404 };
    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) return { error: 'Job Work Area name is required.', status: 400 };
      area.name = body.name.trim();
    }
    if (body.description !== undefined) {
      if (typeof body.description !== 'string') return { error: 'Job Work Area description is invalid.', status: 400 };
      area.description = body.description;
    }
    if (body.status !== undefined) {
      if (!WORK_AREA_STATUSES.has(body.status)) return { error: 'Job Work Area status is invalid.', status: 400 };
      area.status = body.status;
    }
  } else if (body.action === 'delete-work-area') {
    if (!isFinancial) return { error: 'Only owners and admins can delete Job Work Areas.', status: 403 };
    if (!area) return { error: 'Job Work Area not found.', status: 404 };
    areas.splice(areas.indexOf(area), 1);
    areas.forEach((item, index) => { item.sortOrder = index; });
  } else if (body.action === 'update-line') {
    if (!area) return { error: 'Job Work Area not found.', status: 404 };
    const line = area.lineItems.find((item) => item.id === body.lineItemId);
    if (!line) return { error: 'Job line item not found.', status: 404 };
    if (body.quantity !== undefined) {
      if (!isNonNegativeNumber(body.quantity)) return { error: 'Job line quantity must be zero or greater.', status: 400 };
      line.quantity = body.quantity;
    }
    if (body.unitCost !== undefined) {
      if (!isFinancial) return { error: 'Only owners and admins can edit current planned costs.', status: 403 };
      if (!isNonNegativeNumber(body.unitCost)) return { error: 'Job line planned cost must be zero or greater.', status: 400 };
      line.unitCost = body.unitCost;
    }
    if (body.description !== undefined) {
      if (typeof body.description !== 'string') return { error: 'Job line description is invalid.', status: 400 };
      line.description = body.description;
    }
  } else if (body.action === 'remove-line') {
    if (!isFinancial) return { error: 'Only owners and admins can remove Job resources.', status: 403 };
    if (!area) return { error: 'Job Work Area not found.', status: 404 };
    const lineIndex = area.lineItems.findIndex((item) => item.id === body.lineItemId);
    if (lineIndex < 0) return { error: 'Job line item not found.', status: 404 };
    area.lineItems.splice(lineIndex, 1);
  } else {
    return { error: 'Invalid Job planning action.', status: 400 };
  }

  return { areas };
}

export function createJobPlansHandler(overrides = {}) {
  const deps = {
    requireSession,
    getJobForBusiness,
    getEstimateForBusiness,
    initializeJobPlanForBusiness,
    updateJobPlanForBusiness,
    getBudgetForBusiness,
    getBudgetDivisionForBusiness,
    listDivisionPlanningItemsForBusiness,
    listBudgetDivisionsForBusiness,
    listBudgetRatesForBusiness,
    listEmployeesForBusiness,
    listEquipmentAssetsForBusiness,
    listLabourClassesForBusiness,
    listMaterialCatalogItemsForBusiness,
    listSubcontractorCatalogItemsForBusiness,
    loadPricingCatalog: null,
    ...overrides,
  };

  return async function handler(req, res) {
    const session = await deps.requireSession(req, res, ['owner', 'admin', 'foreman'], 'jobs');
    if (!session) return;
    if (!EDIT_ROLES.has(session.role)) return res.status(403).json({ ok: false, error: 'Not authorized.' });
    const jobId = req.query?.jobId;
    if (!isNonEmptyString(jobId)) return res.status(400).json({ ok: false, error: 'Job is required.' });
    let job = await deps.getJobForBusiness(session.businessId, jobId);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });

    if (req.method === 'POST' && req.body?.action === 'initialize') {
      if (job.planningSnapshotVersion === JOB_PLANNING_SNAPSHOT_VERSION) return res.status(200).json({ ok: true, job, initialized: false });
      try {
        const plan = await buildInitialPlan(deps, session.businessId, job);
        const result = await deps.initializeJobPlanForBusiness({ businessId: session.businessId, jobId, plan });
        if (!result.ok && result.code !== 'ALREADY_INITIALIZED') return res.status(409).json({ ok: false, error: 'Job planning could not be initialized.' });
        job = await deps.getJobForBusiness(session.businessId, jobId) ?? { ...job, ...plan };
        return res.status(200).json({ ok: true, job, initialized: result.ok });
      } catch (error) {
        const message = error?.message === 'SOURCE_ESTIMATE_NOT_FOUND' ? 'Source Estimate not found.' : 'Job planning could not be initialized.';
        return res.status(409).json({ ok: false, error: message });
      }
    }

    if (req.method === 'GET' && req.query?.action === 'catalog') {
      if (!FINANCIAL_ROLES.has(session.role)) return res.status(403).json({ ok: false, error: 'Not authorized to view Job pricing.' });
      try {
        const catalog = deps.loadPricingCatalog
          ? await deps.loadPricingCatalog(session.businessId, job)
          : await loadPricingCatalog(deps, session.businessId, job);
        return res.status(200).json({ ok: true, catalog });
      } catch {
        return res.status(409).json({ ok: false, error: 'Job pricing context is unavailable.' });
      }
    }

    const expectedRevision = req.body?.expectedRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return res.status(400).json({ ok: false, error: 'Expected planning revision is required.' });
    if (job.planningSnapshotVersion !== JOB_PLANNING_SNAPSHOT_VERSION) return res.status(409).json({ ok: false, error: 'Initialize Job planning before editing.' });
    if (job.planningRevision !== expectedRevision) return res.status(409).json({ ok: false, error: 'Job planning changed elsewhere. Refresh and try again.' });

    let areas;
    if (req.method === 'POST' && req.body?.action === 'add-resource') {
      if (!FINANCIAL_ROLES.has(session.role)) return res.status(403).json({ ok: false, error: 'Only owners and admins can add Job resources.' });
      const currentAreas = cloneJobPlan(job.operationalWorkAreas ?? []);
      const area = currentAreas.find((item) => item.id === req.body.workAreaId);
      if (!area) return res.status(404).json({ ok: false, error: 'Job Work Area not found.' });
      try {
        const catalog = deps.loadPricingCatalog
          ? await deps.loadPricingCatalog(session.businessId, job)
          : await loadPricingCatalog(deps, session.businessId, job);
        const sourceBudgetItemId = isNonEmptyString(req.body.sourceBudgetItemId) ? req.body.sourceBudgetItemId : undefined;
        const materialCatalogItemId = isNonEmptyString(req.body.materialCatalogItemId) ? req.body.materialCatalogItemId : undefined;
        if (!sourceBudgetItemId && !materialCatalogItemId) return res.status(400).json({ ok: false, error: 'A Catalog or Budget resource is required.' });
        const duplicate = currentAreas.flatMap((item) => item.lineItems).some((line) => (
          (sourceBudgetItemId && line.sourceBudgetItemId === sourceBudgetItemId)
          || (materialCatalogItemId && line.materialCatalogItemId === materialCatalogItemId)
        ));
        if (duplicate) return res.status(409).json({ ok: false, error: 'This resource is already in the Job plan.' });
        const candidate = [...catalog.labour, ...catalog.equipment, ...catalog.materials, ...catalog.subcontractors]
          .find((item) => (sourceBudgetItemId && item.budgetItemId === sourceBudgetItemId) || (materialCatalogItemId && item.materialCatalogItemId === materialCatalogItemId));
        if (!candidate) return res.status(404).json({ ok: false, error: 'Job planning resource not found.' });
        const lineId = generateId();
        const pricingResult = applyAuthoritativeEstimatePricing({
          existingEstimate: { lineItems: [], workAreas: [] },
          nextEstimate: {
            pricingBudgetId: catalog.budgetId,
            lineItems: [{ id: lineId, category: candidate.type, itemName: candidate.name, description: candidate.description ?? '', quantity: isNonNegativeNumber(req.body.quantity) ? req.body.quantity : 1, unit: candidate.unit, unitCost: 0, sellPrice: 0, total: 0, sourceBudgetId: catalog.budgetId, sourceBudgetItemId: candidate.budgetItemId, sourceEntityId: candidate.sourceEntityId, materialCatalogItemId: candidate.materialCatalogItemId, divisionId: candidate.divisionId }],
            workAreas: [],
          },
          catalog,
        });
        if (!pricingResult.ok) return res.status(400).json({ ok: false, error: pricingResult.error });
        const priced = pricingResult.estimate.lineItems[0];
        area.lineItems.push(createJobOnlyPlanLine({ ...priced, recommendedSellPriceAtAddition: priced.sellPrice }));
        areas = currentAreas;
      } catch (error) {
        return res.status(409).json({ ok: false, error: error?.message && !error.message.includes('_') ? error.message : 'Job pricing context is unavailable.' });
      }
    } else if (req.method === 'PATCH') {
      const update = updatePlan(job, req.body, session.role);
      if (update.error) return res.status(update.status).json({ ok: false, error: update.error });
      areas = update.areas;
    } else {
      res.setHeader('Allow', 'GET, POST, PATCH');
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }

    const calculated = calculateJobPlan(areas);
    const fixedContractRevenue = job.currentContractRevenue
      ?? job.originalContractRevenue
      ?? job.originalEstimateSnapshot?.subtotal
      ?? job.contractValue
      ?? 0;
    const currentExpectedProfit = fixedContractRevenue - calculated.currentPlannedCost;
    const nextRevision = expectedRevision + 1;
    const estimatedHours = calculated.operationalWorkAreas.flatMap((area) => area.lineItems)
      .filter((line) => line.category === 'labour')
      .reduce((sum, line) => sum + line.quantity, 0);
    const plan = {
      ...calculated,
      currentContractRevenue: fixedContractRevenue,
      currentExpectedProfit,
      currentExpectedMarginPct: fixedContractRevenue > 0 ? (currentExpectedProfit / fixedContractRevenue) * 100 : 0,
      estimatedCost: calculated.currentPlannedCost,
      workAreas: calculated.operationalWorkAreas.map((area) => area.name),
      planningRevision: nextRevision,
      estimatedHours,
      updatedAt: new Date().toISOString(),
    };
    const result = await deps.updateJobPlanForBusiness({ businessId: session.businessId, jobId, expectedRevision, plan });
    if (!result.ok) return res.status(409).json({ ok: false, error: 'Job planning changed elsewhere. Refresh and try again.' });
    return res.status(200).json({ ok: true, plan });
  };
}

export default createJobPlansHandler();