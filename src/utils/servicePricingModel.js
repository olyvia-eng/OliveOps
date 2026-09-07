import { calculateSuggestedServiceVisits } from './workTypeModel.js';

const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const roundServiceMoney = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;

export function formatServiceFrequency(service) {
  if (service?.scheduleType === 'one_time') return 'One time';
  if (service?.scheduleType === 'as_needed') return 'As needed';
  const interval = Math.max(1, Math.trunc(number(service?.frequency?.interval) || 1));
  const unit = service?.frequency?.unit === 'day' || service?.frequency?.unit === 'month' ? service.frequency.unit : 'week';
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

export function resolveServiceEstimatedVisits(service) {
  if (service?.scheduleType === 'one_time') return 1;
  if (Number.isInteger(service?.estimatedVisits) && service.estimatedVisits >= 0) return service.estimatedVisits;
  return calculateSuggestedServiceVisits(service) ?? 0;
}

export function calculateServiceLineEconomics(lineItem) {
  const quantity = Math.max(0, number(lineItem?.quantity));
  const directRate = Math.max(0, number(lineItem?.directCostPerUnit, number(lineItem?.unitCost)));
  const recoveredRate = Math.max(directRate, number(lineItem?.recoveredCostPerUnit, directRate));
  const recommendedRate = Math.max(0, number(lineItem?.calculatedRateAtEstimate, number(lineItem?.recommendedRateAtEstimate, number(lineItem?.sellPrice))));
  const effectiveRate = Math.max(0, number(lineItem?.sellPrice, recommendedRate));
  const directCost = roundServiceMoney(quantity * directRate);
  const loadedCost = roundServiceMoney(quantity * recoveredRate);
  return {
    costScope: lineItem?.costScope === 'service_period' ? 'service_period' : 'per_visit',
    directCost,
    overhead: roundServiceMoney(loadedCost - directCost),
    loadedCost,
    recommendedSell: roundServiceMoney(quantity * recommendedRate),
    effectiveSell: roundServiceMoney(quantity * effectiveRate),
  };
}

export function calculateServiceEconomics(service) {
  const visits = resolveServiceEstimatedVisits(service);
  const categories = { labour: 0, equipment: 0, material: 0, subcontractor: 0 };
  let directCostPerVisit = 0;
  let overheadPerVisit = 0;
  let loadedCostPerVisit = 0;
  let recommendedPricePerVisit = 0;
  let linePricePerVisit = 0;
  let servicePeriodDirectCost = 0;
  let servicePeriodOverhead = 0;
  let servicePeriodCost = 0;
  let servicePeriodRecommendedSell = 0;
  let servicePeriodEffectiveSell = 0;

  for (const lineItem of Array.isArray(service?.lineItems) ? service.lineItems : []) {
    const line = calculateServiceLineEconomics(lineItem);
    const category = Object.prototype.hasOwnProperty.call(categories, lineItem.category) ? lineItem.category : 'labour';
    if (line.costScope === 'service_period') {
      servicePeriodDirectCost += line.directCost;
      servicePeriodOverhead += line.overhead;
      servicePeriodCost += line.loadedCost;
      servicePeriodRecommendedSell += line.recommendedSell;
      servicePeriodEffectiveSell += line.effectiveSell;
    } else {
      categories[category] += line.loadedCost;
      directCostPerVisit += line.directCost;
      overheadPerVisit += line.overhead;
      loadedCostPerVisit += line.loadedCost;
      recommendedPricePerVisit += line.recommendedSell;
      linePricePerVisit += line.effectiveSell;
    }
  }

  const configuredVisitPrice = service?.billingType === 'per_visit'
    ? service?.perVisitPricing?.customPricePerVisit
    : service?.pricing?.customPricePerVisit;
  const effectivePricePerVisit = configuredVisitPrice == null ? linePricePerVisit : Math.max(0, number(configuredVisitPrice));
  const calculatedServiceValue = roundServiceMoney(effectivePricePerVisit * visits + servicePeriodEffectiveSell);
  const recommendedContractValue = roundServiceMoney(recommendedPricePerVisit * visits + servicePeriodRecommendedSell);
  const contractPrice = service?.contractPricing?.customContractPrice == null
    ? calculatedServiceValue
    : Math.max(0, number(service.contractPricing.customContractPrice));
  const oneTimeCharge = service?.perVisitPricing?.oneTimeCharge == null
    ? servicePeriodEffectiveSell
    : Math.max(0, number(service.perVisitPricing.oneTimeCharge));
  const contractedRevenue = service?.billingType === 'contract' ? roundServiceMoney(contractPrice) : 0;
  const projectedPerVisitRevenue = service?.billingType === 'per_visit'
    ? roundServiceMoney(effectivePricePerVisit * visits + oneTimeCharge)
    : 0;
  const projectedTimeAndMaterialRevenue = service?.billingType === 'time_and_material'
    ? calculatedServiceValue
    : 0;
  const estimatedRevenue = roundServiceMoney(contractedRevenue + projectedPerVisitRevenue + projectedTimeAndMaterialRevenue);
  const estimatedCost = roundServiceMoney(loadedCostPerVisit * visits + servicePeriodCost);
  const estimatedProfit = roundServiceMoney(estimatedRevenue - estimatedCost);

  return {
    estimatedVisits: visits,
    categories: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, roundServiceMoney(value)])),
    directCostPerVisit: roundServiceMoney(directCostPerVisit),
    overheadPerVisit: roundServiceMoney(overheadPerVisit),
    loadedCostPerVisit: roundServiceMoney(loadedCostPerVisit),
    recommendedPricePerVisit: roundServiceMoney(recommendedPricePerVisit),
    effectivePricePerVisit: roundServiceMoney(effectivePricePerVisit),
    servicePeriodDirectCost: roundServiceMoney(servicePeriodDirectCost),
    servicePeriodOverhead: roundServiceMoney(servicePeriodOverhead),
    servicePeriodCost: roundServiceMoney(servicePeriodCost),
    servicePeriodRecommendedSell: roundServiceMoney(servicePeriodRecommendedSell),
    servicePeriodEffectiveSell: roundServiceMoney(servicePeriodEffectiveSell),
    calculatedServiceValue,
    recommendedContractValue,
    contractedRevenue,
    projectedPerVisitRevenue,
    projectedTimeAndMaterialRevenue,
    estimatedRevenue,
    estimatedCost,
    estimatedProfit,
    estimatedMarginPercent: estimatedRevenue > 0 ? estimatedProfit / estimatedRevenue * 100 : 0,
  };
}

