import { randomUUID } from 'node:crypto';
import { quickBooksEnvironment, requireEnv } from './env.js';
import { decryptSecret, encryptSecret } from './secretEncryption.js';
import { getQuickBooksDiscoveryDocument, getQuickBooksRevocationEndpointOrDefault } from './quickBooksDiscovery.js';
import { recordQuickBooksFailureAuditEvent } from './quickBooksFailureAudit.js';
import {
  acquireQuickBooksRefreshLease,
  consumeQuickBooksOAuthState,
  getQuickBooksConnection,
  hashQuickBooksOAuthState,
  persistQuickBooksRefreshedCredentials,
  releaseQuickBooksRefreshLease,
} from './quickBooksRepo.js';

// The authorization, token, and revocation endpoints are resolved from Intuit's OAuth/OpenID
// Discovery Document (see quickBooksDiscovery.js) rather than hard-coded, so an Intuit-side rotation
// doesn't require a code change. QUICKBOOKS_REVOKE_URL_FALLBACK is used only if discovery is
// unavailable at disconnect time - see getQuickBooksRevocationEndpointOrDefault - so a transient
// discovery outage never blocks removing locally stored credentials. Only the Accounting API host
// below is still explicitly pinned by environment; discovery never influences it.
const QUICKBOOKS_REVOKE_URL_FALLBACK = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QUICKBOOKS_API_BASE_BY_ENVIRONMENT = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};
const QUICKBOOKS_SCOPE = 'com.intuit.quickbooks.accounting';
const QUICKBOOKS_MINOR_VERSION = '75';

function quickBooksApiBase() {
  return QUICKBOOKS_API_BASE_BY_ENVIRONMENT[quickBooksEnvironment()];
}

// Intuit's own support docs ask for this value when troubleshooting a request with Intuit Support.
// Response.headers.get() is already case-insensitive per the Fetch spec, so this matches
// `intuit_tid`/`Intuit_Tid`/`INTUIT_TID` etc. the same way; a response that omits it (or isn't a
// real Headers object, e.g. a hand-built test double) never throws and just yields null.
function captureIntuitTid(response) {
  try {
    return response?.headers?.get?.('intuit_tid') || null;
  } catch {
    return null;
  }
}

// Makes a value available as `target.intuitTid` for any caller that wants to correlate with Intuit
// Support, without it showing up in JSON.stringify/Object.keys/audit payloads that serialize the
// object wholesale - callers that want it in a persisted/logged record must copy it out explicitly
// (see the quickbooks_invoice_created / quickbooks_customer_created / quickbooks_connected audit
// events), which keeps this from silently bloating unrelated structured data.
function attachIntuitTid(target, intuitTid) {
  if (!intuitTid || !target || typeof target !== 'object') return target;
  Object.defineProperty(target, 'intuitTid', { value: intuitTid, enumerable: false, configurable: true });
  return target;
}

// Single structured, server-side-only sink for QuickBooks request failures. Deliberately limited to
// correlation-safe fields - never the request/response body, headers, tokens, or secrets - so this
// can be grepped by intuit_tid and handed to Intuit Support without itself becoming a leak.
function logQuickBooksFailure(details) {
  console.error('[quickbooks:failure]', {
    action: details.action ?? 'unknown',
    method: details.method ?? undefined,
    path: details.path ?? undefined,
    realmId: details.realmId ?? undefined,
    grantType: details.grantType ?? undefined,
    status: details.status ?? undefined,
    code: details.code ?? undefined,
    intuitTid: details.intuitTid ?? null,
  });
}

function oauthConfig() {
  return {
    clientId: requireEnv('QUICKBOOKS_CLIENT_ID'),
    clientSecret: requireEnv('QUICKBOOKS_CLIENT_SECRET'),
    redirectUri: requireEnv('QUICKBOOKS_REDIRECT_URI'),
  };
}

function basicAuthorization(config) {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64')}`;
}

