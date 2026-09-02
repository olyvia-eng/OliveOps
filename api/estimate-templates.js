import { requireSession } from './_lib/session.js';
import {
  createEstimateForBusiness,
  createTemplateForBusiness,
  deleteTemplateForBusiness,
  generateId,
  getBudgetDivisionForBusiness,
  getBudgetForBusiness,
  getCustomerForBusiness,
  getEmployeeForBusiness,
  getEquipmentAssetForBusiness,
  getLabourClassForBusiness,
  getMaterialCatalogItemForBusiness,
  getSubcontractorCatalogItemForBusiness,
  getTemplateForBusiness,
  listBudgetDivisionsForBusiness,
  listBudgetRatesForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listEstimatesForBusiness,
  listLabourClassesForBusiness,
  listMaterialCatalogItemsForBusiness,
  listSubcontractorCatalogItemsForBusiness,
  updateTemplateForBusiness,
} from './_lib/authRepo.js';
import { listDivisionPlanningItemsForBusiness } from './_lib/budgetDivisionPlanning.js';
import { applyAuthoritativeEstimatePricing, buildEstimatePricingCatalog } from './_lib/estimatePricingCatalog.js';
import { createTemplateEstimateScope, normalizeEstimateTemplate, templateWritePayload } from '../src/utils/estimateTemplateModel.js';

const WRITE_ROLES = ['owner', 'admin'];
const TEMPLATE_FIELDS = new Set(['id', 'schemaVersion', 'name', 'description', 'proposalNotes', 'workAreas', 'createdAt', 'updatedAt']);
const AREA_FIELDS = new Set(['id', 'name', 'description', 'sortOrder', 'lineItems']);
const LINE_FIELDS = new Set(['id', 'category', 'sourceEntityId', 'itemName', 'description', 'quantity', 'unit', 'sortOrder', 'pricingReadiness']);
const CATEGORIES = new Set(['labour', 'equipment', 'material', 'subcontractor']);
const isString = (value) => typeof value === 'string';
const isId = (value) => isString(value) && value.trim().length > 0;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const unsupported = (value, fields) => Object.keys(value ?? {}).find((key) => !fields.has(key));

function validateTemplate(template) {
  const topLevel = unsupported(template, TEMPLATE_FIELDS);
  if (topLevel) return `${topLevel} is not part of the Template scope contract.`;
  if (!isId(template.id) || !isId(template.name)) return 'Template id and name are required.';
  if (!isString(template.description) || !isString(template.proposalNotes)) return 'Template text fields are invalid.';
  if (template.schemaVersion !== 2 || !Array.isArray(template.workAreas)) return 'Template schema is invalid.';
  const areaIds = new Set();
  for (const area of template.workAreas) {
    const areaField = unsupported(area, AREA_FIELDS);
    if (areaField) return `${areaField} is not part of the Template Work Area contract.`;
    if (!isId(area.id) || areaIds.has(area.id) || !isId(area.name) || !isString(area.description) || !isNumber(area.sortOrder) || !Array.isArray(area.lineItems)) return 'Template Work Areas are invalid.';
    areaIds.add(area.id);
    const lineIds = new Set();
    for (const line of area.lineItems) {
      const lineField = unsupported(line, LINE_FIELDS);
      if (lineField) return `${lineField} is not part of the Template line-item contract.`;
      if (!isId(line.id) || lineIds.has(line.id) || !CATEGORIES.has(line.category) || !isId(line.itemName) || !isString(line.description) || !isNumber(line.quantity) || line.quantity < 0 || !isId(line.unit) || !isNumber(line.sortOrder)) return 'Template line items are invalid.';
      if (line.sourceEntityId !== undefined && !isId(line.sourceEntityId)) return 'Template resource identity is invalid.';
      lineIds.add(line.id);
    }
  }
  return null;
}

function validateTemplateInput(input) {
  const topLevel = unsupported(input, TEMPLATE_FIELDS);
  if (topLevel) return `${topLevel} is not part of the Template scope contract.`;
  if (!Array.isArray(input?.workAreas)) return null;
  for (const area of input.workAreas) {
    const areaField = unsupported(area, AREA_FIELDS);
    if (areaField) return `${areaField} is not part of the Template Work Area contract.`;
    if (!Array.isArray(area?.lineItems)) continue;
    for (const line of area.lineItems) {
      const lineField = unsupported(line, LINE_FIELDS);
      if (lineField) return `${lineField} is not part of the Template line-item contract.`;
    }
  }
  return null;
}

