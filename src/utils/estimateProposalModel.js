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