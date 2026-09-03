import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEstimateProposalProjection } from '../src/utils/estimateProposalModel.js';

const estimate = {
  id: 'estimate-a', proposalNumber: 'PROP-2026-0042', title: 'Patio & Grading', description: 'A customer introduction.',
  propertyAddressSnapshot: '20 Project Road, Toronto, ON', createdAt: '2026-09-01T10:00:00.000Z', validUntil: '2026-10-01', taxRate: 13,
  notes: 'Customer-facing note.', internalNotes: 'Never print this.', estimatedProfit: 9000, margin: 40, overhead: 2000,
  workAreas: [{
    id: 'patio', name: 'Patio', description: 'Excavate and prepare the patio area', sortOrder: 0,
    lineItems: [
      { category: 'labour', itemName: 'Labour', description: 'Labour', quantity: 10, unit: 'hr', unitCost: 25, sellPrice: 80, total: 800, employeeName: 'Alex', overheadRecoveryPerHour: 20 },
      { category: 'equipment', itemName: 'Excavator', description: 'Supply and install interlocking stone', quantity: 4, unit: 'hr', unitCost: 50, sellPrice: 125, total: 500 },
      { category: 'material', itemName: 'Stone', description: 'Supply and install interlocking stone', quantity: 1, unit: 'lot', unitCost: 1000, sellPrice: 1500, total: 1500 },
      { category: 'subcontractor', itemName: 'Cleanup', description: 'Final grading and site cleanup', quantity: 1, unit: 'job', unitCost: 400, sellPrice: 600, total: 600 },
      { category: 'labour', itemName: 'Labour', description: 'Supply and install interlocking stone', quantity: 0, unit: 'hr', unitCost: 25, sellPrice: 80, total: 0 },
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
    descriptions: ['Excavate and prepare the patio area', 'Included work', 'Supply and install interlocking stone', 'Final grading and site cleanup'],
    subtotal: 3400,
  }]);
  assert.equal(projection.proposal.subtotal, 3400);
  assert.equal(projection.proposal.taxAmount, 442);
  assert.equal(projection.proposal.total, 3842);
  assert.equal(projection.customer.billingAddress, '11 Accounts Avenue, Toronto, ON, M3M 3M3, Canada');
  assert.equal(projection.proposal.projectAddress, '20 Project Road, Toronto, ON');
  assert.deepEqual(estimate, before, 'projection must not mutate the Estimate');

  const serialized = JSON.stringify(projection);
  for (const secret of ['unitCost', 'sellPrice', 'quantity', 'overhead', 'profit', 'margin', 'employeeName', 'equipment']) {
    assert.doesNotMatch(serialized, new RegExp(secret, 'i'));
  }
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
