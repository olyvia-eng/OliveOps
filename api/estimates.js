import { requireSession } from './_lib/session.js';
import {
  convertEstimateToJobForBusiness,
  generateId,
  getEstimateForBusiness,
  reserveNextJobNumberForBusiness,
} from './_lib/authRepo.js';

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function convertedJobTitle(estimate, requestedTitle, jobNumber) {
  const candidates = [requestedTitle, estimate.title]
    .filter(isNonEmptyString)
    .map((value) => value.trim())
    .filter((value) => !/^draft estimate\b/i.test(value));
  if (candidates[0]) return candidates[0];
  if (isNonEmptyString(estimate.propertyLabel)) return estimate.propertyLabel.trim();
  return `Job ${jobNumber}`;
}

function normalizeEstimateWorkAreas(estimate) {
  if (Array.isArray(estimate.workAreas) && estimate.workAreas.length > 0) {
    const hasObjectAreas = estimate.workAreas.some((area) => area && typeof area === 'object' && !Array.isArray(area));
    if (!hasObjectAreas) {
      return estimate.workAreas
        .filter((name) => typeof name === 'string' && name.trim())
        .map((name, index) => ({
          id: generateId(),
          name: name.trim(),
          description: '',
          sortOrder: index,
          lineItems: [],
        }));
    }

    return estimate.workAreas
      .filter((area) => area && typeof area === 'object' && !Array.isArray(area))
      .map((area, index) => ({
        id: isNonEmptyString(area.id) ? area.id : generateId(),
        name: isNonEmptyString(area.name) ? area.name.trim() : `Work Area ${index + 1}`,
        description: typeof area.description === 'string' ? area.description : '',
        sortOrder: toNumber(area.sortOrder, index),
        lineItems: Array.isArray(area.lineItems) ? area.lineItems : [],
      }));
  }

  if (Array.isArray(estimate.lineItems) && estimate.lineItems.length > 0) {
    return [
      {
        id: generateId(),
        name: 'General',
        description: '',
        sortOrder: 0,
        lineItems: estimate.lineItems,
      },
    ];
  }

  return [];
}

function normalizeJobLineItem(rawLineItem, sourceEstimateWorkAreaId) {
  const quantity = toNumber(rawLineItem.quantity);
  const unitCost = toNumber(rawLineItem.unitCost);
  const markupPercent = toNumber(rawLineItem.markupPercent, toNumber(rawLineItem.markup));
  const computedSellPrice = unitCost * (1 + (markupPercent / 100));
  const sellPrice = toNumber(rawLineItem.sellPrice, computedSellPrice);
  const total = toNumber(rawLineItem.total, quantity * sellPrice);

  return {
    id: generateId(),
    sourceEstimateLineItemId: rawLineItem.id,
    sourceEstimateWorkAreaId,
    category: rawLineItem.category,
    itemName: isNonEmptyString(rawLineItem.itemName) ? rawLineItem.itemName.trim() : (isNonEmptyString(rawLineItem.description) ? rawLineItem.description.trim() : 'Line Item'),
    description: typeof rawLineItem.description === 'string' ? rawLineItem.description : '',
    quantity,
    unit: isNonEmptyString(rawLineItem.unit) ? rawLineItem.unit.trim() : 'unit',
    unitCost,
    sellPrice,
    total,
  };
}

function buildJobWorkAreasFromEstimate(estimate) {
  return normalizeEstimateWorkAreas(estimate)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((workArea, index) => {
      const lineItems = workArea.lineItems
        .filter((lineItem) => lineItem && typeof lineItem === 'object')
        .map((lineItem) => normalizeJobLineItem(lineItem, workArea.id));

      const estimatedByCategory = {
        labour: 0,
        equipment: 0,
        material: 0,
        subcontractor: 0,
      };

      for (const lineItem of lineItems) {
        if (Object.prototype.hasOwnProperty.call(estimatedByCategory, lineItem.category)) {
          estimatedByCategory[lineItem.category] += lineItem.total;
        }
      }

      const estimatedRevenue = lineItems.reduce((sum, lineItem) => sum + lineItem.total, 0);
      const estimatedCost = lineItems.reduce((sum, lineItem) => sum + (lineItem.quantity * lineItem.unitCost), 0);

      return {
        id: generateId(),
        sourceEstimateWorkAreaId: workArea.id,
        name: workArea.name,
        description: workArea.description,
        status: 'not_started',
        sortOrder: toNumber(workArea.sortOrder, index),
        estimatedCost,
        estimatedRevenue,
        estimatedMargin: estimatedRevenue - estimatedCost,
        estimatedByCategory,
        lineItems,
      };
    });
}

