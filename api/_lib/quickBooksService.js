import { randomUUID } from 'node:crypto';
import { requireEnv } from './env.js';
import { decryptSecret, encryptSecret } from './secretEncryption.js';
import {
  acquireQuickBooksRefreshLease,
  consumeQuickBooksOAuthState,
  getQuickBooksConnection,
  hashQuickBooksOAuthState,
  persistQuickBooksRefreshedCredentials,
  releaseQuickBooksRefreshLease,
} from './quickBooksRepo.js';

const QUICKBOOKS_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QUICKBOOKS_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QUICKBOOKS_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QUICKBOOKS_SANDBOX_API = 'https://sandbox-quickbooks.api.intuit.com';
const QUICKBOOKS_SCOPE = 'com.intuit.quickbooks.accounting';
const QUICKBOOKS_MINOR_VERSION = '75';

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

async function readQuickBooksResponse(response) {
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
    throw error;
  }
  return payload ?? {};
}

async function requestTokens(values, fetchImpl = fetch, config = oauthConfig()) {
  const response = await fetchImpl(QUICKBOOKS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(config),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(values),
  });
  return readQuickBooksResponse(response);
}

export function buildQuickBooksAuthorizationUrl({ state, config = oauthConfig() }) {
  const url = new URL(QUICKBOOKS_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: QUICKBOOKS_SCOPE,
    state,
  }).toString();
  return url.toString();
}

export async function exchangeQuickBooksAuthorizationCode(code, { fetchImpl = fetch, config = oauthConfig() } = {}) {
  return requestTokens({ code, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }, fetchImpl, config);
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

export async function getValidQuickBooksAccessToken({ businessId, connection, fetchImpl = fetch, dependencies = {} }) {
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
    const tokens = await requestTokens({ refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchImpl, config);
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

async function quickBooksApiRequest({ accessToken, realmId, path, method = 'GET', query, body, fetchImpl = fetch }) {
  const url = new URL(`${QUICKBOOKS_SANDBOX_API}/v3/company/${encodeURIComponent(realmId)}${path}`);
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
  return readQuickBooksResponse(response);
}

export async function fetchQuickBooksCompanyInfo({ accessToken, realmId, fetchImpl = fetch }) {
  const payload = await quickBooksApiRequest({ accessToken, realmId, path: `/companyinfo/${encodeURIComponent(realmId)}`, fetchImpl });
  const company = payload.CompanyInfo;
  if (!company || typeof company !== 'object') throw new Error('QuickBooks company information was unavailable');
  return {
    companyName: company.CompanyName ?? company.LegalName ?? '',
    legalName: company.LegalName ?? '',
    country: company.Country ?? company.CompanyAddr?.Country ?? '',
    currency: company.Currency ?? '',
    companyInfoEntityId: company.Id === undefined || company.Id === null ? '' : String(company.Id),
  };
}

export async function revokeQuickBooksToken({ token, fetchImpl = fetch, config = oauthConfig() }) {
  const response = await fetchImpl(QUICKBOOKS_REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthorization(config), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error('QuickBooks token revocation failed');
}

export function decryptQuickBooksRefreshToken({ businessId, connection }) {
  return decryptQuickBooksToken(connection.encryptedRefreshToken, businessId, connection.realmId);
}

function escapeQuickBooksQueryValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function queryQuickBooks({ accessToken, realmId, statement, fetchImpl = fetch }) {
  return quickBooksApiRequest({ accessToken, realmId, path: '/query', query: { query: statement }, fetchImpl });
}

export async function listQuickBooksItems({ accessToken, realmId, fetchImpl = fetch }) {
  const payload = await queryQuickBooks({
    accessToken,
    realmId,
    statement: 'select * from Item where Active = true maxresults 1000',
    fetchImpl,
  });
  return (payload.QueryResponse?.Item ?? []).map((item) => ({
    id: String(item.Id),
    name: item.Name ?? '',
    type: item.Type ?? '',
    active: item.Active !== false,
  }));
}

export async function listQuickBooksTaxCodes({ accessToken, realmId, fetchImpl = fetch }) {
  const payload = await queryQuickBooks({
    accessToken,
    realmId,
    statement: 'select * from TaxCode where Active = true maxresults 1000',
    fetchImpl,
  });
  return (payload.QueryResponse?.TaxCode ?? []).map((taxCode) => ({
    id: String(taxCode.Id),
    name: taxCode.Name ?? '',
    taxable: taxCode.Taxable === true,
    active: taxCode.Active !== false,
  }));
}

export async function listQuickBooksCustomers({ accessToken, realmId, displayName, fetchImpl = fetch }) {
  const where = displayName ? ` where DisplayName = '${escapeQuickBooksQueryValue(displayName)}'` : '';
  const payload = await queryQuickBooks({
    accessToken,
    realmId,
    statement: `select * from Customer${where} maxresults 1000`,
    fetchImpl,
  });
  return (payload.QueryResponse?.Customer ?? []).map((customer) => ({
    id: String(customer.Id),
    displayName: customer.DisplayName ?? '',
    companyName: customer.CompanyName ?? '',
    email: customer.PrimaryEmailAddr?.Address ?? '',
    active: customer.Active !== false,
  }));
}

export async function createQuickBooksCustomer({ accessToken, realmId, customer, requestId, fetchImpl = fetch }) {
  const payload = await quickBooksApiRequest({
    accessToken,
    realmId,
    path: '/customer',
    method: 'POST',
    query: { requestid: requestId },
    body: customer,
    fetchImpl,
  });
  return payload.Customer;
}

export async function createQuickBooksInvoice({ accessToken, realmId, invoice, requestId, fetchImpl = fetch }) {
  const payload = await quickBooksApiRequest({
    accessToken,
    realmId,
    path: '/invoice',
    method: 'POST',
    query: { requestid: requestId },
    body: invoice,
    fetchImpl,
  });
  return payload.Invoice;
}

export async function fetchQuickBooksInvoice({ accessToken, realmId, quickBooksInvoiceId, fetchImpl = fetch }) {
  const payload = await quickBooksApiRequest({
    accessToken,
    realmId,
    path: `/invoice/${encodeURIComponent(quickBooksInvoiceId)}`,
    fetchImpl,
  });
  return payload.Invoice;
}