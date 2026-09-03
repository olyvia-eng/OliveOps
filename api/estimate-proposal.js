import { getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness } from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { buildEstimateProposalProjection } from '../src/utils/estimateProposalModel.js';

const READ_ROLES = ['owner', 'admin', 'foreman'];

export function createEstimateProposalHandler(overrides = {}) {
  const deps = { requireSession, getBusinessProfile, getCustomerForBusiness, getEstimateForBusiness, ...overrides };

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

    const [customer, business] = await Promise.all([
      deps.getCustomerForBusiness(session.businessId, estimate.customerId),
      deps.getBusinessProfile(session.businessId),
    ]);
    if (!customer || !business) return res.status(404).json({ ok: false, error: 'Proposal data not found.' });

    return res.status(200).json({
      ok: true,
      proposal: buildEstimateProposalProjection({ estimate, customer, business }),
    });
  };
}

export default createEstimateProposalHandler();
