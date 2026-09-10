const text = (value) => String(value ?? '').trim();

export const proposalMoney = (value) => new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
}).format(Number(value) || 0);

export const proposalDisplayDate = (value, month = 'long') => {
  if (!text(value)) return '';
  const date = new Date(`${text(value).slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month,
    day: 'numeric',
    timeZone: 'UTC',
  });
};

export const proposalTextBlocks = (value) => text(value)
  .split(/\r\n?|\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const ordered = /^(\d+)[.)]\s+(.+)$/.exec(line);
    if (ordered) return { kind: 'list-item', marker: `${ordered[1]}.`, text: ordered[2].replace(/\*\*|__/g, '') };
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) return { kind: 'list-item', marker: '•', text: bullet[1].replace(/\*\*|__/g, '') };
    return { kind: 'paragraph', text: line.replace(/^#{1,6}\s+/, '').replace(/\*\*|__/g, '') };
  });

export function buildProposalPresentation(snapshot) {
  const isService = snapshot?.workType === 'service';
  const company = snapshot?.company ?? {};
  const proposal = snapshot?.proposal ?? {};
  const customer = snapshot?.customer ?? {};
  const workAreas = Array.isArray(snapshot?.workAreas) ? snapshot.workAreas : [];
  const services = Array.isArray(snapshot?.services) ? snapshot.services : [];
  const payments = Array.isArray(snapshot?.paymentSchedule) ? snapshot.paymentSchedule : [];
  const serviceSummary = snapshot?.servicePricingSummary;

  const totalRows = isService && serviceSummary
    ? [
        { key: 'contracted', label: 'Contracted services', value: serviceSummary.contractedRevenue, displayValue: proposalMoney(serviceSummary.contractedRevenue) },
        { key: 'per-visit', label: 'Projected per-visit services', value: serviceSummary.projectedPerVisitRevenue, displayValue: proposalMoney(serviceSummary.projectedPerVisitRevenue) },
        { key: 'time-material', label: 'Projected time & material', value: serviceSummary.projectedTimeAndMaterialRevenue, displayValue: proposalMoney(serviceSummary.projectedTimeAndMaterialRevenue) },
      ]
    : [{ key: 'subtotal', label: 'Subtotal', value: proposal.subtotal, displayValue: proposalMoney(proposal.subtotal) }];
  totalRows.push({
    key: 'tax',
    label: `${isService ? 'Estimated ' : ''}${text(proposal.taxLabel) || 'Tax'} (${Number(proposal.taxRate) || 0}%)`,
    value: proposal.taxAmount,
    displayValue: proposalMoney(proposal.taxAmount),
  });

  return {
    source: snapshot,
    workType: isService ? 'service' : 'project',
    company: {
      name: text(company.name) || 'Contractor',
      logoDataUrl: text(company.logoDataUrl),
      details: [company.address, [company.phone, company.email].map(text).filter(Boolean).join(' | '), company.website].map(text).filter(Boolean),
    },
    document: {
      label: 'Proposal',
      number: text(proposal.number),
      title: text(proposal.title),
    },
    information: [
      { key: 'customer', label: 'Prepared for', value: text(customer.displayName) || 'Client', details: [customer.contactName, customer.billingAddress, customer.email, customer.phone].map(text).filter(Boolean) },
      { key: 'property', label: 'Property', value: text(proposal.title), details: [proposal.projectAddress].map(text).filter(Boolean) },
      { key: 'issued', label: 'Issue date', value: proposalDisplayDate(proposal.date) },
      { key: 'valid', label: 'Valid until', value: proposalDisplayDate(proposal.validUntil) },
    ],
    introduction: text(proposal.introduction),
    workAreas: workAreas.map((area) => ({
      name: text(area.name),
      subtotal: Number(area.subtotal) || 0,
      displayPrice: proposalMoney(area.subtotal),
      scopeRichText: area.scopeRichText,
      scopeLines: Array.isArray(area.scopeLines) && area.scopeLines.length ? area.scopeLines.map(text).filter(Boolean) : ['Scope details to be confirmed.'],
    })),
    services: services.map((service) => ({
      ...service,
      name: text(service.name),
      description: text(service.description),
      displayPrice: service.billingType === 'contract'
        ? proposalMoney(service.contractPrice)
        : service.billingType === 'per_visit'
          ? `${proposalMoney(service.effectivePricePerVisit)} / visit`
          : 'Time & Material',
      displayOneTimeCharge: proposalMoney(service.oneTimeCharge),
      customerRates: (service.customerRates ?? []).map((rate) => ({ ...rate, displayRate: proposalMoney(rate.sellRate) })),
      scheduleSummary: `${text(service.scheduleLabel)} · ${Number(service.estimatedVisits) || 0} estimated visit${Number(service.estimatedVisits) === 1 ? '' : 's'}`,
    })),
    totals: {
      rows: totalRows,
      label: isService ? 'Estimated Total' : 'Total',
      value: Number(proposal.total) || 0,
      displayValue: proposalMoney(proposal.total),
    },
    paymentSchedule: payments.map((payment, index) => ({
      index: index + 1,
      id: payment.id,
      label: text(payment.label),
      due: text(payment.due),
      percentage: payment.type === 'percentage' ? Number(payment.percentage) || 0 : null,
      percentageLabel: payment.type === 'percentage' ? `${Number(payment.percentage) || 0}%` : '',
      amount: Number(payment.amount) || 0,
      displayAmount: proposalMoney(payment.amount),
    })),
    sections: [
      { key: 'notes', label: 'Notes', value: text(proposal.notes) },
      { key: 'exclusions', label: 'Exclusions', value: text(proposal.exclusions) },
      { key: 'terms', label: 'Terms & Conditions', value: text(proposal.terms) },
    ].filter((section) => section.value).map((section) => ({ ...section, blocks: proposalTextBlocks(section.value) })),
  };
}