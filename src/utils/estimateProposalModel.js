import { calculateProposalPaymentSchedule } from './proposalPaymentSchedule.js';
import { calculateServiceEstimateTotals, calculateServiceEconomics, formatServiceFrequency } from './servicePricingModel.js';
import { resolveWorkType } from './workTypeModel.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

function sanitizeScopeLines(value) {
  if (typeof value !== 'string') return [];
  const sanitized = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127);
    })
    .join('');
  return sanitized.split(/\r\n?|\n/).map((line) => line.trim()).filter(Boolean);
}

export function formatProposalAddress(address) {
  if (typeof address === 'string') return address.trim();
  if (!address || typeof address !== 'object') return '';
  return [address.street, address.city, address.province, address.postalCode, address.country].map(text).filter(Boolean).join(', ');
}

export function buildEstimateProposalProjection({ estimate, customer, business }) {
  if (resolveWorkType(estimate) === 'service') return buildServiceProposalProjection({ estimate, customer, business });
  const workAreas = Array.isArray(estimate?.workAreas) && estimate.workAreas.some((area) => area && typeof area === 'object')
    ? estimate.workAreas
    : [{ id: 'general', name: 'General', description: '', sortOrder: 0, lineItems: Array.isArray(estimate?.lineItems) ? estimate.lineItems : [] }];
  const projectedWorkAreas = workAreas
    .filter((area) => area && typeof area === 'object')
    .slice()
    .sort((left, right) => number(left.sortOrder) - number(right.sortOrder))
    .map((area, index) => {
      const scopeLines = sanitizeScopeLines(area.description);
      return {
        name: text(area.name) || `Work Area ${index + 1}`,
        scopeLines: scopeLines.length ? scopeLines : ['Scope details to be confirmed.'],
        subtotal: (Array.isArray(area.lineItems) ? area.lineItems : []).reduce((sum, line) => sum + number(line?.total), 0),
      };
    });
  const subtotal = projectedWorkAreas.reduce((sum, area) => sum + area.subtotal, 0);
  const taxRate = Math.max(0, number(estimate?.taxRate));
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;
  const paymentSchedule = calculateProposalPaymentSchedule(estimate?.paymentSchedule, total);

  return {
    company: {
      name: text(business?.legalName) || text(business?.name),
      phone: text(business?.phone),
      email: text(business?.email),
      website: text(business?.website),
      address: text(business?.businessAddress),
      logoDataUrl: /^data:image\/(?:png|jpe?g);base64,/i.test(text(business?.logoDataUrl)) ? text(business.logoDataUrl) : '',
    },
    proposal: {
      number: text(estimate?.proposalNumber),
      status: text(estimate?.status) || 'draft',
      date: text(estimate?.createdAt),
      validUntil: text(estimate?.validUntil),
      title: text(estimate?.title),
      introduction: text(estimate?.description),
      projectAddress: text(estimate?.propertyAddressSnapshot),
      taxRate,
      taxLabel: text(business?.taxLabel) || 'Tax',
      subtotal,
      taxAmount,
      total,
      notes: text(estimate?.notes),
      exclusions: text(estimate?.exclusions),
      terms: text(estimate?.proposalTerms) || text(business?.proposalTerms),
    },
    customer: {
      displayName: text(customer?.company) || text(customer?.name) || 'Client',
      contactName: text(customer?.company) ? text(customer?.name) : '',
      billingAddress: formatProposalAddress(customer?.billingAddress ?? customer?.mailingAddress ?? customer?.address),
      email: text(customer?.email),
      phone: text(customer?.phone),
    },
    workAreas: projectedWorkAreas,
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

function buildServiceProposalProjection({ estimate, customer, business }) {
  const totals = calculateServiceEstimateTotals(estimate?.services, estimate?.taxRate);
  const services = (Array.isArray(estimate?.services) ? estimate.services : []).slice().sort((left, right) => number(left.sortOrder) - number(right.sortOrder)).map((service) => {
    const economics = calculateServiceEconomics(service);
    const customerRates = (Array.isArray(service.lineItems) ? service.lineItems : []).map((line) => ({ category: line.category, name: text(line.itemName) || text(line.description), quantity: number(line.quantity), unit: text(line.unit) || 'unit', sellRate: number(line.sellPrice), costScope: line.costScope === 'service_period' ? 'service_period' : 'per_visit' }));
    return {
      id: service.id,
      name: text(service.name) || 'Service',
      description: text(service.description),
      scheduleLabel: formatServiceFrequency(service),
      scheduleType: service.scheduleType,
      billingType: service.billingType,
      startDate: text(service.startDate),
      endDate: text(service.endDate),
      estimatedVisits: economics.estimatedVisits,
      effectivePricePerVisit: economics.effectivePricePerVisit,
      contractPrice: economics.contractedRevenue,
      projectedRevenue: economics.projectedPerVisitRevenue + economics.projectedTimeAndMaterialRevenue,
      oneTimeCharge: service.billingType === 'per_visit'
        ? number(service.perVisitPricing?.oneTimeCharge ?? economics.servicePeriodEffectiveSell)
        : economics.servicePeriodEffectiveSell,
      customerRates,
      timeAndMaterialNotes: text(service.timeAndMaterialPricing?.notes),
    };
  });
  const paymentSchedule = calculateProposalPaymentSchedule(estimate?.paymentSchedule, totals.contractedTotalWithTax);
  return {
    workType: 'service',
    company: { name: text(business?.legalName) || text(business?.name), phone: text(business?.phone), email: text(business?.email), website: text(business?.website), address: text(business?.businessAddress), logoDataUrl: /^data:image\/(?:png|jpe?g);base64,/i.test(text(business?.logoDataUrl)) ? text(business.logoDataUrl) : '' },
    proposal: { number: text(estimate?.proposalNumber), status: text(estimate?.status) || 'draft', date: text(estimate?.createdAt), validUntil: text(estimate?.validUntil), title: text(estimate?.title), introduction: text(estimate?.description), projectAddress: text(estimate?.propertyAddressSnapshot), taxRate: totals.taxRate, taxLabel: text(business?.taxLabel) || 'Tax', subtotal: totals.estimatedRevenue, taxAmount: totals.estimatedTax, total: totals.estimatedTotalWithTax, notes: text(estimate?.notes), exclusions: text(estimate?.exclusions), terms: text(estimate?.proposalTerms) || text(business?.proposalTerms) },
    customer: { displayName: text(customer?.company) || text(customer?.name) || 'Client', contactName: text(customer?.company) ? text(customer?.name) : '', billingAddress: formatProposalAddress(customer?.billingAddress ?? customer?.mailingAddress ?? customer?.address), email: text(customer?.email), phone: text(customer?.phone) },
    workAreas: [],
    services,
    servicePricingSummary: { contractedRevenue: totals.contractedRevenue, projectedPerVisitRevenue: totals.projectedPerVisitRevenue, projectedTimeAndMaterialRevenue: totals.projectedTimeAndMaterialRevenue, estimatedRevenue: totals.estimatedRevenue, estimatedTax: totals.estimatedTax, estimatedTotalWithTax: totals.estimatedTotalWithTax, contractedTotalWithTax: totals.contractedTotalWithTax },
    paymentSchedule: paymentSchedule.stages.map((stage) => ({ id: stage.id, label: stage.label, type: stage.type, percentage: stage.percentage, due: stage.due, amount: stage.calculatedAmount, sortOrder: stage.sortOrder })),
  };
}