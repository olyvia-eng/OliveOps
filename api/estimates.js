import { requireSession } from './_lib/session.js';
import {
  convertEstimateToJobForBusiness,
  generateId,
  getEstimateForBusiness,
  reserveNextJobNumberForBusiness,
} from './_lib/authRepo.js';
import {
  JOB_PLANNING_SNAPSHOT_VERSION,
  calculateJobPlan,
  cloneJobPlan,
} from '../src/utils/jobPlanModel.js';
import { normalizeEstimateServices, resolveWorkType } from '../src/utils/workTypeModel.js';
import { calculateServiceEstimateTotals } from '../src/utils/servicePricingModel.js';
import { buildGeneratedServiceVisits } from '../src/utils/serviceVisitModel.js';
import { estimateLineEffectiveQuantity, estimateLineWorkers } from '../src/utils/estimatePricingModel.js';
import { createGeneratedServiceVisitsForBusiness } from './_lib/serviceVisitRepo.js';
import { getProposalVersionForBusiness } from './_lib/proposalRepo.js';
import { calculateProposalPaymentSchedule } from '../src/utils/proposalPaymentSchedule.js';
import { buildContractBillingSchedule } from '../src/utils/contractBillingModel.js';

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

function acceptedBillingSnapshot(estimate, estimateSnapshot, proposalVersion) {
  if (proposalVersion?.snapshot) {
    return { ...structuredClone(proposalVersion.snapshot), id: proposalVersion.id, versionNumber: proposalVersion.versionNumber };
  }
  const paymentSchedule = calculateProposalPaymentSchedule(estimate.paymentSchedule, estimateSnapshot.total);
  return {
    proposal: {
      subtotal: estimateSnapshot.subtotal,
      taxRate: estimateSnapshot.taxRate,
      taxAmount: estimateSnapshot.taxAmount,
      total: estimateSnapshot.total,
    },
    paymentSchedule: paymentSchedule.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      type: stage.type,
      percentage: stage.percentage,
      due: stage.due,
      amount: stage.calculatedAmount,
      sortOrder: stage.sortOrder,
    })),
  };
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
  const workers = estimateLineWorkers(rawLineItem);
  const quantity = estimateLineEffectiveQuantity({ ...rawLineItem, workers });
  const unitCost = toNumber(rawLineItem.unitCost);
  const markupPercent = toNumber(rawLineItem.markupPercent, toNumber(rawLineItem.markup));
  const computedSellPrice = unitCost * (1 + (markupPercent / 100));
  const sellPrice = toNumber(rawLineItem.sellPrice, computedSellPrice);
  const total = toNumber(rawLineItem.total, quantity * sellPrice);

  return {
    ...rawLineItem,
    id: generateId(),
    sourceEstimateLineItemId: rawLineItem.id,
    sourceEstimateWorkAreaId,
    contractRevenue: total,
    plannedCost: quantity * unitCost,
    recommendedSellPriceAtAddition: rawLineItem.recommendedRateAtEstimate ?? rawLineItem.calculatedRateAtEstimate ?? sellPrice,
    estimatedCost: toNumber(rawLineItem.estimatedCost, quantity * unitCost),
    estimatedSell: toNumber(rawLineItem.estimatedSell, total),
    category: rawLineItem.category,
    ...(rawLineItem.category === 'labour' ? { workers, hoursPerWorker: toNumber(rawLineItem.quantity) } : {}),
    itemName: isNonEmptyString(rawLineItem.itemName) ? rawLineItem.itemName.trim() : (isNonEmptyString(rawLineItem.description) ? rawLineItem.description.trim() : 'Line Item'),
    description: typeof rawLineItem.description === 'string' ? rawLineItem.description : '',
    quantity,
    unit: isNonEmptyString(rawLineItem.unit) ? rawLineItem.unit.trim() : 'unit',
    unitCost,
    sellPrice,
    total,
  };
}

export function buildJobWorkAreasFromEstimate(estimate) {
  const workAreas = normalizeEstimateWorkAreas(estimate)
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
      const estimatedCost = lineItems.reduce((sum, lineItem) => sum + lineItem.estimatedCost, 0);

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
  return calculateJobPlan(workAreas).operationalWorkAreas;
}

export function buildOriginalEstimateSnapshot(estimate, operationalWorkAreas) {
  const subtotal = operationalWorkAreas.reduce((sum, workArea) => sum + workArea.estimatedRevenue, 0);
  const taxRate = toNumber(estimate.taxRate);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;
  const estimatedCost = operationalWorkAreas.reduce((sum, workArea) => sum + workArea.plannedCost, 0);
  const estimatedProfit = subtotal - estimatedCost;

  return {
    estimateId: estimate.id,
    workType: 'project',
    customerId: estimate.customerId,
    proposalNumber: estimate.proposalNumber,
    pricingBudgetId: estimate.pricingBudgetId,
    propertyLabel: estimate.propertyLabel,
    propertyAddressSnapshot: estimate.propertyAddressSnapshot,
    subtotal,
    taxRate,
    taxAmount,
    total,
    estimatedCost,
    estimatedProfit,
    estimatedMarginPct: subtotal > 0 ? (estimatedProfit / subtotal) * 100 : 0,
    notes: typeof estimate.notes === 'string' ? estimate.notes : '',
    workAreas: cloneJobPlan(operationalWorkAreas),
  };
}

