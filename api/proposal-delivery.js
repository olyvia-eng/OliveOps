import { createHash, randomUUID } from 'node:crypto';
import { getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness, getFileForBusiness } from './_lib/authRepo.js';
import { proposalEmailConfiguration, proposalMailer } from './_lib/proposalEmails.js';
import { beginProposalVersionDeliveryAttempt, completeProposalVersionDeliveryForBusiness, createProposalVersionForBusiness, getProposalVersionForBusiness, listProposalVersionsForEstimate } from './_lib/proposalRepo.js';
import { createProposalAccessToken } from './_lib/proposalAccessToken.js';
import { buildProposalSnapshot } from './_lib/proposalSnapshot.js';
import { requireSession } from './_lib/session.js';
import { readStoredFile } from './_lib/storage.js';
import { calculateProposalPaymentSchedule } from '../src/utils/proposalPaymentSchedule.js';
import { validateServicePricing } from '../src/utils/servicePricingModel.js';
import { resolveWorkType } from '../src/utils/workTypeModel.js';

const WRITE_ROLES = ['owner', 'admin', 'foreman'];
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

function applicationOrigin() {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error('APP_ORIGIN is required to send Proposals.');
  const url = new URL(origin);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('APP_ORIGIN must use HTTPS.');
  return url.origin;
}