function buildOriginalEstimateSnapshot(estimate, operationalWorkAreas) {
  const subtotal = operationalWorkAreas.reduce((sum, workArea) => sum + workArea.estimatedRevenue, 0);
  const taxRate = toNumber(estimate.taxRate);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  return {
    estimateId: estimate.id,
    proposalNumber: estimate.proposalNumber,
    pricingBudgetId: estimate.pricingBudgetId,
    propertyLabel: estimate.propertyLabel,
    propertyAddressSnapshot: estimate.propertyAddressSnapshot,
    subtotal,
    taxRate,
    taxAmount,
    total,
    notes: typeof estimate.notes === 'string' ? estimate.notes : '',
    workAreas: operationalWorkAreas,
  };
}

function buildJobFromEstimate({ estimate, convertedAt, actorUserId, actorName, title, startDate, endDate, jobNumber }) {
  const operationalWorkAreas = buildJobWorkAreasFromEstimate(estimate);
  const snapshot = buildOriginalEstimateSnapshot(estimate, operationalWorkAreas);
  const hasExplicitSchedule = isNonEmptyString(startDate) || isNonEmptyString(endDate);
  const estimatedHours = operationalWorkAreas
    .flatMap((workArea) => workArea.lineItems)
    .filter((lineItem) => lineItem.category === 'labour')
    .reduce((sum, lineItem) => sum + lineItem.quantity, 0);

  return {
    id: generateId(),
    jobNumber,
    estimateId: estimate.id,
    sourceEstimateId: estimate.id,
    convertedFromEstimateAt: convertedAt,
    convertedByUserId: actorUserId,
    convertedByUserName: actorName,
    customerId: estimate.customerId,
    pricingBudgetId: estimate.pricingBudgetId,
    propertyLabel: estimate.propertyLabel,
    propertyAddressSnapshot: estimate.propertyAddressSnapshot,
    title: convertedJobTitle(estimate, title, jobNumber),
    description: typeof estimate.description === 'string' ? estimate.description : '',
    workAreas: operationalWorkAreas.map((workArea) => workArea.name),
    operationalWorkAreas,
    originalEstimateSnapshot: snapshot,
    status: 'scheduled',
    startDate: isNonEmptyString(startDate) ? startDate : convertedAt.slice(0, 10),
    endDate: isNonEmptyString(endDate) ? endDate : undefined,
    scheduleConfirmed: hasExplicitSchedule,
    scheduleAllDay: true,
    estimatedHours,
    actualHours: 0,
    estimatedCost: snapshot.subtotal,
    actualCosts: [],
    contractValue: snapshot.total,
    assignedEmployeeIds: [],
    notes: typeof estimate.notes === 'string' ? estimate.notes : '',
    createdAt: convertedAt,
    updatedAt: convertedAt,
  };
}

export function createEstimatesHandler(overrides = {}) {
  const deps = {
    requireSession,
    getEstimateForBusiness,
    reserveNextJobNumberForBusiness,
    convertEstimateToJobForBusiness,
    ...overrides,
  };

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const action = req.query.action;
    if (action !== 'convert-to-job') {
      return res.status(400).json({ ok: false, error: 'Invalid estimates action' });
    }

    const session = await deps.requireSession(req, res, ['owner', 'admin', 'foreman']);
    if (!session) return;

    const estimateId = req.body?.estimateId;
    if (!isNonEmptyString(estimateId)) {
      return res.status(400).json({ ok: false, error: 'Estimate id is required.' });
    }

    const estimate = await deps.getEstimateForBusiness(session.businessId, estimateId);
    if (!estimate) {
      return res.status(404).json({ ok: false, error: 'Estimate not found.' });
    }

    if (estimate.convertedToJobId) {
      return res.status(409).json({ ok: false, error: 'Estimate already converted.', convertedToJobId: estimate.convertedToJobId });
    }

    if (estimate.status !== 'accepted') {
      return res.status(409).json({ ok: false, error: 'Only accepted estimates can be converted.' });
    }

    const convertedAt = nowIso();
    const year = convertedAt.slice(0, 4);
    const jobNumber = await deps.reserveNextJobNumberForBusiness({
      businessId: session.businessId,
      year,
    });

    const job = buildJobFromEstimate({
      estimate,
      convertedAt,
      actorUserId: session.id,
      actorName: session.name,
      title: req.body?.title,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      jobNumber,
    });

    try {
      const result = await deps.convertEstimateToJobForBusiness({
        businessId: session.businessId,
        estimate,
        job,
        actorUserId: session.id,
        actorName: session.name,
        actorEmail: session.email,
        convertedAt,
      });

      if (!result.ok && result.code === 'ALREADY_CONVERTED') {
        return res.status(409).json({
          ok: false,
          error: 'Estimate already converted.',
          convertedToJobId: result.convertedToJobId,
        });
      }

      if (!result.ok) {
        return res.status(409).json({ ok: false, error: 'Estimate could not be converted due to a data conflict.' });
      }

      return res.status(200).json({
        ok: true,
        job,
        estimate: {
          id: estimate.id,
          status: 'converted',
          convertedToJobId: job.id,
          convertedAt,
          updatedAt: convertedAt,
        },
      });
    } catch {
      return res.status(500).json({ ok: false, error: 'Estimate conversion failed.' });
    }
  };
}

export default createEstimatesHandler();
