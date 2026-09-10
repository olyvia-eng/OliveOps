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
  let completion;
  let beginCount = 0;
  const handler = createProposalDeliveryHandler({
    requireSession: async () => ({ id: 'user-1', name: 'Ryan', email: 'ryan@contractor.ca', role: 'owner', businessId: 'business-1' }),
    getEstimateForBusiness: async (businessId, estimateId) => businessId === 'business-1' && estimateId === estimate.id ? structuredClone(estimate) : null,
    getCustomerForBusiness: async () => ({ id: 'customer-1', name: 'Barbara Bartholomew', email: 'barbara@example.ca' }),
    getBusinessProfile: async () => ({ id: 'business-1', name: 'Shoreline Contracting', proposalTerms: 'Customer terms.' }),
    getFileForBusiness: async () => null,
    readStoredFile: async () => new Uint8Array(),
    listProposalVersionsForEstimate: async () => [],
    createProposalVersionForBusiness: async (value) => { persisted = value; return value.version; },
    beginProposalVersionDeliveryAttempt: async () => { beginCount += 1; return true; },
    completeProposalVersionDeliveryForBusiness: async (value) => { completion = value; return true; },
    proposalEmailConfiguration: () => ({ ok: true, from: 'proposals@example.ca' }),
    proposalMailer: { sendProposal: async (value) => { email = value; return { ok: true, providerMessageId: 'resend-message-1' }; } },
    createProposalAccessToken: ({ versionId }) => `secure-proposal-access-token-${versionId}-1234567890`,
    randomUUID: () => 'version-1',
    applicationOrigin: () => 'https://app.example.ca',
    now: () => new Date('2026-09-07T12:00:00.000Z'),
    ...overrides,
  });
  return { handler, get persisted() { return persisted; }, get email() { return email; }, get completion() { return completion; }, get beginCount() { return beginCount; } };
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
  assert.equal(response.body.emailStatus, 'sent');
  assert.equal(response.body.estimatePatch.status, 'sent');
  assert.equal(response.body.estimatePatch.proposalVersionNumber, 1);
  assert.match(response.body.viewUrl, /^https:\/\/app\.example\.ca\/proposal\//);
  assert.equal(harness.persisted.version.id, 'version-1');
  assert.equal(harness.persisted.version.versionNumber, 1);
  assert.equal(harness.persisted.version.status, 'pending');
  assert.equal(harness.persisted.version.deliveryStatus, 'pending');
  assert.equal(harness.persisted.tokenHash.length, 64);
  assert.doesNotMatch(JSON.stringify(harness.persisted), /01234567890123456789012345678901/);
  assert.doesNotMatch(JSON.stringify(harness.persisted.version.snapshot), /internalNotes|estimatedProfit|unitCost|sellPrice/);
  assert.equal(harness.persisted.version.snapshot.proposal.status, 'sent');
  assert.equal(harness.persisted.version.snapshot.schemaVersion, 2);
  assert.deepEqual(harness.persisted.version.snapshot.paymentSchedule.map((payment) => payment.amount), [2280.57, 9122.26]);
  assert.equal(harness.email.to, 'barbara@example.ca');
  assert.equal(harness.completion.delivery.status, 'sent');
  assert.equal(harness.completion.delivery.providerMessageId, 'resend-message-1');
});

test('email configuration is validated before creating a Proposal version', async () => {
  let persisted = false;
  const harness = createHarness({
    proposalEmailConfiguration: () => ({ ok: false, reason: 'not_configured', message: 'Proposal email delivery is not configured: RESEND_API_KEY is missing.' }),
    createProposalVersionForBusiness: async () => { persisted = true; },
  });
  const response = await request(harness);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.emailStatus, 'not_configured');
  assert.equal(persisted, false);
});

test('invalid customer email is rejected before creating a Proposal version', async () => {
  let persisted = false;
  const harness = createHarness({
    getCustomerForBusiness: async () => ({ id: 'customer-1', name: 'Barbara', email: 'not-an-email' }),
    createProposalVersionForBusiness: async () => { persisted = true; },
  });
  const response = await request(harness);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /valid customer email/i);
  assert.equal(persisted, false);
});

test('Resend failure preserves V1 and records failed delivery without reporting sent', async () => {
  const harness = createHarness({
    proposalMailer: { sendProposal: async () => ({ ok: false, reason: 'provider_rejected', message: 'Resend rejected the recipient.' }) },
  });
  const response = await request(harness);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.emailSent, false);
  assert.equal(response.body.emailStatus, 'failed');
  assert.equal(response.body.version.versionNumber, 1);
  assert.equal(response.body.version.status, 'pending');
  assert.equal(response.body.estimatePatch.status, undefined);
  assert.equal(response.body.estimatePatch.proposalVersionNumber, 1);
  assert.equal(harness.persisted.version.versionNumber, 1);
  assert.equal(harness.completion.delivery.status, 'failed');
  assert.equal(harness.completion.delivery.failureCategory, 'provider_rejected');
});