// Centralized response handling for every QuickBooks HTTP call (Accounting API and OAuth token
// exchange alike) - this is the one and only place that needs to capture Intuit's intuit_tid
// correlation header (on both the failure and success paths) and, on failure, persist a durable
// audit event alongside the immediate console.error - so a given failed request is only ever
// reported once. `context` carries diagnostic labels (action/method/path/realmId) plus, when known,
// the tenant/actor to scope a durable record to (businessId/actorUserId/actorName/actorEmail); all
// of it is optional and this never changes what is returned or thrown to the caller.
async function readQuickBooksResponse(response, context = {}) {
  const intuitTid = captureIntuitTid(response);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error('QuickBooks request failed');
    error.status = response.status;
    error.code = payload?.Fault?.Error?.[0]?.code ?? payload?.error ?? 'QBO_API_ERROR';
    error.intuitTid = intuitTid;
    logQuickBooksFailure({ ...context, status: error.status, code: error.code, intuitTid });
    await recordQuickBooksFailureAuditEvent({ ...context, status: error.status, code: error.code, intuitTid });
    throw error;
  }
  return attachIntuitTid(payload ?? {}, intuitTid);
}

async function requestTokens(values, fetchImpl = fetch, config = oauthConfig(), auditContext = {}) {
  // Both authorization-code exchange and refresh go through here, so both use the discovered token
  // endpoint. Discovery failure fails this closed (no static token-endpoint fallback) - without a
  // trustworthy token endpoint there is nothing safe to fall back to.
  const discovery = await getQuickBooksDiscoveryDocument({ fetchImpl });
  const response = await fetchImpl(discovery.tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(config),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(values),
  });
  return readQuickBooksResponse(response, { ...auditContext, action: 'quickbooks_oauth_token', grantType: values.grant_type });
}

export async function buildQuickBooksAuthorizationUrl({ state, config = oauthConfig(), fetchImpl = fetch }) {
  // Resolved before constructing the authorization URL, per the discovery document, rather than a
  // hard-coded host - see quickBooksDiscovery.js for the trusted-host validation this relies on.
  const discovery = await getQuickBooksDiscoveryDocument({ fetchImpl });
  const url = new URL(discovery.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: QUICKBOOKS_SCOPE,
    state,
  }).toString();
  return url.toString();
}

export async function exchangeQuickBooksAuthorizationCode(code, { fetchImpl = fetch, config = oauthConfig(), businessId, actorUserId, actorName, actorEmail } = {}) {
  return requestTokens({ code, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }, fetchImpl, config, { businessId, actorUserId, actorName, actorEmail });
}

export async function validateQuickBooksOAuthCallbackState({ businessId, userId, state, consumeState = consumeQuickBooksOAuthState }) {
  if (typeof state !== 'string' || !state) return false;
  try {
    return Boolean(await consumeState({ businessId, userId, stateHash: hashQuickBooksOAuthState(state) }));
  } catch {
    return false;
  }
}

export function buildEncryptedQuickBooksCredentials({ businessId, realmId, tokens, existingRefreshToken }) {
  if (typeof tokens?.access_token !== 'string' || !tokens.access_token) throw new Error('QuickBooks did not provide an access token');
  const context = { provider: 'quickbooks-online', businessId, realmId };
  const options = { envName: 'QUICKBOOKS_TOKEN_ENCRYPTION_KEY' };
  const accessExpiresIn = Number(tokens.expires_in);
  const refreshExpiresIn = Number(tokens.x_refresh_token_expires_in);
  const encryptedRefreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token
    ? encryptSecret(tokens.refresh_token, context, undefined, options)
    : existingRefreshToken;
  if (!encryptedRefreshToken) throw new Error('QuickBooks did not provide a refresh token');

  return {
    encryptedAccessToken: encryptSecret(tokens.access_token, context, undefined, options),
    encryptedRefreshToken,
    accessTokenExpiresAt: new Date(Date.now() + Math.max(0, Number.isFinite(accessExpiresIn) ? accessExpiresIn - 60 : 3300) * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + Math.max(0, Number.isFinite(refreshExpiresIn) ? refreshExpiresIn : 8_640_000) * 1000).toISOString(),
  };
}

function decryptQuickBooksToken(envelope, businessId, realmId) {
  return decryptSecret(
    envelope,
    { provider: 'quickbooks-online', businessId, realmId },
    undefined,
    { envName: 'QUICKBOOKS_TOKEN_ENCRYPTION_KEY' }
  );
}

