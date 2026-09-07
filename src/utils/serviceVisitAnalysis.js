import { calculateServiceEconomics, roundServiceMoney } from './servicePricingModel.js';

const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

function workedHours(entry) {
  const start = Date.parse(entry?.clockIn ?? '');
  const end = Date.parse(entry?.clockOut ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, (end - start) / 3600000 - number(entry.breakMinutes) / 60);
}

export function calculateServiceVisitAnalysis({ visit, service, timeEntries = [], actualCosts = [] }) {
  const visitEntries = timeEntries.filter((entry) => entry.workType === 'job' && entry.serviceVisitId === visit.id && entry.status === 'clocked_out');
  const linkedCosts = actualCosts.filter((cost) => cost.serviceVisitId === visit.id);
  const actualLabourHours = visitEntries.reduce((total, entry) => total + workedHours(entry), 0);
  const actualLabourCost = visitEntries.reduce((total, entry) => total + number(entry.labourCostTotalSnapshot), 0);
  const categoryCost = (category) => linkedCosts.filter((cost) => cost.category === category).reduce((total, cost) => total + number(cost.total), 0);
  const actualEquipmentCost = categoryCost('equipment');
  const actualMaterialCost = categoryCost('material');
  const actualSubcontractorCost = categoryCost('subcontractor');
  const actualVisitCost = actualLabourCost + actualEquipmentCost + actualMaterialCost + actualSubcontractorCost;
  const acceptedService = service.pricingSnapshot ? { ...service, ...service.pricingSnapshot } : service;
  const economics = calculateServiceEconomics(acceptedService);
  const estimatedLabourHours = (acceptedService.lineItems ?? [])
    .filter((item) => item.category === 'labour' && item.costScope !== 'service_period')
    .reduce((total, item) => total + number(item.quantity), 0);
  const allocatedVisitRevenue = service.billingType === 'contract' && economics.estimatedVisits > 0
    ? economics.contractedRevenue / economics.estimatedVisits
    : service.billingType === 'per_visit' ? economics.effectivePricePerVisit : 0;

  return {
    timeEntryCount: visitEntries.length,
    estimatedLabourHours: roundServiceMoney(estimatedLabourHours),
    actualLabourHours: roundServiceMoney(actualLabourHours),
    estimatedCostPerVisit: economics.loadedCostPerVisit,
    actualLabourCost: roundServiceMoney(actualLabourCost),
    actualEquipmentCost: roundServiceMoney(actualEquipmentCost),
    actualMaterialCost: roundServiceMoney(actualMaterialCost),
    actualSubcontractorCost: roundServiceMoney(actualSubcontractorCost),
    actualVisitCost: roundServiceMoney(actualVisitCost),
    costVariance: roundServiceMoney(actualVisitCost - economics.loadedCostPerVisit),
    allocatedVisitRevenue: roundServiceMoney(allocatedVisitRevenue),
    revenueBasis: service.billingType === 'contract' ? 'contract_allocation' : service.billingType === 'per_visit' ? 'accepted_per_visit_price' : 'not_calculated',
    billableAmount: service.billingType === 'per_visit' && visit.status === 'completed' ? roundServiceMoney(economics.effectivePricePerVisit) : undefined,
  };
}