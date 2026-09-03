import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEstimateProposalProjection } from '../src/utils/estimateProposalModel.js';

const estimate = {
  id: 'estimate-a', proposalNumber: 'PROP-2026-0042', title: 'Patio & Grading', description: 'A customer introduction.',
  propertyAddressSnapshot: '20 Project Road, Toronto, ON', createdAt: '2026-09-01T10:00:00.000Z', validUntil: '2026-10-01', taxRate: 13,
  notes: 'Customer-facing note.', internalNotes: 'Never print this.', estimatedProfit: 9000, margin: 40, overhead: 2000,
  workAreas: [{
    id: 'patio', name: 'Patio', description: 'Excavate and prepare the patio area\n\nInstall interlocking stone\u0000\u0007', sortOrder: 0,
    lineItems: [
      { category: 'labour', itemName: 'John Smith', description: 'Assigned employee record', quantity: 10, unit: 'hr', unitCost: 25, sellPrice: 80, total: 800, employeeName: 'Mike White', overheadRecoveryPerHour: 20 },
      { category: 'equipment', itemName: 'Bobcat e50', description: 'Equipment catalog record', quantity: 4, unit: 'hr', unitCost: 50, sellPrice: 125, total: 500 },
      { category: 'material', itemName: 'HPB Aggregate', description: 'Material catalog record', quantity: 1, unit: 'lot', unitCost: 1000, sellPrice: 1500, total: 1500 },
      { category: 'subcontractor', itemName: 'Trade Partner Inc.', description: 'Subcontractor record', quantity: 1, unit: 'job', unitCost: 400, sellPrice: 600, total: 600 },
    ],
  }],
};

const customer = {
  name: 'Jamie Smith', company: 'Smith Family', email: 'jamie@example.ca', phone: '416-555-0110',
  billingAddress: { street: '11 Accounts Avenue', city: 'Toronto', province: 'ON', postalCode: 'M3M 3M3', country: 'Canada' },
  address: { street: '10 Billing Street', city: 'Toronto', province: 'ON', postalCode: 'M1M 1M1', country: 'Canada' },
  properties: [{ street: '20 Project Road', city: 'Toronto', province: 'ON', postalCode: 'M2M 2M2', country: 'Canada' }],
};

const business = { name: 'Green Earth Contracting', phone: '905-555-0120', email: 'office@greenearth.ca', website: 'greenearth.ca', businessAddress: '1 Contractor Way, Toronto, ON', proposalTerms: 'Payment terms apply.' };

test('proposal projection exposes customer scope and exact stored totals without internal economics', () => {
  const before = structuredClone(estimate);
  const projection = buildEstimateProposalProjection({ estimate, customer, business });

  assert.deepEqual(projection.workAreas, [{
    name: 'Patio',
    scopeLines: ['Excavate and prepare the patio area', 'Install interlocking stone'],
    subtotal: 3400,
  }]);
  assert.equal(projection.proposal.subtotal, 3400);
  assert.equal(projection.proposal.taxAmount, 442);
  assert.equal(projection.proposal.total, 3842);
  assert.equal(projection.customer.billingAddress, '11 Accounts Avenue, Toronto, ON, M3M 3M3, Canada');
  assert.equal(projection.proposal.projectAddress, '20 Project Road, Toronto, ON');
  assert.deepEqual(estimate, before, 'projection must not mutate the Estimate');

  const serialized = JSON.stringify(projection);
  for (const secret of ['John Smith', 'Mike White', 'Bobcat e50', 'HPB Aggregate', 'Trade Partner Inc.', 'Assigned employee record', 'Equipment catalog record', 'Material catalog record', 'Subcontractor record', 'unitCost', 'sellPrice', 'quantity', 'overhead', 'profit', 'margin', 'employeeName']) {
    assert.doesNotMatch(serialized, new RegExp(secret, 'i'));
  }
});

test('legacy Work Areas without customer scope use a fixed fallback without mutating the Estimate', () => {
  const legacyEstimate = structuredClone(estimate);
  legacyEstimate.workAreas[0].description = '';
  const before = structuredClone(legacyEstimate);

  const projection = buildEstimateProposalProjection({ estimate: legacyEstimate, customer, business });

  assert.deepEqual(projection.workAreas[0].scopeLines, ['Scope details to be confirmed.']);
  assert.equal(projection.proposal.subtotal, 3400);
  assert.equal(projection.proposal.taxAmount, 442);
  assert.equal(projection.proposal.total, 3842);
  assert.deepEqual(legacyEstimate, before);
  assert.doesNotMatch(JSON.stringify(projection), /John Smith|Mike White|Bobcat e50|HPB Aggregate|Trade Partner Inc\./i);
});

test('proposal projection omits optional content and rejects external logos cleanly', () => {
  const projection = buildEstimateProposalProjection({ estimate: { ...estimate, notes: '', exclusions: '' }, customer: { name: 'Client' }, business: { name: 'Contractor', logoDataUrl: 'https://tracker.example/logo.png' } });
  assert.equal(projection.company.logoDataUrl, '');
  assert.equal(projection.company.phone, '');
  assert.equal(projection.customer.billingAddress, '');
  assert.equal(projection.proposal.notes, '');
  assert.equal(projection.proposal.exclusions, '');
  assert.equal(projection.proposal.terms, '');
});