export function calculateServiceEstimateTotals(services, taxRate = 0) {
  const serviceEconomics = (Array.isArray(services) ? services : []).map((service) => ({ service, economics: calculateServiceEconomics(service) }));
  const sum = (field) => roundServiceMoney(serviceEconomics.reduce((total, row) => total + row.economics[field], 0));
  const categories = Object.fromEntries(['labour', 'equipment', 'material', 'subcontractor'].map((category) => [category, roundServiceMoney(serviceEconomics.reduce((total, row) => total + row.economics.categories[category] * row.economics.estimatedVisits, 0))]));
  const contractedRevenue = sum('contractedRevenue');
  const projectedPerVisitRevenue = sum('projectedPerVisitRevenue');
  const projectedTimeAndMaterialRevenue = sum('projectedTimeAndMaterialRevenue');
  const estimatedRevenue = roundServiceMoney(contractedRevenue + projectedPerVisitRevenue + projectedTimeAndMaterialRevenue);
  const estimatedCost = sum('estimatedCost');
  const estimatedProfit = roundServiceMoney(estimatedRevenue - estimatedCost);
  const normalizedTaxRate = Math.min(100, Math.max(0, number(taxRate)));
  const estimatedTax = roundServiceMoney(estimatedRevenue * normalizedTaxRate / 100);
  const contractedTax = roundServiceMoney(contractedRevenue * normalizedTaxRate / 100);
  return { serviceEconomics, categories, contractedRevenue, projectedPerVisitRevenue, projectedTimeAndMaterialRevenue, estimatedRevenue, estimatedCost, estimatedProfit, estimatedMarginPercent: estimatedRevenue > 0 ? estimatedProfit / estimatedRevenue * 100 : 0, taxRate: normalizedTaxRate, estimatedTax, estimatedTotalWithTax: roundServiceMoney(estimatedRevenue + estimatedTax), contractedTotalWithTax: roundServiceMoney(contractedRevenue + contractedTax) };
}

export function validateServicePricing(service) {
  const items = Array.isArray(service?.lineItems) ? service.lineItems : [];
  for (const item of items) {
    if (item?.costScope !== 'per_visit' && item?.costScope !== 'service_period') return 'Service resource cost scope is invalid.';
    for (const field of ['quantity', 'unitCost', 'sellPrice']) if (!Number.isFinite(item?.[field]) || item[field] < 0) return `Service resource ${field} must be zero or greater.`;
    if (item.pricingReadiness === 'needs_review') return 'Every Service resource requires valid pricing.';
  }
  const economics = calculateServiceEconomics(service);
  if (service?.billingType === 'contract' && economics.contractedRevenue <= 0) return 'Contract Services require a valid Contract Price.';
  if (service?.billingType === 'per_visit' && economics.effectivePricePerVisit <= 0) return 'Per-Visit Services require a valid Price per Visit.';
  if (service?.billingType === 'time_and_material' && items.length === 0) return 'Time & Material Services require at least one priced resource.';
  return null;
}