async function validateTemplateResources(deps, businessId, template) {
  for (const area of template.workAreas) {
    for (const line of area.lineItems) {
      if (!line.sourceEntityId) continue;
      const resource = line.category === 'labour'
        ? await deps.getLabourClassForBusiness(businessId, line.sourceEntityId)
        : line.category === 'equipment'
          ? await deps.getEquipmentAssetForBusiness(businessId, line.sourceEntityId)
          : line.category === 'material'
            ? await deps.getMaterialCatalogItemForBusiness(businessId, line.sourceEntityId)
            : await deps.getSubcontractorCatalogItemForBusiness(businessId, line.sourceEntityId);
      if (!resource) return 'Template resources must belong to this business.';
    }
  }
  return null;
}

function catalogItems(catalog, category) {
  if (category === 'labour') return catalog.labour;
  if (category === 'equipment') return catalog.equipment;
  if (category === 'material') return catalog.materials;
  return catalog.subcontractors;
}

function priceTemplateScope(scope, budgetId, divisionId, catalog) {
  const requestedWorkAreas = scope.map((area) => ({
    ...area,
    divisionId,
    lineItems: area.lineItems.map((line) => {
      const pricing = line.sourceEntityId
        ? catalogItems(catalog, line.category).find((item) => item.sourceEntityId === line.sourceEntityId)
        : null;
      if (!pricing || pricing.sourceOrigin === 'legacy_budget_only' || (!pricing.pricingAvailable && pricing.pricingReadiness !== 'needs_review')) {
        return {
          ...line,
          sourceEntityId: undefined,
          pricingReadiness: 'needs_review',
          unitCost: 0,
          markupPercent: 0,
          sellPrice: 0,
          total: 0,
        };
      }
      return {
        ...line,
        sourceBudgetId: budgetId,
        sourceBudgetItemId: pricing.budgetItemId,
        sourceEntityId: pricing.sourceEntityId,
        materialCatalogItemId: pricing.materialCatalogItemId,
        sourceOrigin: pricing.sourceOrigin,
        pricingReadiness: pricing.pricingReadiness,
        divisionId,
        unitCost: 0,
        markupPercent: 0,
        sellPrice: 0,
        total: 0,
      };
    }),
  }));
  const requested = { pricingBudgetId: budgetId, divisionId, lineItems: [], workAreas: requestedWorkAreas };
  return applyAuthoritativeEstimatePricing({ existingEstimate: { lineItems: [], workAreas: [] }, nextEstimate: requested, catalog });
}

