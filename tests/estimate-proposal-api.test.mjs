import test from 'node:test';
import assert from 'node:assert/strict';

import { createEstimateProposalHandler } from '../api/estimate-proposal.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function estimate() {
  return {
    id: 'estimate-a', customerId: 'customer-a', title: 'Patio', proposalNumber: 'PROP-1', description: '', createdAt: '2026-09-01', validUntil: '2026-10-01', taxRate: 13, notes: '', propertyAddressSnapshot: 'Project address',
    workAreas: [{ id: 'area-a', name: 'Patio', sortOrder: 0, description: '', lineItems: [{ category: 'labour', description: 'Install patio', quantity: 10, unitCost: 25, sellPrice: 50, total: 500 }] }],
  };
}

test('proposal API derives customer-safe data from the authenticated tenant', async () => {
  const calls = [];
  const persisted = estimate();
  const handler = createEstimateProposalHandler({
    requireSession: async () => ({ businessId: 'business-a', id: 'user-a', role: 'owner' }),
    getEstimateForBusiness: async (businessId, estimateId) => { calls.push(['estimate', businessId, estimateId]); return structuredClone(persisted); },
    getCustomerForBusiness: async (businessId, customerId) => { calls.push(['customer', businessId, customerId]); return { id: customerId, name: 'Jamie', address: 'Billing address' }; },
    getBusinessProfile: async (businessId) => { calls.push(['business', businessId]); return { id: businessId, name: 'Contractor' }; },
  });
  const res = response();
  await handler({ method: 'GET', query: { estimateId: 'estimate-a' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [['estimate', 'business-a', 'estimate-a'], ['customer', 'business-a', 'customer-a'], ['business', 'business-a']]);
  assert.equal(res.body.proposal.proposal.total, 565);
  assert.doesNotMatch(JSON.stringify(res.body), /unitCost|sellPrice|quantity|labour/i);
  assert.deepEqual(persisted, estimate(), 'PDF reads must not mutate the persisted Estimate');
});

test('proposal API rejects cross-tenant and missing Estimate access', async () => {
  const handler = createEstimateProposalHandler({
    requireSession: async () => ({ businessId: 'business-b', id: 'user-b', role: 'owner' }),
    getEstimateForBusiness: async (businessId) => businessId === 'business-a' ? estimate() : null,
    getCustomerForBusiness: async () => { throw new Error('must not load customer'); },
    getBusinessProfile: async () => { throw new Error('must not load business'); },
  });
  const res = response();
  await handler({ method: 'GET', query: { estimateId: 'estimate-a' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Estimate not found.');
});
