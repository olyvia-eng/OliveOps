import { randomUUID } from 'node:crypto';
import { createAuditEventForBusiness } from '../../_lib/authRepo.js';
import { requireSession } from '../../_lib/session.js';
import { getQuickBooksConnection, putQuickBooksConnection } from '../../_lib/quickBooksRepo.js';
import {
  buildEncryptedQuickBooksCredentials,
  exchangeQuickBooksAuthorizationCode,
  fetchQuickBooksCompanyInfo,
  validateQuickBooksOAuthCallbackState,
} from '../../_lib/quickBooksService.js';
import { methodNotAllowed, redirectToQuickBooksIntegrations } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!state) return redirectToQuickBooksIntegrations(res, 'invalid_state');
  const validState = await validateQuickBooksOAuthCallbackState({
    businessId: session.businessId,
    userId: session.id,
    state,
  });
  if (!validState) return redirectToQuickBooksIntegrations(res, 'invalid_state');
  if (typeof req.query.error === 'string') return redirectToQuickBooksIntegrations(res, 'denied');

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const realmId = typeof req.query.realmId === 'string' ? req.query.realmId.trim() : '';
  if (!code) return redirectToQuickBooksIntegrations(res, 'missing_code');
  if (!realmId) return redirectToQuickBooksIntegrations(res, 'missing_realm');

  try {
    const existing = await getQuickBooksConnection({ businessId: session.businessId });
    if (existing?.status === 'connected') return redirectToQuickBooksIntegrations(res, 'already_connected');
    const tokens = await exchangeQuickBooksAuthorizationCode(code);
    const company = await fetchQuickBooksCompanyInfo({ accessToken: tokens.access_token, realmId });
    if (company.realmId !== realmId) return redirectToQuickBooksIntegrations(res, 'realm_mismatch');
    const credentials = buildEncryptedQuickBooksCredentials({ businessId: session.businessId, realmId, tokens });
    await putQuickBooksConnection({
      businessId: session.businessId,
      connection: {
        realmId,
        companyName: company.companyName,
        country: company.country,
        currency: company.currency,
        connectedByUserId: session.id,
        ...credentials,
      },
    });
    await createAuditEventForBusiness({
      businessId: session.businessId,
      auditEvent: {
        id: randomUUID(),
        action: 'quickbooks_connected',
        actorUserId: session.id,
        actorName: session.name,
        actorEmail: session.email,
        affectedEntryCount: 1,
        createdAt: new Date().toISOString(),
        metadata: { realmId, companyName: company.companyName, environment: 'sandbox' },
      },
    });
    return redirectToQuickBooksIntegrations(res, 'connected');
  } catch {
    return redirectToQuickBooksIntegrations(res, 'connection_failed');
  }
}