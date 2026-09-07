import test from 'node:test';
import assert from 'node:assert/strict';

import { createProposalDeliveryHandler } from '../api/proposal-delivery.js';

const estimate = {
  id: 'estimate-1', customerId: 'customer-1', proposalNumber: 'PROP-2026-0001', title: 'Shoreline Restoration', description: 'Customer introduction',
  propertyAddressSnapshot: '1 Lake Road', status: 'draft', taxRate: 13, notes: '', validUntil: '2026-10-07', createdAt: '2026-09-07T12:00:00.000Z',
  internalNotes: 'never expose', estimatedProfit: 5000,
  workAreas: [{ id: 'area-1', name: 'Shoreline', description: 'Install armour stone.', sortOrder: 0, lineItems: [{ total: 10091, unitCost: 4000, sellPrice: 10091 }] }],
  paymentSchedule: [
    { id: 'deposit', label: 'Deposit', type: 'percentage', percentage: 20, due: 'Upon acceptance', sortOrder: 0 },
    { id: 'final', label: 'Final Payment', type: 'percentage', percentage: 80, due: 'Upon completion', sortOrder: 1 },
  ],
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});

function createHarness(overrides = {}) {
  let persisted;
  let email;
  const handler = createProposalDeliveryHandler({
    requireSession: async () => ({ id: 'user-1', name: 'Ryan', email: 'ryan@contractor.ca', role: 'owner', businessId: 'business-1' }),
    getEstimateForBusiness: async (businessId, estimateId) => businessId === 'business-1' && estimateId === estimate.id ? structuredClone(estimate) : null,
    getCustomerForBusiness: async () => ({ id: 'customer-1', name: 'Barbara Bartholomew', email: 'barbara@example.ca' }),
    getBusinessProfile: async () => ({ id: 'business-1', name: 'Shoreline Contracting', proposalTerms: 'Customer terms.' }),
    getFileForBusiness: async () => null,
    readStoredFile: async () => new Uint8Array(),
    listProposalVersionsForEstimate: async () => [],
    createProposalVersionForBusiness: async (value) => { persisted = value; return value.version; },
    proposalMailer: { sendProposal: async (value) => { email = value; return { ok: true }; } },
    randomBytes: () => Buffer.from('01234567890123456789012345678901'),
    randomUUID: () => 'version-1',
    applicationOrigin: () => 'https://app.example.ca',
    ...overrides,
  });
  return { handler, get persisted() { return persisted; }, get email() { return email; } };
}

async function request(harness, { method = 'POST', query = { action: 'send' }, body = { estimateId: estimate.id } } = {}) {
  const response = createResponse();
  await harness.handler({ method, query, body }, response);
  return response;
}

test('sending creates a redacted immutable snapshot and persists only a token hash', async () => {
  const harness = createHarness();
  const response = await request(harness);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.emailSent, true);
  assert.match(response.body.viewUrl, /^https:\/\/app\.example\.ca\/proposal\//);
  assert.equal(harness.persisted.version.id, 'version-1');
  assert.equal(harness.persisted.version.versionNumber, 1);
  assert.equal(harness.persisted.tokenHash.length, 64);
  assert.doesNotMatch(JSON.stringify(harness.persisted), /01234567890123456789012345678901/);
  assert.doesNotMatch(JSON.stringify(harness.persisted.version.snapshot), /internalNotes|estimatedProfit|unitCost|sellPrice/);
  assert.equal(harness.persisted.version.snapshot.proposal.status, 'sent');
  assert.deepEqual(harness.persisted.version.snapshot.paymentSchedule.map((payment) => payment.amount), [2280.57, 9122.26]);
  assert.equal(harness.email.to, 'barbara@example.ca');
});

test('invalid payment allocation is rejected before version persistence or email', async () => {
  let persisted = false;
  const harness = createHarness({
    getEstimateForBusiness: async () => ({ ...structuredClone(estimate), paymentSchedule: [{ id: 'deposit', label: 'Deposit', type: 'percentage', percentage: 110, due: 'Now', sortOrder: 0 }] }),
    createProposalVersionForBusiness: async () => { persisted = true; },
  });
  const response = await request(harness);
  assert.equal(response.statusCode, 400);
  assert.equal(persisted, false);
});

test('tenant-scoped estimate lookup fails closed', async () => {
  const harness = createHarness({ getEstimateForBusiness: async () => null });
  const response = await request(harness);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { ok: false, error: 'Estimate not found.' });
});

test('contractor status lookup returns version metadata without access tokens', async () => {
  const harness = createHarness({ listProposalVersionsForEstimate: async () => [{ id: 'version-1', status: 'viewed', sentAt: '2026-09-07T12:00:00.000Z' }] });
  const response = await request(harness, { method: 'GET', query: { estimateId: estimate.id }, body: {} });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.versions[0].status, 'viewed');
  assert.doesNotMatch(JSON.stringify(response.body), /token/i);
});

test('each send snapshots current content into a distinct immutable version', async () => {
  const saved = [];
  let currentEstimate = structuredClone(estimate);
  const harness = createHarness({
    getEstimateForBusiness: async () => structuredClone(currentEstimate),
    createProposalVersionForBusiness: async (value) => { saved.push(structuredClone(value.version)); },
    randomUUID: () => `version-${saved.length + 1}`,
  });
  await request(harness);
  currentEstimate.title = 'Revised Shoreline Restoration';
  currentEstimate.proposalVersionNumber = 1;
  await request(harness);
  assert.equal(saved[0].versionNumber, 1);
  assert.equal(saved[1].versionNumber, 2);
  assert.equal(saved[0].snapshot.proposal.title, 'Shoreline Restoration');
  assert.equal(saved[1].snapshot.proposal.title, 'Revised Shoreline Restoration');
});

test('sending snapshots the current company logo and branding for historical versions', async () => {
  const logoBytes = Buffer.from('snapshotted-logo');
  const harness = createHarness({
    getBusinessProfile: async () => ({ id: 'business-1', name: 'Original Contracting', email: 'original@example.ca', logoFileId: 'logo-1' }),
    getFileForBusiness: async () => ({ id: 'logo-1', entityType: 'business-profile', uploadStatus: 'uploaded', mimeType: 'image/png', objectKey: 'business/logo.png' }),
    readStoredFile: async () => logoBytes,
  });

  const response = await request(harness);
  assert.equal(response.statusCode, 201);
  assert.equal(harness.persisted.version.snapshot.company.name, 'Original Contracting');
  assert.equal(harness.persisted.version.snapshot.company.email, 'original@example.ca');
  assert.equal(harness.persisted.version.snapshot.company.logoDataUrl, `data:image/png;base64,${logoBytes.toString('base64')}`);
});