import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness, getFileForBusiness } from './_lib/authRepo.js';
import { proposalMailer } from './_lib/proposalEmails.js';
import { createProposalVersionForBusiness, getProposalVersionForBusiness, listProposalVersionsForEstimate } from './_lib/proposalRepo.js';
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
  const deps = { requireSession, getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness, getFileForBusiness, readStoredFile, createProposalVersionForBusiness, getProposalVersionForBusiness, listProposalVersionsForEstimate, proposalMailer, randomBytes, randomUUID, applicationOrigin, ...overrides };
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
    if (req.method !== 'POST' || req.query?.action !== 'send') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    if (resolveWorkType(estimate) === 'service') {
      for (const service of Array.isArray(estimate.services) ? estimate.services : []) {
        const pricingError = validateServicePricing(service);
        if (pricingError) return res.status(400).json({ ok: false, error: pricingError });
      }
    }

    const snapshot = await buildProposalSnapshot({ businessId: session.businessId, estimate, ...deps });
    if (!snapshot) return res.status(404).json({ ok: false, error: 'Proposal data not found.' });
    const paymentBase = resolveWorkType(estimate) === 'service'
      ? snapshot.servicePricingSummary?.contractedTotalWithTax ?? 0
      : snapshot.proposal.total;
    const payment = calculateProposalPaymentSchedule(estimate.paymentSchedule, paymentBase);
    if (!payment.valid) return res.status(400).json({ ok: false, error: payment.errors[0] });
    if (Date.parse(`${estimate.validUntil.slice(0, 10)}T23:59:59.999Z`) < Date.now()) return res.status(400).json({ ok: false, error: 'Update the Proposal valid-until date before sending.' });
    const recipientEmail = String(req.body?.email || snapshot.customer.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) return res.status(400).json({ ok: false, error: 'A valid customer email is required.' });

    const sentAt = new Date().toISOString();
    const versionNumber = Math.max(Number(estimate.proposalVersionNumber) || 0, 0) + 1;
    const accessToken = deps.randomBytes(32).toString('base64url');
    const version = {
      id: deps.randomUUID(),
      versionNumber,
      status: 'sent',
      snapshot: structuredClone(snapshot),
      sentAt,
      sentByUserId: session.id,
      sentToEmail: recipientEmail,
      expiresAt: `${estimate.validUntil.slice(0, 10)}T23:59:59.999Z`,
      createdAt: sentAt,
    };
    await deps.createProposalVersionForBusiness({ businessId: session.businessId, estimate, version, tokenHash: tokenHash(accessToken), actor: session });
    const viewUrl = `${deps.applicationOrigin()}/proposal/${accessToken}`;
    const email = await deps.proposalMailer.sendProposal({ to: recipientEmail, companyName: snapshot.company.name, proposalTitle: snapshot.proposal.title, proposalNumber: snapshot.proposal.number, proposalTotal: snapshot.proposal.total, viewUrl });
    return res.status(201).json({ ok: true, version: { ...version, snapshot: undefined }, viewUrl, emailSent: email.ok === true, emailStatus: email.ok ? 'sent' : email.reason });
  };
}

export default createProposalDeliveryHandler();