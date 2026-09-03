const INTERNAL_FALLBACK_LABELS = new Set(['labour', 'labor', 'equipment', 'material', 'materials', 'subcontractor', 'subcontractors']);

const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

export function formatProposalAddress(address) {
  if (typeof address === 'string') return address.trim();
  if (!address || typeof address !== 'object') return '';
  return [address.street, address.city, address.province, address.postalCode, address.country].map(text).filter(Boolean).join(', ');
}

function customerFacingDescription(line) {
  const description = text(line?.description);
  const itemName = text(line?.itemName);
  if (description && !INTERNAL_FALLBACK_LABELS.has(description.toLowerCase())) return description;
  if (itemName && !INTERNAL_FALLBACK_LABELS.has(itemName.toLowerCase())) return itemName;
  return 'Included work';
}

export function buildEstimateProposalProjection({ estimate, customer, business }) {
  const workAreas = Array.isArray(estimate?.workAreas) && estimate.workAreas.some((area) => area && typeof area === 'object')
    ? estimate.workAreas
    : [{ id: 'general', name: 'General', description: '', sortOrder: 0, lineItems: Array.isArray(estimate?.lineItems) ? estimate.lineItems : [] }];
  const projectedWorkAreas = workAreas
    .filter((area) => area && typeof area === 'object')
    .slice()
    .sort((left, right) => number(left.sortOrder) - number(right.sortOrder))
    .map((area, index) => {
      const descriptions = [];
      const seenDescriptions = new Set();
      for (const candidate of [text(area.description), ...(Array.isArray(area.lineItems) ? area.lineItems.map(customerFacingDescription) : [])]) {
        const key = candidate.toLocaleLowerCase('en-CA');
        if (!candidate || seenDescriptions.has(key)) continue;
        seenDescriptions.add(key);
        descriptions.push(candidate);
      }
      return {
        name: text(area.name) || `Work Area ${index + 1}`,
        descriptions,
        subtotal: (Array.isArray(area.lineItems) ? area.lineItems : []).reduce((sum, line) => sum + number(line?.total), 0),
      };
    });
  const subtotal = projectedWorkAreas.reduce((sum, area) => sum + area.subtotal, 0);
  const taxRate = Math.max(0, number(estimate?.taxRate));
  const taxAmount = subtotal * (taxRate / 100);

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
      date: text(estimate?.createdAt),
      validUntil: text(estimate?.validUntil),
      title: text(estimate?.title),
      introduction: text(estimate?.description),
      projectAddress: text(estimate?.propertyAddressSnapshot),
      taxRate,
      taxLabel: text(business?.taxLabel) || 'Tax',
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      notes: text(estimate?.notes),
      exclusions: text(estimate?.exclusions),
      terms: text(business?.proposalTerms),
    },
    customer: {
      displayName: text(customer?.company) || text(customer?.name) || 'Client',
      contactName: text(customer?.company) ? text(customer?.name) : '',
      billingAddress: formatProposalAddress(customer?.billingAddress ?? customer?.mailingAddress ?? customer?.address),
      email: text(customer?.email),
      phone: text(customer?.phone),
    },
    workAreas: projectedWorkAreas,
  };
}