import { buildEstimateProposalProjection } from '../../src/utils/estimateProposalModel.js';

export const PROPOSAL_SNAPSHOT_SCHEMA_VERSION = 1;
export const ACCEPTANCE_STATEMENT_VERSION = 1;

export async function buildProposalSnapshot({ businessId, estimate, getBusinessProfile, getCustomerForBusiness, getFileForBusiness, readStoredFile }) {
  const [customer, business] = await Promise.all([
    getCustomerForBusiness(businessId, estimate.customerId),
    getBusinessProfile(businessId),
  ]);
  if (!customer || !business) return null;

  const brandedBusiness = { ...business };
  if (business.logoFileId) {
    const logo = await getFileForBusiness(businessId, business.logoFileId);
    if (logo?.uploadStatus === 'uploaded' && logo.entityType === 'business-profile' && ['image/png', 'image/jpeg'].includes(logo.mimeType)) {
      const bytes = await readStoredFile({ businessId, key: logo.objectKey ?? logo.key });
      brandedBusiness.logoDataUrl = `data:${logo.mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    }
  }

  return {
    schemaVersion: PROPOSAL_SNAPSHOT_SCHEMA_VERSION,
    acceptanceStatementVersion: ACCEPTANCE_STATEMENT_VERSION,
    ...buildEstimateProposalProjection({ estimate, customer, business: brandedBusiness }),
  };
}