test('retrying failed delivery reuses V1 and its exact secure URL', async () => {
  const failedVersion = {
    id: 'version-1', versionNumber: 1, status: 'pending', deliveryStatus: 'failed', deliveryRecipient: 'barbara@example.ca',
    expiresAt: '2026-10-07T23:59:59.999Z', snapshot: { company: { name: 'Shoreline Contracting', phone: '705-111-2345', email: 'admin@example.ca' }, customer: { displayName: 'Barbara Bartholomew', contactName: 'Barbara', email: 'barbara@example.ca' }, proposal: { title: 'Shoreline Restoration', number: 'PROP-2026-0001', total: 11402.83, validUntil: '2026-10-07' } },
  };
  let created = 0;
  const harness = createHarness({
    getProposalVersionForBusiness: async () => structuredClone(failedVersion),
    createProposalVersionForBusiness: async () => { created += 1; },
  });
  const response = await request(harness, { query: { action: 'retry' }, body: { estimateId: estimate.id, versionNumber: 1 } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.version.versionNumber, 1);
  assert.equal(created, 0, 'retry must not create Proposal V2');
  assert.equal(harness.beginCount, 1);
  assert.equal(response.body.viewUrl, 'https://app.example.ca/proposal/secure-proposal-access-token-version-1-1234567890');
  assert.equal(harness.email.viewUrl, response.body.viewUrl);
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
  currentEstimate.paymentSchedule = [{ id: 'full', label: 'Full Payment', type: 'percentage', percentage: 100, due: 'Upon completion', sortOrder: 0 }];
  currentEstimate.proposalVersionNumber = 1;
  await request(harness);
  assert.equal(saved[0].versionNumber, 1);
  assert.equal(saved[1].versionNumber, 2);
  assert.equal(saved[0].snapshot.proposal.title, 'Shoreline Restoration');
  assert.equal(saved[1].snapshot.proposal.title, 'Revised Shoreline Restoration');
  assert.deepEqual(saved[0].snapshot.paymentSchedule.map((payment) => payment.label), ['Deposit', 'Final Payment']);
  assert.deepEqual(saved[1].snapshot.paymentSchedule.map((payment) => payment.label), ['Full Payment']);
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

test('Service send rejects incomplete pricing and schedules payments against contracted value only', async () => {
  let serviceEstimate = { ...structuredClone(estimate), workType: 'service', workAreas: [], services: [{ id: 'service-1', name: 'Maintenance', scheduleType: 'recurring', billingType: 'contract', estimatedVisits: 10, frequency: { interval: 1, unit: 'week' }, lineItems: [] }] };
  const harness = createHarness({ getEstimateForBusiness: async () => structuredClone(serviceEstimate) });

  assert.equal((await request(harness)).statusCode, 400);
  serviceEstimate.services[0].lineItems = [{ id: 'line-1', category: 'labour', itemName: 'Crew rate', quantity: 1, unit: 'hr', unitCost: 40, sellPrice: 100, costScope: 'per_visit' }];
  serviceEstimate.services[0].contractPricing = { customContractPrice: 1200 };
  const response = await request(harness);

  assert.equal(response.statusCode, 201);
  assert.equal(harness.persisted.version.snapshot.servicePricingSummary.contractedRevenue, 1200);
  assert.deepEqual(harness.persisted.version.snapshot.paymentSchedule.map((payment) => payment.amount), [271.2, 1084.8]);
});

test('APP_ORIGIN is validated before creating a Proposal version', async () => {
  let persisted = false;
  const harness = createHarness({
    applicationOrigin: () => { throw new Error('APP_ORIGIN is required to send Proposals.'); },
    createProposalVersionForBusiness: async () => { persisted = true; },
  });
  const response = await request(harness);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.emailStatus, 'not_configured');
  assert.equal(persisted, false);
});

test('successful response requires an email provider acceptance id', async () => {
  const harness = createHarness({ proposalMailer: { sendProposal: async () => ({ ok: true }) } });
  const response = await request(harness);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.emailSent, false);
  assert.equal(response.body.version.status, 'pending');
  assert.equal(harness.completion.delivery.status, 'failed');
  assert.equal(harness.completion.delivery.failureCategory, 'provider_invalid_response');
});

test('send ignores untrusted branding and customer fields in favor of the tenant snapshot', async () => {
  const logoBytes = Buffer.from('tenant-logo');
  const harness = createHarness({
    getBusinessProfile: async () => ({ id: 'business-1', name: 'Canonical Contracting', email: 'office@canonical.ca', logoFileId: 'logo-1' }),
    getCustomerForBusiness: async () => ({ id: 'customer-1', name: 'Canonical Customer', email: 'customer@canonical.ca' }),
    getFileForBusiness: async () => ({ id: 'logo-1', entityType: 'business-profile', uploadStatus: 'uploaded', mimeType: 'image/png', objectKey: 'business-1/logo.png' }),
    readStoredFile: async () => logoBytes,
  });
  const response = await request(harness, { body: { estimateId: estimate.id, email: 'attacker@example.com', companyName: 'Attacker Inc', companyEmail: 'reply@attacker.example', companyLogoDataUrl: 'data:image/png;base64,YXR0YWNr', customerName: 'Fake Customer', proposalTitle: 'Fake Proposal' } });
  assert.equal(response.statusCode, 201);
  assert.equal(harness.email.to, 'customer@canonical.ca');
  assert.equal(harness.email.customerName, 'Canonical Customer');
  assert.equal(harness.email.companyName, 'Canonical Contracting');
  assert.equal(harness.email.companyEmail, 'office@canonical.ca');
  assert.equal(harness.email.companyLogoDataUrl, `data:image/png;base64,${logoBytes.toString('base64')}`);
  assert.equal(harness.email.proposalTitle, 'Shoreline Restoration');
});