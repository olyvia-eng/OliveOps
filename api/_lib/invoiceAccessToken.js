import { createHmac } from 'node:crypto';

export function createInvoiceAccessToken({ businessId, invoiceId, env = process.env }) {
  const secret = env.INVOICE_TOKEN_SECRET || env.PROPOSAL_TOKEN_SECRET || env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to create Invoice access links.');
  return createHmac('sha256', secret).update(`${businessId}:${invoiceId}`).digest('base64url');
}