export function createProposalDeliveryHandler(overrides = {}) {
  const deps = { requireSession, getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness, getFileForBusiness, readStoredFile, createProposalVersionForBusiness, beginProposalVersionDeliveryAttempt, completeProposalVersionDeliveryForBusiness, getProposalVersionForBusiness, listProposalVersionsForEstimate, proposalEmailConfiguration, proposalMailer, createProposalAccessToken, randomUUID, applicationOrigin, now: () => new Date(), ...overrides };
  return async function proposalDeliveryHandler(req, res) {
    const session = await deps.requireSession(req, res, WRITE_ROLES, 'estimates');
    if (!session) return;
    const estimateId = String(req.query?.estimateId ?? req.body?.estimateId ?? '').trim();
    if (!estimateId) return res.status(400).json({ ok: false, error: 'Estimate id is required.' });
    const estimate = await deps.getEstimateForBusiness(session.businessId, estimateId);
    if (!estimate) return res.status(404).json({ ok: false, error: 'Estimate not found.' });

    if (req.method === 'GET' && req.query?.action === 'artifact') {
      const versionNumber = Number(req.query?.versionNumber);
      if (!Number.isInteger(versionNumber) || versionNumber < 1) return res.status(400).json({ ok: false, error: 'Proposal version is invalid.' });
      const version = await deps.getProposalVersionForBusiness(session.businessId, estimateId, versionNumber);
      if (!version?.signedPdfFileId || version.status !== 'accepted') return res.status(404).json({ ok: false, error: 'Accepted Proposal not found.' });
      const file = await deps.getFileForBusiness(session.businessId, version.signedPdfFileId);
      if (!file || file.entityType !== 'proposal-version' || file.entityId !== version.id || file.uploadStatus !== 'uploaded') return res.status(404).json({ ok: false, error: 'Accepted Proposal not found.' });
      const bytes = await deps.readStoredFile({ businessId: session.businessId, key: file.objectKey ?? file.key });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(Buffer.from(bytes));
    }

    if (req.method === 'GET') {
      const versions = await deps.listProposalVersionsForEstimate(session.businessId, estimateId);
      return res.status(200).json({ ok: true, versions });
    }
    const action = req.query?.action;
    if (req.method !== 'POST' || !['send', 'retry'].includes(action)) return res.status(405).json({ ok: false, error: 'Method not allowed' });

    const emailConfiguration = deps.proposalEmailConfiguration();
    if (!emailConfiguration.ok) return res.status(503).json({ ok: false, error: emailConfiguration.message, emailStatus: emailConfiguration.reason });
    let origin;
    try {
      origin = deps.applicationOrigin();
    } catch (error) {
      return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : 'APP_ORIGIN is required to send Proposals.', emailStatus: 'not_configured' });
    }

    const requestedVersionNumber = Number(req.body?.versionNumber ?? req.query?.versionNumber);
    const retryVersion = action === 'retry'
      ? await deps.getProposalVersionForBusiness(session.businessId, estimateId, requestedVersionNumber)
      : null;
    if (action === 'retry' && (!Number.isInteger(requestedVersionNumber) || requestedVersionNumber < 1 || !retryVersion)) return res.status(404).json({ ok: false, error: 'Proposal version not found.' });
    if (retryVersion && retryVersion.deliveryStatus === 'sent') return res.status(409).json({ ok: false, error: 'This Proposal email was already sent.' });

    let deliverySnapshot = retryVersion?.snapshot;
    if (!deliverySnapshot) {
      if (resolveWorkType(estimate) === 'service') {
        for (const service of Array.isArray(estimate.services) ? estimate.services : []) {
          const pricingError = validateServicePricing(service);
          if (pricingError) return res.status(400).json({ ok: false, error: pricingError });
        }
      }
      deliverySnapshot = await buildProposalSnapshot({ businessId: session.businessId, estimate, ...deps });
      if (!deliverySnapshot) return res.status(404).json({ ok: false, error: 'Proposal data not found.' });
      const paymentBase = resolveWorkType(estimate) === 'service'
        ? deliverySnapshot.servicePricingSummary?.contractedTotalWithTax ?? 0
        : deliverySnapshot.proposal.total;
      const payment = calculateProposalPaymentSchedule(estimate.paymentSchedule, paymentBase);
      if (!payment.valid) return res.status(400).json({ ok: false, error: payment.errors[0] });
      if (Date.parse(`${estimate.validUntil.slice(0, 10)}T23:59:59.999Z`) < Date.now()) return res.status(400).json({ ok: false, error: 'Update the Proposal valid-until date before sending.' });
    }
    const recipientEmail = String(req.body?.email || retryVersion?.deliveryRecipient || retryVersion?.sentToEmail || deliverySnapshot.customer.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) return res.status(400).json({ ok: false, error: 'A valid customer email is required.' });

    const attemptedAt = deps.now().toISOString();
    const version = retryVersion ?? {
      id: deps.randomUUID(),
      versionNumber: Math.max(Number(estimate.proposalVersionNumber) || 0, 0) + 1,
      status: 'pending',
      deliveryStatus: 'pending',
      deliveryRecipient: recipientEmail,
      deliveryAttemptedAt: attemptedAt,
      snapshot: structuredClone(deliverySnapshot),
      sentByUserId: session.id,
      expiresAt: `${estimate.validUntil.slice(0, 10)}T23:59:59.999Z`,
      createdAt: attemptedAt,
    };
    const accessToken = deps.createProposalAccessToken({ businessId: session.businessId, estimateId, versionId: version.id });
    if (!retryVersion) {
      await deps.createProposalVersionForBusiness({ businessId: session.businessId, estimate, version, tokenHash: tokenHash(accessToken), actor: session });
    } else {
      const begun = await deps.beginProposalVersionDeliveryAttempt({ businessId: session.businessId, estimateId, versionNumber: version.versionNumber, recipient: recipientEmail, attemptedAt });
      if (!begun) return res.status(409).json({ ok: false, error: 'This Proposal email cannot be retried in its current state.' });
    }

    const viewUrl = `${origin}/proposal/${accessToken}`;
    const email = await deps.proposalMailer.sendProposal({
      to: recipientEmail,
      customerName: deliverySnapshot.customer.contactName || deliverySnapshot.customer.displayName,
      companyName: deliverySnapshot.company.name,
      companyPhone: deliverySnapshot.company.phone,
      companyEmail: deliverySnapshot.company.email,
      proposalTitle: deliverySnapshot.proposal.title,
      proposalNumber: deliverySnapshot.proposal.number,
      proposalTotal: deliverySnapshot.proposal.total,
      validUntil: deliverySnapshot.proposal.validUntil,
      viewUrl,
      idempotencyKey: `proposal-${version.id}`,
    });
    const emailAccepted = email.ok === true && typeof email.providerMessageId === 'string' && email.providerMessageId.trim().length > 0;
    const delivery = emailAccepted
      ? { status: 'sent', recipient: recipientEmail, attemptedAt, submittedAt: deps.now().toISOString(), providerMessageId: email.providerMessageId }
      : { status: 'failed', recipient: recipientEmail, attemptedAt, failureCategory: email.reason || 'provider_invalid_response', failureReason: email.message || 'The email provider did not accept the Proposal email.' };
    await deps.completeProposalVersionDeliveryForBusiness({ businessId: session.businessId, estimateId, version, delivery, actor: session });
    const publicVersion = { ...version, snapshot: undefined, status: emailAccepted ? 'sent' : version.status, deliveryStatus: delivery.status, deliveryRecipient: recipientEmail, deliveryAttemptedAt: attemptedAt, deliveryFailureCategory: emailAccepted ? undefined : delivery.failureCategory, deliveryFailureReason: emailAccepted ? undefined : delivery.failureReason, ...(emailAccepted ? { sentAt: delivery.submittedAt, deliverySubmittedAt: delivery.submittedAt, deliveryProviderMessageId: delivery.providerMessageId } : {}) };
    const estimatePatch = retryVersion
      ? emailAccepted ? { status: 'sent', sentAt: delivery.submittedAt, updatedAt: delivery.submittedAt } : undefined
      : { activeProposalVersionId: version.id, proposalVersionNumber: version.versionNumber, updatedAt: emailAccepted ? delivery.submittedAt : version.createdAt, ...(emailAccepted ? { status: 'sent', sentAt: delivery.submittedAt } : {}) };
    if (!emailAccepted) return res.status(502).json({ ok: false, error: delivery.failureReason, version: publicVersion, viewUrl, estimatePatch, emailSent: false, emailStatus: 'failed' });
    return res.status(retryVersion ? 200 : 201).json({ ok: true, version: publicVersion, viewUrl, estimatePatch, emailSent: true, emailStatus: 'sent' });
  };
}

export default createProposalDeliveryHandler();