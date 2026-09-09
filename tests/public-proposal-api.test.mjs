import test from 'node:test';
import assert from 'node:assert/strict';

import { createPublicProposalHandler } from '../api/public-proposal.js';

const accessToken = 'A'.repeat(43);
const signatureBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const signatureDataUrl = `data:image/png;base64,${signatureBytes.toString('base64')}`;
const snapshot = {
  schemaVersion: 1,
  acceptanceStatementVersion: 1,
  company: { name: 'Shoreline Contracting', phone: '', email: '', website: '', address: '', logoDataUrl: '' },
  proposal: { number: 'PROP-2026-0001', date: '2026-09-07', validUntil: '2026-10-07', title: 'Shoreline Restoration', introduction: '', projectAddress: '1 Lake Road', taxRate: 13, taxLabel: 'HST', subtotal: 1000, taxAmount: 130, total: 1130, notes: '', exclusions: '', terms: 'Customer terms.' },
  customer: { displayName: 'Barbara Bartholomew', contactName: '', billingAddress: '', email: 'barbara@example.ca', phone: '' },
  workAreas: [{ name: 'Shoreline', scopeLines: ['Install armour stone.'], subtotal: 1000 }],
  paymentSchedule: [{ id: 'deposit', label: 'Deposit', type: 'percentage', percentage: 100, due: 'Upon acceptance', amount: 1130, sortOrder: 0 }],
};
const version = { id: 'version-1', estimateId: 'estimate-1', versionNumber: 1, status: 'sent', snapshot, sentAt: '2026-09-07T12:00:00.000Z', expiresAt: '2026-10-07T23:59:59.999Z' };
const tokenRecord = { businessId: 'business-1', tokenHash: 'hash-only', expiresAt: version.expiresAt };

const response = () => ({
  statusCode: 200, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; return this; },
  json(value) { this.body = value; return this; },
  send(value) { this.body = value; return this; },
});

function harness(overrides = {}) {
  const writes = [];
  const acceptCalls = [];
  let existingAcceptance = null;
  const handler = createPublicProposalHandler({
    getPublicProposalVersionByTokenHash: async () => ({ token: structuredClone(tokenRecord), version: structuredClone(version) }),
    markProposalVersionViewed: async () => {},
    getProposalAcceptanceForBusiness: async () => existingAcceptance,
    acceptProposalVersionForBusiness: async (value) => { acceptCalls.push(value); existingAcceptance = value.acceptance; return { ok: true, acceptance: value.acceptance }; },
    getFileForBusiness: async () => null,
    readStoredFile: async () => new Uint8Array(),
    writeStoredFile: async (value) => { writes.push(value); return { ok: true, sizeBytes: value.bytes.length, etag: 'etag' }; },
    randomUUID: (() => { let value = 0; return () => `uuid-${++value}`; })(),
    now: () => new Date('2026-09-08T14:30:00.000Z'),
    ...overrides,
  });
  return { handler, writes, acceptCalls, set existingAcceptance(value) { existingAcceptance = value; } };
}

async function call(instance, req) {
  const res = response();
  await instance.handler({ headers: {}, socket: {}, ...req }, res);
  return res;
}

test('valid secure token returns only the immutable customer-safe snapshot and records first view', async () => {
  let viewed;
  const instance = harness({ markProposalVersionViewed: async (value) => { viewed = value; } });
  const res = await call(instance, { method: 'GET', query: { token: accessToken } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.proposal.snapshot, res.body.proposal.snapshot);
  assert.equal(res.body.proposal.status, 'viewed');
  assert.equal(viewed.estimateId, 'estimate-1');
  assert.doesNotMatch(JSON.stringify(res.body), /tokenHash|businessId|unitCost|profit|margin/);
  assert.equal(res.body.proposal.snapshot.schemaVersion, 1, 'historical schema-1 snapshots remain readable');
  assert.deepEqual(res.body.proposal.snapshot.workAreas[0].scopeLines, ['Install armour stone.']);
});

test('invalid, unknown, and expired tokens fail closed', async () => {
  assert.equal((await call(harness(), { method: 'GET', query: { token: 'predictable-id' } })).statusCode, 404);
  assert.equal((await call(harness({ getPublicProposalVersionByTokenHash: async () => null }), { method: 'GET', query: { token: accessToken } })).statusCode, 404);
  const expired = harness({ now: () => new Date('2026-10-08T00:00:00.000Z') });
  assert.equal((await call(expired, { method: 'GET', query: { token: accessToken } })).statusCode, 410);
});

test('acceptance requires consent, printed name, and a valid drawn PNG signature', async () => {
  const base = { method: 'POST', query: { action: 'accept' }, body: { token: accessToken, requestId: 'request-123', agreed: true, customerName: 'Barbara Bartholomew', signatureDataUrl } };
  assert.equal((await call(harness(), { ...base, body: { ...base.body, agreed: false } })).statusCode, 400);
  assert.equal((await call(harness(), { ...base, body: { ...base.body, customerName: '' } })).statusCode, 400);
  assert.equal((await call(harness(), { ...base, body: { ...base.body, signatureDataUrl: 'data:image/png;base64,AAAA' } })).statusCode, 400);
});

test('acceptance uses server time, exact version, and immutable private artifacts', async () => {
  const instance = harness();
  const before = structuredClone(snapshot);
  const res = await call(instance, { method: 'POST', query: { action: 'accept' }, headers: { 'user-agent': 'Customer Browser', 'x-forwarded-for': '203.0.113.7' }, body: { token: accessToken, requestId: 'request-123', agreed: true, customerName: 'Barbara Bartholomew', acceptedAt: '2001-01-01', signatureDataUrl } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.acceptance.acceptedAt, '2026-09-08T14:30:00.000Z');
  assert.equal(instance.acceptCalls.length, 1);
  assert.equal(instance.acceptCalls[0].acceptance.proposalVersionId, 'version-1');
  assert.equal(instance.acceptCalls[0].acceptance.ipAddress, '203.0.113.7');
  assert.equal(instance.writes.length, 2);
  assert.deepEqual(instance.writes.map((write) => [write.mimeType, write.writeOnce]), [['image/png', true], ['application/pdf', true]]);
  assert.deepEqual(snapshot, before, 'accepted rendering must not mutate the immutable snapshot');
});

test('duplicate acceptance returns the existing immutable record without new artifacts', async () => {
  const instance = harness();
  instance.existingAcceptance = { customerName: 'Barbara Bartholomew', acceptedAt: '2026-09-08T14:30:00.000Z' };
  const res = await call(instance, { method: 'POST', query: { action: 'accept' }, body: { token: accessToken, requestId: 'request-123', agreed: true, customerName: 'Barbara Bartholomew', signatureDataUrl } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.replayed, true);
  assert.equal(instance.writes.length, 0);
  assert.equal(instance.acceptCalls.length, 0);
});