async function loadPricingCatalog(deps, businessId, budget, divisionId) {
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

export function createEstimateTemplatesHandler(overrides = {}) {
  const deps = {
    requireSession,
    createEstimateForBusiness,
    createTemplateForBusiness,
    deleteTemplateForBusiness,
    getBudgetDivisionForBusiness,
    getBudgetForBusiness,
    getCustomerForBusiness,
    getEmployeeForBusiness,
    getEquipmentAssetForBusiness,
    getLabourClassForBusiness,
    getMaterialCatalogItemForBusiness,
    getSubcontractorCatalogItemForBusiness,
    getTemplateForBusiness,
    listBudgetDivisionsForBusiness,
    listBudgetRatesForBusiness,
    listDivisionPlanningItemsForBusiness,
    listEmployeesForBusiness,
    listEquipmentAssetsForBusiness,
    listEstimatesForBusiness,
    listLabourClassesForBusiness,
    listMaterialCatalogItemsForBusiness,
    listSubcontractorCatalogItemsForBusiness,
    updateTemplateForBusiness,
    ...overrides,
  };

  return async function estimateTemplatesHandler(req, res) {
    const session = await deps.requireSession(req, res, WRITE_ROLES, 'templates');
    if (!session) return;
    try {
      if (req.method === 'POST' && req.query?.action === 'create-estimate') {
        const { templateId, customerId, pricingBudgetId, divisionId, propertyLabel = '', propertyAddressSnapshot = '', proposalNumber, title, validUntil } = req.body ?? {};
        if (![templateId, customerId, pricingBudgetId, divisionId, proposalNumber, title, validUntil].every(isId)) return res.status(400).json({ ok: false, error: 'Template, customer, Budget, Division, proposal number, title, and valid-until date are required.' });
        const [template, customer, budget, division, estimates] = await Promise.all([
          deps.getTemplateForBusiness(session.businessId, templateId),
          deps.getCustomerForBusiness(session.businessId, customerId),
          deps.getBudgetForBusiness(session.businessId, pricingBudgetId),
          deps.getBudgetDivisionForBusiness(session.businessId, pricingBudgetId, divisionId),
          deps.listEstimatesForBusiness(session.businessId),
        ]);
        if (!template) return res.status(404).json({ ok: false, error: 'Template not found.' });
        if (!customer || !budget || !division || division.status !== 'active') return res.status(400).json({ ok: false, error: 'Customer, Pricing Budget, or Division is invalid.' });
        if (estimates.some((estimate) => estimate.proposalNumber?.trim().toLowerCase() === proposalNumber.trim().toLowerCase())) return res.status(409).json({ ok: false, error: 'Proposal number already exists.' });
        const catalog = await loadPricingCatalog(deps, session.businessId, budget, divisionId);
        const scope = createTemplateEstimateScope(template, generateId);
        const pricingResult = priceTemplateScope(scope, pricingBudgetId, divisionId, catalog);
        if (!pricingResult.ok) return res.status(400).json({ ok: false, error: pricingResult.error });
        const now = new Date().toISOString();
        const normalizedTemplate = normalizeEstimateTemplate(template);
        const estimate = {
          id: generateId(),
          customerId,
          pricingBudgetId,
          divisionId,
          propertyLabel: isString(propertyLabel) ? propertyLabel : '',
          propertyAddressSnapshot: isString(propertyAddressSnapshot) ? propertyAddressSnapshot : '',
          proposalNumber: proposalNumber.trim(),
          title: title.trim(),
          description: normalizedTemplate.description,
          workAreas: pricingResult.estimate.workAreas,
          lineItems: pricingResult.estimate.workAreas.flatMap((area) => area.lineItems),
          status: 'draft',
          taxRate: 13,
          notes: normalizedTemplate.proposalNotes,
          validUntil,
          templateId: template.id,
          createdAt: now,
          updatedAt: now,
        };
        await deps.createEstimateForBusiness({ businessId: session.businessId, estimate });
        return res.status(200).json({ ok: true, estimate });
      }

      if (req.method === 'POST') {
        const now = new Date().toISOString();
        const draft = { id: generateId(), schemaVersion: 2, name: req.body?.name, description: req.body?.description ?? '', proposalNotes: '', workAreas: [], createdAt: now, updatedAt: now };
        const template = templateWritePayload(draft);
        const validationError = validateTemplate(template);
        if (validationError) return res.status(400).json({ ok: false, error: validationError });
        await deps.createTemplateForBusiness({ businessId: session.businessId, template });
        return res.status(200).json({ ok: true, template });
      }

      const templateId = typeof req.query?.templateId === 'string' ? req.query.templateId : '';
      if (!templateId) return res.status(400).json({ ok: false, error: 'Template id is required.' });
      const existing = await deps.getTemplateForBusiness(session.businessId, templateId);
      if (!existing) return res.status(404).json({ ok: false, error: 'Template not found.' });

      if (req.method === 'PATCH') {
        const inputError = validateTemplateInput(req.body);
        if (inputError) return res.status(400).json({ ok: false, error: inputError });
        const normalized = normalizeEstimateTemplate(existing);
        const template = templateWritePayload({ ...normalized, ...req.body, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
        const validationError = validateTemplate(template);
        if (validationError) return res.status(400).json({ ok: false, error: validationError });
        const relationshipError = await validateTemplateResources(deps, session.businessId, template);
        if (relationshipError) return res.status(400).json({ ok: false, error: relationshipError });
        await deps.updateTemplateForBusiness({ businessId: session.businessId, template });
        return res.status(200).json({ ok: true, template });
      }

      if (req.method === 'DELETE') {
        await deps.deleteTemplateForBusiness(session.businessId, templateId);
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not complete Estimate Template request.' });
    }
  };
}

export default createEstimateTemplatesHandler();
