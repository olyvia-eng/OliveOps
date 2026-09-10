import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProposalMailer, proposalEmailConfiguration } from '../api/_lib/proposalEmails.js';
import { createProposalAccessToken } from '../api/_lib/proposalAccessToken.js';

const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const serviceWorkspaceSource = readFileSync('src/pages/estimates/ServiceEstimateWorkspacePage.tsx', 'utf8');
const repositorySource = readFileSync('api/_lib/proposalRepo.js', 'utf8');

test('proposal email uses one secure versioned delivery path', () => {
  assert.match(estimatesSource, /Prepare and Send/);
  assert.match(estimatesSource, /navigate\(`\/estimates\/\$\{proposalEstimate\.id\}\?tab=proposal`\)/);
  assert.match(workspaceSource, /\/api\/proposal-delivery\?action=send/);
  assert.match(workspaceSource, /Send to Customer/);
  assert.match(workspaceSource, /Send New Version/);
  assert.doesNotMatch(estimatesSource + workspaceSource, /mailto:|Open Email Draft|local email app only/);
});

test('Proposal workspaces expose failed delivery and retry the same version', () => {
  for (const source of [workspaceSource, serviceWorkspaceSource]) {
    assert.match(source, /action=retry/);
    assert.match(source, /Retry Email/);
    assert.match(source, /Delivery failed/);
    assert.match(source, /versionNumber: version\.versionNumber/);
    assert.doesNotMatch(source, /payload\.emailSent \? 'success'/);
  }
});