export async function getValidQuickBooksAccessToken({ businessId, connection, fetchImpl = fetch, dependencies = {}, actorUserId, actorName, actorEmail }) {
  const deps = {
    acquireRefreshLease: acquireQuickBooksRefreshLease,
    getConnection: getQuickBooksConnection,
    persistRefreshedCredentials: persistQuickBooksRefreshedCredentials,
    releaseRefreshLease: releaseQuickBooksRefreshLease,
    ...dependencies,
  };
  if (connection.encryptedAccessToken && Date.parse(connection.accessTokenExpiresAt) > Date.now() + 30_000) {
    return decryptQuickBooksToken(connection.encryptedAccessToken, businessId, connection.realmId);
  }

  const leaseId = randomUUID();
  const acquired = await deps.acquireRefreshLease({
    businessId,
    leaseId,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  });
  if (!acquired) {
    const current = await deps.getConnection({ businessId });
    if (current?.encryptedAccessToken && Date.parse(current.accessTokenExpiresAt) > Date.now() + 30_000) {
      return decryptQuickBooksToken(current.encryptedAccessToken, businessId, current.realmId);
    }
    const error = new Error('QuickBooks credentials are being refreshed');
    error.status = 409;
    error.code = 'QBO_REFRESH_IN_PROGRESS';
    throw error;
  }

  try {
    const refreshToken = decryptQuickBooksToken(connection.encryptedRefreshToken, businessId, connection.realmId);
    const config = oauthConfig();
    const tokens = await requestTokens({ refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchImpl, config, { businessId, actorUserId, actorName, actorEmail });
    const credentials = buildEncryptedQuickBooksCredentials({
      businessId,
      realmId: connection.realmId,
      tokens,
      existingRefreshToken: connection.encryptedRefreshToken,
    });
    await deps.persistRefreshedCredentials({ businessId, leaseId, credentials });
    return tokens.access_token;
  } catch (error) {
    await deps.releaseRefreshLease({ businessId, leaseId });
    throw error;
  }
}

async function quickBooksApiRequest({ accessToken, realmId, path, method = 'GET', query, body, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const url = new URL(`${quickBooksApiBase()}/v3/company/${encodeURIComponent(realmId)}${path}`);
  Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set('minorversion', QUICKBOOKS_MINOR_VERSION);
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readQuickBooksResponse(response, { action: 'quickbooks_api', method, path, realmId, businessId, actorUserId, actorName, actorEmail });
}

export async function fetchQuickBooksCompanyInfo({ accessToken, realmId, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const payload = await quickBooksApiRequest({ accessToken, realmId, path: `/companyinfo/${encodeURIComponent(realmId)}`, fetchImpl, businessId, actorUserId, actorName, actorEmail });
  const company = payload.CompanyInfo;
  if (!company || typeof company !== 'object') throw new Error('QuickBooks company information was unavailable');
  return attachIntuitTid({
    companyName: company.CompanyName ?? company.LegalName ?? '',
    legalName: company.LegalName ?? '',
    country: company.Country ?? company.CompanyAddr?.Country ?? '',
    currency: company.Currency ?? '',
    companyInfoEntityId: company.Id === undefined || company.Id === null ? '' : String(company.Id),
  }, payload.intuitTid);
}

export async function revokeQuickBooksToken({ token, fetchImpl = fetch, config = oauthConfig(), businessId, actorUserId, actorName, actorEmail }) {
  // Uses the discovered revocation endpoint when Intuit supplies one; falls back to the static
  // endpoint only if discovery itself is unavailable, so a discovery outage never weakens disconnect.
  const revocationEndpoint = await getQuickBooksRevocationEndpointOrDefault(QUICKBOOKS_REVOKE_URL_FALLBACK, { fetchImpl });
  const response = await fetchImpl(revocationEndpoint, {
    method: 'POST',
    headers: { Authorization: basicAuthorization(config), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const intuitTid = captureIntuitTid(response);
  if (!response.ok) {
    logQuickBooksFailure({ action: 'quickbooks_oauth_revoke', status: response.status, intuitTid });
    await recordQuickBooksFailureAuditEvent({ businessId, actorUserId, actorName, actorEmail, action: 'quickbooks_oauth_revoke', status: response.status, intuitTid });
    const error = new Error('QuickBooks token revocation failed');
    error.intuitTid = intuitTid;
    throw error;
  }
  return { intuitTid };
}

export function decryptQuickBooksRefreshToken({ businessId, connection }) {
  return decryptQuickBooksToken(connection.encryptedRefreshToken, businessId, connection.realmId);
}

function escapeQuickBooksQueryValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function queryQuickBooks({ accessToken, realmId, statement, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  return quickBooksApiRequest({ accessToken, realmId, path: '/query', query: { query: statement }, fetchImpl, businessId, actorUserId, actorName, actorEmail });
}

export async function listQuickBooksItems({ accessToken, realmId, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const payload = await queryQuickBooks({
    accessToken,
    realmId,
    statement: 'select * from Item where Active = true maxresults 1000',
    fetchImpl,
    businessId,
    actorUserId,
    actorName,
    actorEmail,
  });
  return (payload.QueryResponse?.Item ?? []).map((item) => ({
    id: String(item.Id),
    name: item.Name ?? '',
    type: item.Type ?? '',
    active: item.Active !== false,
  }));
}

export async function listQuickBooksTaxCodes({ accessToken, realmId, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const [payload, taxRatePayload] = await Promise.all([
    queryQuickBooks({
      accessToken,
      realmId,
      statement: 'select * from TaxCode where Active = true maxresults 1000',
      fetchImpl,
      businessId,
      actorUserId,
      actorName,
      actorEmail,
    }),
    queryQuickBooks({
      accessToken,
      realmId,
      statement: 'select * from TaxRate where Active = true maxresults 1000',
      fetchImpl,
      businessId,
      actorUserId,
      actorName,
      actorEmail,
    }),
  ]);
  const taxRateById = new Map((taxRatePayload.QueryResponse?.TaxRate ?? []).map((taxRate) => [String(taxRate.Id), taxRate]));
  return (payload.QueryResponse?.TaxCode ?? []).map((taxCode) => {
    const details = taxCode.SalesTaxRateList?.TaxRateDetail ?? [];
    const resolvedRates = details.map((detail) => taxRateById.get(String(detail.TaxRateRef?.value ?? '')))
      .filter((taxRate) => taxRate?.Active !== false)
      .map((taxRate) => Number(taxRate?.RateValue));
    return {
      id: String(taxCode.Id),
      name: taxCode.Name ?? '',
      taxable: taxCode.Taxable === true,
      active: taxCode.Active !== false,
      rate: taxCode.Taxable === true && resolvedRates.length === details.length && resolvedRates.every(Number.isFinite)
        ? resolvedRates.reduce((total, rate) => total + rate, 0)
        : (taxCode.Taxable === true ? undefined : 0),
    };
  });
}

export async function listQuickBooksCustomers({ accessToken, realmId, displayName, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const where = displayName ? ` where DisplayName = '${escapeQuickBooksQueryValue(displayName)}'` : '';
  const payload = await queryQuickBooks({
    accessToken,
    realmId,
    statement: `select * from Customer${where} maxresults 1000`,
    fetchImpl,
    businessId,
    actorUserId,
    actorName,
    actorEmail,
  });
  return (payload.QueryResponse?.Customer ?? []).map((customer) => ({
    id: String(customer.Id),
    displayName: customer.DisplayName ?? '',
    companyName: customer.CompanyName ?? '',
    email: customer.PrimaryEmailAddr?.Address ?? '',
    active: customer.Active !== false,
  }));
}

export async function createQuickBooksCustomer({ accessToken, realmId, customer, requestId, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const payload = await quickBooksApiRequest({
    accessToken,
    realmId,
    path: '/customer',
    method: 'POST',
    query: { requestid: requestId },
    body: customer,
    fetchImpl,
    businessId,
    actorUserId,
    actorName,
    actorEmail,
  });
  return attachIntuitTid(payload.Customer, payload.intuitTid);
}

export async function createQuickBooksInvoice({ accessToken, realmId, invoice, requestId, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const payload = await quickBooksApiRequest({
    accessToken,
    realmId,
    path: '/invoice',
    method: 'POST',
    query: { requestid: requestId },
    body: invoice,
    fetchImpl,
    businessId,
    actorUserId,
    actorName,
    actorEmail,
  });
  return attachIntuitTid(payload.Invoice, payload.intuitTid);
}

export async function fetchQuickBooksInvoice({ accessToken, realmId, quickBooksInvoiceId, fetchImpl = fetch, businessId, actorUserId, actorName, actorEmail }) {
  const payload = await quickBooksApiRequest({
    accessToken,
    realmId,
    path: `/invoice/${encodeURIComponent(quickBooksInvoiceId)}`,
    fetchImpl,
    businessId,
    actorUserId,
    actorName,
    actorEmail,
  });
  return payload.Invoice;
}