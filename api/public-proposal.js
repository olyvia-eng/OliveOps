import { createHash, randomUUID } from 'node:crypto';
import { getFileForBusiness } from './_lib/authRepo.js';
import { acceptProposalVersionForBusiness, getProposalAcceptanceForBusiness, getPublicProposalVersionByTokenHash, markProposalVersionViewed } from './_lib/proposalRepo.js';
import { readStoredFile, writeStoredFile } from './_lib/storage.js';
import { createEstimateProposalDocument, proposalPdfFileName } from '../src/utils/estimateProposalPdf.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SIGNATURE_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress ?? '');
}

function publicVersion(version) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    snapshot: version.snapshot,
    sentAt: version.sentAt,
    expiresAt: version.expiresAt,
    firstViewedAt: version.firstViewedAt,
    lastViewedAt: version.lastViewedAt,
    viewCount: version.viewCount,
    acceptedAt: version.acceptedAt,
    acceptedBy: version.acceptedBy,
  };
}

export function createPublicProposalHandler(overrides = {}) {
  const deps = { getPublicProposalVersionByTokenHash, markProposalVersionViewed, getProposalAcceptanceForBusiness, acceptProposalVersionForBusiness, getFileForBusiness, readStoredFile, writeStoredFile, randomUUID, now: () => new Date(), ...overrides };

  return async function publicProposalHandler(req, res) {
    const token = String(req.query?.token ?? req.body?.token ?? '').trim();
    if (!TOKEN_PATTERN.test(token)) return res.status(404).json({ ok: false, error: 'Proposal not found.' });
    const resolved = await deps.getPublicProposalVersionByTokenHash(tokenHash(token));
    if (!resolved?.version || resolved.token.revokedAt) return res.status(404).json({ ok: false, error: 'Proposal not found.' });
    const { token: tokenRecord, version } = resolved;
    const now = deps.now();
    const expired = Boolean(tokenRecord.expiresAt && Date.parse(tokenRecord.expiresAt) < now.getTime());

    if (req.method === 'GET' && req.query?.artifact === 'pdf') {
      if (!version.signedPdfFileId || version.status !== 'accepted') return res.status(404).json({ ok: false, error: 'Accepted Proposal not found.' });
      const file = await deps.getFileForBusiness(tokenRecord.businessId, version.signedPdfFileId);
      if (!file || file.entityType !== 'proposal-version' || file.entityId !== version.id || file.uploadStatus !== 'uploaded') return res.status(404).json({ ok: false, error: 'Accepted Proposal not found.' });
      const bytes = await deps.readStoredFile({ businessId: tokenRecord.businessId, key: file.objectKey ?? file.key });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(Buffer.from(bytes));
    }

    if (req.method === 'GET') {
      if (expired && version.status !== 'accepted') return res.status(410).json({ ok: false, error: 'This Proposal link has expired.' });
      const trackView = ['sent', 'viewed'].includes(version.status);
      if (trackView) await deps.markProposalVersionViewed({ businessId: tokenRecord.businessId, estimateId: version.estimateId, versionNumber: version.versionNumber, viewedAt: now.toISOString() });
      return res.status(200).json({ ok: true, proposal: publicVersion({ ...version, status: version.status === 'sent' ? 'viewed' : version.status, firstViewedAt: version.firstViewedAt ?? (trackView ? now.toISOString() : undefined), lastViewedAt: trackView ? now.toISOString() : version.lastViewedAt, viewCount: (Number(version.viewCount) || 0) + (trackView ? 1 : 0) }) });
    }

    if (req.method !== 'POST' || req.query?.action !== 'accept') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const existing = await deps.getProposalAcceptanceForBusiness(tokenRecord.businessId, version.id);
    if (existing) return res.status(200).json({ ok: true, accepted: true, acceptance: { customerName: existing.customerName, acceptedAt: existing.acceptedAt }, replayed: true });
    if (expired) return res.status(410).json({ ok: false, error: 'This Proposal link has expired.' });
    if (!['sent', 'viewed'].includes(version.status)) return res.status(409).json({ ok: false, error: 'This Proposal can no longer be accepted.' });

    const customerName = String(req.body?.customerName ?? '').trim();
    const requestId = String(req.body?.requestId ?? '').trim();
    const signatureDataUrl = String(req.body?.signatureDataUrl ?? '');
    const signatureMatch = SIGNATURE_PATTERN.exec(signatureDataUrl);
    if (req.body?.agreed !== true) return res.status(400).json({ ok: false, error: 'You must agree to the Proposal and its terms.' });
    if (customerName.length < 2 || customerName.length > 200) return res.status(400).json({ ok: false, error: 'Full name is required.' });
    if (!REQUEST_ID_PATTERN.test(requestId)) return res.status(400).json({ ok: false, error: 'Acceptance request is invalid.' });
    if (!signatureMatch) return res.status(400).json({ ok: false, error: 'A drawn signature is required.' });
    const signatureBytes = Buffer.from(signatureMatch[1], 'base64');
    if (signatureBytes.length < 60 || signatureBytes.length > 2 * 1024 * 1024 || signatureBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || signatureBytes.subarray(-8).toString('hex') !== '49454e44ae426082') return res.status(400).json({ ok: false, error: 'A valid drawn signature is required.' });

    const acceptedAt = now.toISOString();
    const acceptanceId = deps.randomUUID();
    const signatureFileId = deps.randomUUID();
    const signedPdfFileId = deps.randomUUID();
    const signatureKey = `${tokenRecord.businessId}/${signatureFileId}/proposal-signature.png`;
    const pdfKey = `${tokenRecord.businessId}/${signedPdfFileId}/${proposalPdfFileName(version.snapshot, true)}`;
    const pdf = createEstimateProposalDocument(version.snapshot, { acceptance: { customerName, acceptedAt, signatureDataUrl, acceptanceStatementVersion: version.snapshot.acceptanceStatementVersion } });
    const pdfBytes = Buffer.from(pdf.output('arraybuffer'));
    const [signatureStored, pdfStored] = await Promise.all([
      deps.writeStoredFile({ businessId: tokenRecord.businessId, key: signatureKey, bytes: signatureBytes, mimeType: 'image/png', writeOnce: true }),
      deps.writeStoredFile({ businessId: tokenRecord.businessId, key: pdfKey, bytes: pdfBytes, mimeType: 'application/pdf', writeOnce: true }),
    ]);
    const baseFile = { businessId: tokenRecord.businessId, entityType: 'proposal-version', entityId: version.id, uploadStatus: 'uploaded', uploadedAt: acceptedAt, createdAt: acceptedAt, updatedAt: acceptedAt };
    const signatureFile = { ...baseFile, id: signatureFileId, category: 'signature', fileName: 'proposal-signature.png', originalFileName: 'proposal-signature.png', sanitizedFileName: 'proposal-signature.png', mimeType: 'image/png', sizeBytes: signatureStored.sizeBytes, objectKey: signatureKey, key: signatureKey, etag: signatureStored.etag, checksumSha256: sha256(signatureBytes) };
    const pdfFileName = proposalPdfFileName(version.snapshot, true);
    const signedPdfFile = { ...baseFile, id: signedPdfFileId, category: 'accepted-proposal', fileName: pdfFileName, originalFileName: pdfFileName, sanitizedFileName: pdfFileName, mimeType: 'application/pdf', sizeBytes: pdfStored.sizeBytes, objectKey: pdfKey, key: pdfKey, etag: pdfStored.etag, checksumSha256: sha256(pdfBytes), pdfValidatedAt: acceptedAt };
    const acceptance = { acceptanceId, proposalId: version.estimateId, proposalVersionId: version.id, businessId: tokenRecord.businessId, customerName, acceptedAt, signatureFileId, signedPdfFileId, acceptanceStatementVersion: version.snapshot.acceptanceStatementVersion, requestId, tokenHash: tokenRecord.tokenHash, ipAddress: clientIp(req), userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 500), createdAt: acceptedAt };
    const result = await deps.acceptProposalVersionForBusiness({ businessId: tokenRecord.businessId, version, acceptance, signatureFile, signedPdfFile });
    if (!result.ok) return res.status(409).json({ ok: false, error: 'This Proposal version is no longer available for acceptance.' });
    return res.status(result.replayed ? 200 : 201).json({ ok: true, accepted: true, acceptance: { customerName: result.acceptance.customerName, acceptedAt: result.acceptance.acceptedAt }, replayed: result.replayed === true });
  };
}

export default createPublicProposalHandler();