function buildServiceEstimateSnapshot(estimate, services) {
  const totals = calculateServiceEstimateTotals(services, estimate.taxRate);
  return {
    estimateId: estimate.id,
    workType: 'service',
    customerId: estimate.customerId,
    proposalNumber: estimate.proposalNumber,
    pricingBudgetId: estimate.pricingBudgetId,
    propertyLabel: estimate.propertyLabel,
    propertyAddressSnapshot: estimate.propertyAddressSnapshot,
    subtotal: totals.estimatedRevenue,
    contractedRevenue: totals.contractedRevenue,
    projectedPerVisitRevenue: totals.projectedPerVisitRevenue,
    projectedTimeAndMaterialRevenue: totals.projectedTimeAndMaterialRevenue,
    taxRate: totals.taxRate,
    taxAmount: totals.estimatedTax,
    total: totals.estimatedTotalWithTax,
    contractedTotalWithTax: totals.contractedTotalWithTax,
    estimatedCost: totals.estimatedCost,
    estimatedProfit: totals.estimatedProfit,
    estimatedMarginPct: totals.estimatedMarginPercent,
    notes: typeof estimate.notes === 'string' ? estimate.notes : '',
    workAreas: [],
    services: structuredClone(services),
    serviceStartDate: estimate.serviceStartDate,
    serviceEndDate: estimate.serviceEndDate,
    acceptedProposalVersionId: estimate.activeProposalVersionId,
    proposalVersionNumber: estimate.proposalVersionNumber,
  };
}

function buildServiceJobFromEstimate({ estimate, acceptedProposalVersion, convertedAt, actorUserId, actorName, title, startDate, endDate, jobNumber }) {
  const acceptedServices = normalizeEstimateServices(estimate.services, generateId);
  const totals = calculateServiceEstimateTotals(acceptedServices, estimate.taxRate);
  const firstServiceStart = acceptedServices.map((service) => service.startDate).filter(Boolean).sort()[0];
  const lastServiceEnd = acceptedServices.map((service) => service.endDate).filter(Boolean).sort().at(-1);
  const jobStartDate = isNonEmptyString(startDate)
    ? startDate
    : (estimate.serviceStartDate ?? firstServiceStart ?? convertedAt.slice(0, 10));
  const jobEndDate = isNonEmptyString(endDate)
    ? endDate
    : (estimate.serviceEndDate ?? lastServiceEnd);

  const originalEstimateSnapshot = buildServiceEstimateSnapshot(estimate, acceptedServices);
  const contractBillingSchedule = buildContractBillingSchedule(acceptedBillingSnapshot(estimate, originalEstimateSnapshot, acceptedProposalVersion));
  return {
    id: generateId(),
    workType: 'service',
    jobNumber,
    estimateId: estimate.id,
    sourceEstimateId: estimate.id,
    convertedFromEstimateAt: convertedAt,
    convertedByUserId: actorUserId,
    convertedByUserName: actorName,
    customerId: estimate.customerId,
    pricingBudgetId: estimate.pricingBudgetId,
    divisionId: estimate.divisionId,
    propertyLabel: estimate.propertyLabel,
    propertyAddressSnapshot: estimate.propertyAddressSnapshot,
    title: convertedJobTitle(estimate, title, jobNumber),
    description: typeof estimate.description === 'string' ? estimate.description : '',
    workAreas: [],
    services: acceptedServices.map((service) => ({
      ...structuredClone(service),
      sourceEstimateServiceId: service.id,
      status: 'active',
      pricingSnapshot: {
        billingType: service.billingType,
        lineItems: structuredClone(service.lineItems ?? []),
        pricing: structuredClone(service.pricing),
        contractPricing: structuredClone(service.contractPricing),
        perVisitPricing: structuredClone(service.perVisitPricing),
        timeAndMaterialPricing: structuredClone(service.timeAndMaterialPricing),
      },
      operationalSchedule: {
        startDate: service.startDate,
        endDate: service.endDate,
        preferredWeekdays: service.scheduleType === 'recurring' && service.startDate
          ? [new Date(`${service.startDate}T12:00:00.000Z`).getUTCDay()]
          : [],
        monthlyDay: service.startDate ? Number(service.startDate.slice(8, 10)) : undefined,
        startTime: '',
        durationMinutes: 60,
        defaultEmployeeIds: [],
        defaultEquipmentIds: [],
        revision: 1,
      },
    })),
    originalEstimateSnapshot,
    ...(contractBillingSchedule.items.length ? { contractBillingSchedule } : {}),
    status: 'scheduled',
    startDate: jobStartDate,
    endDate: jobEndDate,
    scheduleConfirmed: isNonEmptyString(startDate) || isNonEmptyString(endDate),
    scheduleAllDay: true,
    estimatedHours: 0,
    actualHours: 0,
    estimatedCost: totals.estimatedCost,
    currentPlannedCost: totals.estimatedCost,
    originalContractRevenue: totals.contractedRevenue,
    currentContractRevenue: totals.contractedRevenue,
    actualCosts: [],
    contractValue: totals.contractedRevenue,
    assignedEmployeeIds: [],
    notes: typeof estimate.notes === 'string' ? estimate.notes : '',
    createdAt: convertedAt,
    updatedAt: convertedAt,
  };
}

