import { getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness, getFileForBusiness } from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { readStoredFile } from './_lib/storage.js';
import { getProposalVersionForBusiness } from './_lib/proposalRepo.js';
import { buildEstimateProposalProjection } from '../src/utils/estimateProposalModel.js';

const READ_ROLES = ['owner', 'admin', 'foreman'];

export function createEstimateProposalHandler(overrides = {}) {
  const deps = { requireSession, getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness, getFileForBusiness, readStoredFile, getProposalVersionForBusiness, ...overrides };

  return async function estimateProposalHandler(req, res) {
    const session = await deps.requireSession(req, res, READ_ROLES, 'estimates');
    if (!session) return;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const estimateId = typeof req.query?.estimateId === 'string' ? req.query.estimateId.trim() : '';
    if (!estimateId) return res.status(400).json({ ok: false, error: 'Estimate id is required.' });

    const estimate = await deps.getEstimateForBusiness(session.businessId, estimateId);
    if (!estimate) return res.status(404).json({ ok: false, error: 'Estimate not found.' });

    if (req.query?.versionNumber !== undefined) {
      const versionNumber = Number(req.query.versionNumber);
      if (!Number.isInteger(versionNumber) || versionNumber < 1) return res.status(400).json({ ok: false, error: 'Proposal version is invalid.' });
      const version = await deps.getProposalVersionForBusiness(session.businessId, estimateId, versionNumber);
      if (!version?.snapshot) return res.status(404).json({ ok: false, error: 'Proposal version not found.' });
      return res.status(200).json({ ok: true, proposal: version.snapshot });
    }

    const [customer, business] = await Promise.all([
      deps.getCustomerForBusiness(session.businessId, estimate.customerId),
      deps.getBusinessProfile(session.businessId),
    ]);
    if (!customer || !business) return res.status(404).json({ ok: false, error: 'Proposal data not found.' });
    if (business.logoFileId) {
      const logo = await deps.getFileForBusiness(session.businessId, business.logoFileId);
      if (logo?.uploadStatus === 'uploaded' && logo.entityType === 'business-profile' && ['image/png', 'image/jpeg'].includes(logo.mimeType)) {
        const bytes = await deps.readStoredFile({ businessId: session.businessId, key: logo.objectKey ?? logo.key });
        business.logoDataUrl = `data:${logo.mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
      }
    }

    return res.status(200).json({
      ok: true,
      proposal: buildEstimateProposalProjection({ estimate, customer, business }),
    });
  };
}

export default createEstimateProposalHandler();