test('Proposal persistence marks the Estimate sent only during successful delivery completion', () => {
  const creationBlock = repositorySource.slice(repositorySource.indexOf('export async function createProposalVersionForBusiness'), repositorySource.indexOf('export async function beginProposalVersionDeliveryAttempt'));
  assert.doesNotMatch(creationBlock, /#status = :sent|proposal_version_sent/);
  assert.match(creationBlock, /proposal_version_created/);
  assert.match(repositorySource, /export async function completeProposalVersionDeliveryForBusiness/);
  assert.match(repositorySource, /delivery\.status === 'sent'/);
  assert.match(repositorySource, /#status = :sent, sentAt = :submittedAt/);
  assert.match(repositorySource, /deliveryStatus = :failed/);
});

test('Proposal mail configuration requires Resend and preserves the intentional from-address fallback', () => {
  assert.equal(proposalEmailConfiguration({}).ok, false);
  assert.equal(proposalEmailConfiguration({ RESEND_API_KEY: 'secret', PROPOSAL_FROM_EMAIL: 'invalid' }).ok, false);
  assert.deepEqual(proposalEmailConfiguration({ RESEND_API_KEY: 'secret', AUTH_FROM_EMAIL: 'OliveOps <proposals@example.ca>' }), {
    ok: true,
    from: 'OliveOps <proposals@example.ca>',
  });
});

test('configured Resend acceptance returns its provider id and sends branded immutable-link content', async () => {
  let message;
  let options;
  const logoBytes = Buffer.from('canonical-company-logo');
  const mailer = createProposalMailer({
    env: { RESEND_API_KEY: 'secret', PROPOSAL_FROM_EMAIL: 'OliveOps <no-reply@oliveops.ca>' },
    resendClient: { emails: { send: async (value, sendOptions) => { message = value; options = sendOptions; return { data: { id: 'resend-123' }, error: null }; } } },
  });
  const result = await mailer.sendProposal({
    to: 'karen@example.ca', customerName: 'Karen Sullivan', companyName: 'Greendale Landscaping', companyPhone: '705-111-2345', companyEmail: 'admin@greendalelandscaping.ca', companyLogoDataUrl: `data:image/png;base64,${logoBytes.toString('base64')}`, proposalTitle: 'Patio and Retaining Wall', proposalNumber: 'PROP-2026-0001', proposalTotal: 28721.97, validUntil: '2026-10-09', viewUrl: 'https://app.example.ca/proposal/immutable-token', idempotencyKey: 'proposal-version-1',
  });
  assert.deepEqual(result, { ok: true, providerMessageId: 'resend-123' });
  assert.equal(message.from, 'Greendale Landscaping via OliveOps <no-reply@oliveops.ca>');
  assert.equal(message.replyTo, 'admin@greendalelandscaping.ca');
  assert.equal(message.subject, 'Proposal from Greendale Landscaping – Patio and Retaining Wall');
  assert.doesNotMatch(message.subject, /PROP-2026-0001/);
  assert.deepEqual(options, { idempotencyKey: 'proposal-version-1' });
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].contentId, 'company-logo');
  assert.equal(message.attachments[0].contentType, 'image/png');
  assert.deepEqual(message.attachments[0].content, logoBytes);
  for (const content of ['Greendale Landscaping', 'Your proposal is ready', 'Hi Karen,', 'Patio and Retaining Wall', 'PROP-2026-0001', '$28,721.97', 'October 9, 2026', 'View Proposal', '705-111-2345', 'admin@greendalelandscaping.ca', 'https://app.example.ca/proposal/immutable-token', 'cid:company-logo', 'Proposal powered by OliveOps']) {
    assert.match(message.html, new RegExp(content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(JSON.stringify(message.attachments), /\.pdf|application\/pdf/i);
});

test('proposal email gracefully omits an unavailable logo and invalid Reply-To', async () => {
  let message;
  const mailer = createProposalMailer({
    env: { RESEND_API_KEY: 'secret', PROPOSAL_FROM_EMAIL: 'no-reply@oliveops.ca' },
    resendClient: { emails: { send: async (value) => { message = value; return { data: { id: 'resend-124' } }; } } },
  });
  await mailer.sendProposal({ to: 'client@example.ca', customerName: 'Alex Morgan', companyName: 'North Shore Contracting', companyEmail: 'not-an-email', proposalTitle: 'Garden Renovation', proposalNumber: 'PROP-2', proposalTotal: 1000, validUntil: '2026-10-10', viewUrl: 'https://app.example.ca/proposal/version-token' });
  assert.equal(message.from, 'North Shore Contracting via OliveOps <no-reply@oliveops.ca>');
  assert.equal('replyTo' in message, false);
  assert.equal('attachments' in message, false);
  assert.doesNotMatch(message.html, /cid:company-logo|<img/i);
  assert.match(message.html, /North Shore Contracting/);
  assert.match(message.html, /Hi Alex,/);
});

test('Proposal access tokens are stable per immutable version and contain no secret material', () => {
  const input = { businessId: 'business-1', estimateId: 'estimate-1', versionId: 'version-1', env: { JWT_SECRET: 'server-secret-value' } };
  const first = createProposalAccessToken(input);
  assert.equal(createProposalAccessToken(input), first);
  assert.notEqual(createProposalAccessToken({ ...input, versionId: 'version-2' }), first);
  assert.doesNotMatch(first, /server-secret-value|business-1|estimate-1|version-1/);
  assert.match(first, /^[A-Za-z0-9_-]{40,100}$/);
});

test('Resend rejection and exceptions never report successful delivery', async () => {
  const env = { RESEND_API_KEY: 'secret', PROPOSAL_FROM_EMAIL: 'proposals@example.ca' };
  const rejected = createProposalMailer({ env, resendClient: { emails: { send: async () => ({ data: null, error: { message: 'Recipient rejected' } }) } } });
  assert.deepEqual(await rejected.sendProposal({ to: 'client@example.ca', companyName: 'OliveOps', proposalTitle: 'Proposal', proposalTotal: 100, viewUrl: 'https://app.example.ca/proposal/token' }), { ok: false, reason: 'provider_rejected', message: 'Recipient rejected' });
  const failed = createProposalMailer({ env, resendClient: { emails: { send: async () => { throw new Error('Network unavailable'); } } } });
  assert.deepEqual(await failed.sendProposal({ to: 'client@example.ca', companyName: 'OliveOps', proposalTitle: 'Proposal', proposalTotal: 100, viewUrl: 'https://app.example.ca/proposal/token' }), { ok: false, reason: 'provider_error', message: 'Network unavailable' });
});