function buildJobFromEstimate({ estimate, acceptedProposalVersion, convertedAt, actorUserId, actorName, title, startDate, endDate, jobNumber }) {
  if (resolveWorkType(estimate) === 'service') {
    return buildServiceJobFromEstimate({ estimate, acceptedProposalVersion, convertedAt, actorUserId, actorName, title, startDate, endDate, jobNumber });
  }
  const operationalWorkAreas = buildJobWorkAreasFromEstimate(estimate);
  const snapshot = buildOriginalEstimateSnapshot(estimate, operationalWorkAreas);
  const plan = calculateJobPlan(operationalWorkAreas);
  const hasExplicitSchedule = isNonEmptyString(startDate) || isNonEmptyString(endDate);
  const estimatedHours = operationalWorkAreas
    .flatMap((workArea) => workArea.lineItems)
    .filter((lineItem) => lineItem.category === 'labour')
    .reduce((sum, lineItem) => sum + lineItem.quantity, 0);

  return {
    id: generateId(),
    workType: 'project',
    jobNumber,
    estimateId: estimate.id,
    sourceEstimateId: estimate.id,
    convertedFromEstimateAt: convertedAt,
    convertedByUserId: actorUserId,
    convertedByUserName: actorName,
    customerId: estimate.customerId,
    pricingBudgetId: estimate.pricingBudgetId,
    divisionId: estimate.divisionId,
    propertyLabel: estimate.propertyLabel,
    propertyAddressSnapshot: estimate.propertyAddressSnapshot,
    title: convertedJobTitle(estimate, title, jobNumber),
    description: typeof estimate.description === 'string' ? estimate.description : '',
    workAreas: operationalWorkAreas.map((workArea) => workArea.name),
    operationalWorkAreas: cloneJobPlan(plan.operationalWorkAreas),
    originalEstimateSnapshot: snapshot,
    ...(estimate.paymentSchedule?.length || acceptedProposalVersion?.snapshot?.paymentSchedule?.length
      ? { contractBillingSchedule: buildContractBillingSchedule(acceptedBillingSnapshot(estimate, snapshot, acceptedProposalVersion)) }
      : {}),
    planningSnapshotVersion: JOB_PLANNING_SNAPSHOT_VERSION,
    planningRevision: 1,
    status: 'scheduled',
    startDate: isNonEmptyString(startDate) ? startDate : convertedAt.slice(0, 10),
    endDate: isNonEmptyString(endDate) ? endDate : undefined,
    scheduleConfirmed: hasExplicitSchedule,
    scheduleAllDay: true,
    estimatedHours,
    actualHours: 0,
    estimatedCost: plan.currentPlannedCost,
    currentPlannedCost: plan.currentPlannedCost,
    originalContractRevenue: snapshot.subtotal,
    currentContractRevenue: snapshot.subtotal,
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
    getProposalVersionForBusiness,
    createGeneratedServiceVisitsForBusiness,
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

    const acceptedProposalVersion = estimate.activeProposalVersionId && Number.isInteger(estimate.proposalVersionNumber) && estimate.proposalVersionNumber > 0
      ? await deps.getProposalVersionForBusiness(session.businessId, estimate.id, estimate.proposalVersionNumber)
      : null;
    if (estimate.activeProposalVersionId && (!acceptedProposalVersion || acceptedProposalVersion.id !== estimate.activeProposalVersionId)) {
      return res.status(409).json({ ok: false, error: 'The accepted Proposal snapshot could not be loaded.' });
    }

    const convertedAt = nowIso();
    const year = convertedAt.slice(0, 4);
    const jobNumber = await deps.reserveNextJobNumberForBusiness({
      businessId: session.businessId,
      year,
    });

    const job = buildJobFromEstimate({
      estimate,
      acceptedProposalVersion,
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

      let visitGeneration = null;
      if (job.workType === 'service') {
        const visits = job.services.flatMap((service) => buildGeneratedServiceVisits({
          businessId: session.businessId,
          job,
          service,
          now: convertedAt,
        }));
        try {
          const generated = await deps.createGeneratedServiceVisitsForBusiness({ businessId: session.businessId, visits });
          visitGeneration = { ok: true, createdCount: generated.created.length, existingCount: generated.existing.length };
        } catch {
          visitGeneration = { ok: false, recoverable: true, error: 'Initial Visits could not be generated. Retry from the Service Job.' };
        }
      }

      return res.status(200).json({
        ok: true,
        job,
        visitGeneration,
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
