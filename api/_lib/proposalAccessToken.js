import { createHmac } from 'node:crypto';

export function createProposalAccessToken({ businessId, estimateId, versionId, env = process.env }) {
  const secret = env.PROPOSAL_TOKEN_SECRET || env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to create Proposal access links.');
  return createHmac('sha256', secret)
    .update(`${businessId}:${estimateId}:${versionId}`)
    .digest('base64url');
}
