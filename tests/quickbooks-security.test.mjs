import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  hashQuickBooksOAuthState,
  quickBooksConnectionSk,
  quickBooksCustomerMappingSk,
  quickBooksInvoiceMappingSk,
  toSafeQuickBooksConnection,
} from '../api/_lib/quickBooksRepo.js';
import {
  buildEncryptedQuickBooksCredentials,
  buildQuickBooksAuthorizationUrl,
  exchangeQuickBooksAuthorizationCode,
  fetchQuickBooksCompanyInfo,
  getValidQuickBooksAccessToken,
  listQuickBooksTaxCodes,
  revokeQuickBooksToken,
  validateQuickBooksOAuthCallbackState,
} from '../api/_lib/quickBooksService.js';
import {
  getQuickBooksDiscoveryDocument,
  QUICKBOOKS_DISCOVERY_URL,
  resetQuickBooksDiscoveryCacheForTests,
} from '../api/_lib/quickBooksDiscovery.js';
import { completeQuickBooksConnection } from '../api/integrations/quickbooks/callback.js';

process.env.QUICKBOOKS_CLIENT_ID = 'sandbox-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'sandbox-client-secret';
process.env.QUICKBOOKS_REDIRECT_URI = 'https://oliveops.example/api/integrations/quickbooks/callback';
process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

// Real field names and values as currently published by Intuit's discovery documents (verified
// against the live production and sandbox discovery endpoints - both publish identical OAuth
// endpoint values, only userinfo_endpoint differs, which OliveOps does not use).
const validDiscoveryPayload = (overrides = {}) => ({
  issuer: 'https://oauth.platform.intuit.com/op/v1',
  authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2',
  token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  userinfo_endpoint: 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
  revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
  jwks_uri: 'https://oauth.platform.intuit.com/op/v1/jwks',
  ...overrides,
});

// Composes a discovery-document response with test-specific handling of any other request, so each
// test only has to describe the endpoint(s) it actually cares about.
function withDiscovery(handleOther, discoveryPayload = validDiscoveryPayload()) {
  return async (url, options) => {
    if (String(url) === QUICKBOOKS_DISCOVERY_URL) return jsonResponse(discoveryPayload);
    return handleOther(url, options);
  };
}

beforeEach(() => resetQuickBooksDiscoveryCacheForTests());

test('QuickBooks connection and mappings are business-owned and realm-scoped', () => {
  assert.equal(quickBooksConnectionSk(), 'QBO_CONNECTION');
  assert.notEqual(quickBooksCustomerMappingSk('realm-1', 'customer-1'), quickBooksCustomerMappingSk('realm-2', 'customer-1'));
  assert.notEqual(quickBooksInvoiceMappingSk('realm-1', 'invoice-1'), quickBooksInvoiceMappingSk('realm-1', 'invoice-2'));
});

test('safe QuickBooks status never returns encrypted credentials or leases', () => {
  const safe = toSafeQuickBooksConnection({
    status: 'connected',
    realmId: 'realm-1',
    companyName: 'Olive Contracting Inc.',
    encryptedAccessToken: { ciphertext: 'access-secret' },
    encryptedRefreshToken: { ciphertext: 'refresh-secret' },
    refreshLeaseId: 'lease-secret',
  });
  const serialized = JSON.stringify(safe);
  assert.equal(safe.connected, true);
  assert.equal(safe.environment, 'sandbox');
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('Token'), false);
  assert.equal(serialized.includes('Lease'), false);
});

test('QuickBooks OAuth authorization is accounting-scoped and state-bound', async () => {
  const authorizationUrl = new URL(await buildQuickBooksAuthorizationUrl({
    state: 'random-state',
    config: {
      clientId: 'sandbox-client-id',
      clientSecret: 'unused',
      redirectUri: 'https://oliveops.example/api/integrations/quickbooks/callback',
    },
    fetchImpl: withDiscovery(() => assert.fail('only the discovery document should be requested')),
  }));
  assert.equal(authorizationUrl.origin, 'https://appcenter.intuit.com');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  assert.equal(authorizationUrl.searchParams.get('state'), 'random-state');

  let available = true;
  const consumeState = async ({ businessId, userId, stateHash }) => {
    assert.equal(businessId, 'business-1');
    assert.equal(userId, 'user-1');
    assert.equal(stateHash, hashQuickBooksOAuthState('valid-state'));
    if (!available) return null;
    available = false;
    return { businessId, userId };
  };
  assert.equal(await validateQuickBooksOAuthCallbackState({
    businessId: 'business-1', userId: 'user-1', state: 'valid-state', consumeState,
  }), true);
  assert.equal(await validateQuickBooksOAuthCallbackState({
    businessId: 'business-1', userId: 'user-1', state: 'valid-state', consumeState,
  }), false);
});

test('CompanyInfo requests are pinned to the QuickBooks sandbox host', async () => {
  let requestedUrl = '';
  const company = await fetchQuickBooksCompanyInfo({
    accessToken: 'access-token',
    realmId: '12345',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({ CompanyInfo: { Id: '1', CompanyName: 'Sandbox Co', LegalName: 'Sandbox Company Ltd.', Country: 'CA', Currency: 'CAD' } });
    },
  });
  assert.match(requestedUrl, /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/12345\/companyinfo\/12345/);
  assert.deepEqual(company, {
    companyName: 'Sandbox Co',
    legalName: 'Sandbox Company Ltd.',
    country: 'CA',
    currency: 'CAD',
    companyInfoEntityId: '1',
  });
});

test('successful CompanyInfo response does not require an entity id matching the OAuth realm', async () => {
  const company = await fetchQuickBooksCompanyInfo({
    accessToken: 'access-token',
    realmId: '9341457230000000',
    fetchImpl: async () => jsonResponse({ CompanyInfo: { CompanyName: 'Sandbox Co' } }),
  });
  assert.equal(company.companyName, 'Sandbox Co');
  assert.equal(company.companyInfoEntityId, '');
  assert.equal('realmId' in company, false);
});

test('OAuth realmId remains authoritative when CompanyInfo.Id is a different entity id', async () => {
  const realmId = '9341457230000000';
  const persisted = [];
  const result = await completeQuickBooksConnection({
    session: { businessId: 'business-1', id: 'user-1', name: 'Owner', email: 'owner@example.com' },
    code: 'authorization-code',
    realmId,
  }, {
    getConnection: async () => null,
    exchangeAuthorizationCode: async () => ({ access_token: 'access-token', refresh_token: 'refresh-token' }),
    fetchCompanyInfo: async ({ accessToken, realmId: requestedRealmId }) => {
      assert.equal(accessToken, 'access-token');
      assert.equal(requestedRealmId, realmId);
      return {
        companyName: 'Sandbox Co', legalName: 'Sandbox Company Ltd.', country: 'CA', currency: 'CAD', companyInfoEntityId: '1',
      };
    },
    buildCredentials: () => ({ encryptedAccessToken: {}, encryptedRefreshToken: {} }),
    putConnection: async (value) => persisted.push(value),
    createAuditEvent: async () => {},
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].connection.realmId, realmId);
  assert.equal(persisted[0].connection.companyInfoEntityId, '1');
});

test('CompanyInfo API failure prevents token persistence and fails safely', async () => {
  let persisted = false;
  await assert.rejects(
    completeQuickBooksConnection({
      session: { businessId: 'business-1', id: 'user-1', name: 'Owner', email: 'owner@example.com' },
      code: 'authorization-code',
      realmId: '9341457230000000',
    }, {
      getConnection: async () => null,
      exchangeAuthorizationCode: async () => ({ access_token: 'access-token', refresh_token: 'refresh-token' }),
      fetchCompanyInfo: async () => { throw new Error('QuickBooks request failed'); },
      buildCredentials: () => assert.fail('credentials must not be built before CompanyInfo succeeds'),
      putConnection: async () => { persisted = true; },
      createAuditEvent: async () => assert.fail('failed connections must not be audited as connected'),
    }),
    /QuickBooks request failed/
  );
  assert.equal(persisted, false);
});

test('QuickBooks callback keeps missing realm and invalid state failure paths', async () => {
  assert.equal(await validateQuickBooksOAuthCallbackState({
    businessId: 'business-1', userId: 'user-1', state: '', consumeState: async () => assert.fail('empty state must not be consumed'),
  }), false);
  const callbackSource = await readFile(new URL('../api/integrations/quickbooks/callback.js', import.meta.url), 'utf8');
  assert.match(callbackSource, /if \(!realmId\) return redirectToQuickBooksIntegrations\(res, 'missing_realm'\)/);
  assert.match(callbackSource, /catch \{[\s\S]*redirectToQuickBooksIntegrations\(res, 'connection_failed'\)/);
  assert.doesNotMatch(callbackSource, /realm_mismatch|company\.realmId/);
});

test('expired QuickBooks access tokens refresh once and persist rotated credentials under the lease', async () => {
  const initial = buildEncryptedQuickBooksCredentials({
    businessId: 'business-1',
    realmId: 'realm-1',
    tokens: { access_token: 'expired-access', refresh_token: 'initial-refresh', expires_in: 1, x_refresh_token_expires_in: 3600 },
  });
  const connection = { realmId: 'realm-1', ...initial, accessTokenExpiresAt: '2020-01-01T00:00:00.000Z' };
  const persisted = [];
  const accessToken = await getValidQuickBooksAccessToken({
    businessId: 'business-1',
    connection,
    fetchImpl: withDiscovery(async (url, options) => {
      assert.equal(String(url), 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
      assert.match(String(options.body), /grant_type=refresh_token/);
      return jsonResponse({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, x_refresh_token_expires_in: 7200 });
    }),
    dependencies: {
      acquireRefreshLease: async () => true,
      persistRefreshedCredentials: async (value) => persisted.push(value),
      releaseRefreshLease: async () => assert.fail('successful refresh must not release after persistence'),
    },
  });
  assert.equal(accessToken, 'rotated-access');
  assert.equal(persisted.length, 1);
  assert.equal(JSON.stringify(persisted[0]).includes('rotated-access'), false);
  assert.equal(JSON.stringify(persisted[0]).includes('rotated-refresh'), false);
});

test('QuickBooks handlers require owner/admin sessions and never expose provider credentials', async () => {
  const files = await Promise.all([
    'connect.js', 'callback.js', 'status.js', 'disconnect.js',
  ].map((name) => readFile(new URL(`../api/integrations/quickbooks/${name}`, import.meta.url), 'utf8')));
  for (const source of files) assert.match(source, /requireSession\(req, res, \['owner', 'admin'\]\)/);
  const statusSource = files[2];
  assert.match(statusSource, /toSafeQuickBooksConnection/);
  assert.doesNotMatch(statusSource, /encryptedAccessToken|encryptedRefreshToken/);
});

test('QuickBooks environment defaults to sandbox and switches the pinned API host under QUICKBOOKS_ENVIRONMENT=production', async () => {
  assert.equal(process.env.QUICKBOOKS_ENVIRONMENT, undefined);
  assert.equal(toSafeQuickBooksConnection(null).environment, 'sandbox');

  let requestedUrl = '';
  process.env.QUICKBOOKS_ENVIRONMENT = 'production';
  try {
    assert.equal(toSafeQuickBooksConnection(null).environment, 'production');
    await fetchQuickBooksCompanyInfo({
      accessToken: 'access-token',
      realmId: '12345',
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return jsonResponse({ CompanyInfo: { Id: '1', CompanyName: 'Real Co' } });
      },
    });
  } finally {
    delete process.env.QUICKBOOKS_ENVIRONMENT;
  }
  assert.match(requestedUrl, /^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/12345\/companyinfo\/12345/);
});

test('a stored QuickBooks connection reports the environment it was actually connected under, not the deployment\'s current setting', () => {
  const sandboxConnection = { status: 'connected', realmId: 'realm-1', environment: 'sandbox' };
  assert.equal(toSafeQuickBooksConnection(sandboxConnection).environment, 'sandbox');
  process.env.QUICKBOOKS_ENVIRONMENT = 'production';
  try {
    assert.equal(toSafeQuickBooksConnection(sandboxConnection).environment, 'sandbox');
  } finally {
    delete process.env.QUICKBOOKS_ENVIRONMENT;
  }
});

test('QuickBooks tax codes include resolved active sales-tax rates', async () => {
  const responses = [
    { QueryResponse: { TaxCode: [
      { Id: 'TAX', Name: 'Taxable', Taxable: true, Active: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: 'RATE-1' } }] } },
      { Id: 'NON', Name: 'Non-taxable', Taxable: false, Active: true },
    ] } },
    { QueryResponse: { TaxRate: [{ Id: 'RATE-1', RateValue: 13, Active: true }] } },
  ];
  const taxCodes = await listQuickBooksTaxCodes({
    accessToken: 'access-token', realmId: 'realm-1',
    fetchImpl: async () => jsonResponse(responses.shift()),
  });
  assert.deepEqual(taxCodes.map(({ id, rate }) => ({ id, rate })), [{ id: 'TAX', rate: 13 }, { id: 'NON', rate: 0 }]);
});

test('OAuth discovery document is fetched, parsed, and its trusted endpoints returned', async () => {
  let requestedUrl = '';
  const discovery = await getQuickBooksDiscoveryDocument({
    fetchImpl: async (url) => { requestedUrl = String(url); return jsonResponse(validDiscoveryPayload()); },
  });
  assert.equal(requestedUrl, QUICKBOOKS_DISCOVERY_URL);
  assert.equal(discovery.authorizationEndpoint, 'https://appcenter.intuit.com/connect/oauth2');
  assert.equal(discovery.tokenEndpoint, 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
  assert.equal(discovery.revocationEndpoint, 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke');
});

test('discovery URL is a fixed server-side constant, never derived from a client request', async () => {
  const discoverySource = await readFile(new URL('../api/_lib/quickBooksDiscovery.js', import.meta.url), 'utf8');
  assert.match(QUICKBOOKS_DISCOVERY_URL, /^https:\/\/developer\.api\.intuit\.com\//);
  assert.doesNotMatch(discoverySource, /req\.query|req\.body|req\.params/);
  // getQuickBooksDiscoveryDocument only accepts { fetchImpl, now } - no caller-supplied URL.
  assert.doesNotMatch(discoverySource, /getQuickBooksDiscoveryDocument\([^)]*\burl\b/);
});

test('the discovered authorization endpoint drives the built authorization URL, not a hard-coded one', async () => {
  const authorizationUrl = new URL(await buildQuickBooksAuthorizationUrl({
    state: 'random-state',
    config: { clientId: 'sandbox-client-id', clientSecret: 'unused', redirectUri: 'https://oliveops.example/api/integrations/quickbooks/callback' },
    fetchImpl: withDiscovery(
      () => assert.fail('only the discovery document should be requested'),
      validDiscoveryPayload({ authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2/v2-test-path' }),
    ),
  }));
  assert.equal(authorizationUrl.origin, 'https://appcenter.intuit.com');
  assert.equal(authorizationUrl.pathname, '/connect/oauth2/v2-test-path');
});

test('the discovered token endpoint drives authorization-code exchange, not a hard-coded one', async () => {
  let requestedUrl = '';
  await exchangeQuickBooksAuthorizationCode('authorization-code', {
    config: { clientId: 'sandbox-client-id', clientSecret: 'sandbox-client-secret', redirectUri: 'https://oliveops.example/api/integrations/quickbooks/callback' },
    fetchImpl: withDiscovery(
      async (url) => { requestedUrl = String(url); return jsonResponse({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, x_refresh_token_expires_in: 7200 }); },
      validDiscoveryPayload({ token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer/v2-test-path' }),
    ),
  });
  assert.equal(requestedUrl, 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer/v2-test-path');
});

test('the discovered token endpoint drives refresh, not a hard-coded one', async () => {
  const initial = buildEncryptedQuickBooksCredentials({
    businessId: 'business-1',
    realmId: 'realm-1',
    tokens: { access_token: 'expired-access', refresh_token: 'initial-refresh', expires_in: 1, x_refresh_token_expires_in: 3600 },
  });
  const connection = { realmId: 'realm-1', ...initial, accessTokenExpiresAt: '2020-01-01T00:00:00.000Z' };
  let requestedUrl = '';
  await getValidQuickBooksAccessToken({
    businessId: 'business-1',
    connection,
    fetchImpl: withDiscovery(
      async (url) => { requestedUrl = String(url); return jsonResponse({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, x_refresh_token_expires_in: 7200 }); },
      validDiscoveryPayload({ token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer/v2-test-path' }),
    ),
    dependencies: {
      acquireRefreshLease: async () => true,
      persistRefreshedCredentials: async () => {},
      releaseRefreshLease: async () => assert.fail('successful refresh must not release after persistence'),
    },
  });
  assert.equal(requestedUrl, 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer/v2-test-path');
});

test('disconnect revocation uses the discovered revocation endpoint when Intuit supplies one', async () => {
  let requestedUrl = '';
  await revokeQuickBooksToken({
    token: 'refresh-token',
    config: { clientId: 'sandbox-client-id', clientSecret: 'sandbox-client-secret', redirectUri: 'https://oliveops.example/api/integrations/quickbooks/callback' },
    fetchImpl: withDiscovery(
      async (url) => { requestedUrl = String(url); return new Response(null, { status: 200 }); },
      validDiscoveryPayload({ revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke/v2-test-path' }),
    ),
  });
  assert.equal(requestedUrl, 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke/v2-test-path');
});

test('revocation falls back to the static endpoint without weakening disconnect when discovery is unavailable', async () => {
  let requestedUrl = '';
  await revokeQuickBooksToken({
    token: 'refresh-token',
    config: { clientId: 'sandbox-client-id', clientSecret: 'sandbox-client-secret', redirectUri: 'https://oliveops.example/api/integrations/quickbooks/callback' },
    fetchImpl: async (url) => {
      if (String(url) === QUICKBOOKS_DISCOVERY_URL) return new Response(null, { status: 503 });
      requestedUrl = String(url);
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(requestedUrl, 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke');
});

test('discovery is fetched once and cached for subsequent calls', async () => {
  let fetchCount = 0;
  const fetchImpl = async () => { fetchCount += 1; return jsonResponse(validDiscoveryPayload()); };
  await getQuickBooksDiscoveryDocument({ fetchImpl });
  await getQuickBooksDiscoveryDocument({ fetchImpl });
  await getQuickBooksDiscoveryDocument({ fetchImpl });
  assert.equal(fetchCount, 1);
});

test('a cached discovery document is refetched once its ~1 hour TTL expires', async () => {
  let fetchCount = 0;
  const fetchImpl = async () => { fetchCount += 1; return jsonResponse(validDiscoveryPayload()); };
  let clock = 0;
  const now = () => clock;

  await getQuickBooksDiscoveryDocument({ fetchImpl, now });
  assert.equal(fetchCount, 1);
  clock += 59 * 60 * 1000;
  await getQuickBooksDiscoveryDocument({ fetchImpl, now });
  assert.equal(fetchCount, 1, 'still cached shortly before the ~1 hour TTL elapses');
  clock += 2 * 60 * 1000;
  await getQuickBooksDiscoveryDocument({ fetchImpl, now });
  assert.equal(fetchCount, 2, 'refetched once the TTL has elapsed');
});

test('malformed discovery responses fail safely instead of being used', async () => {
  const cases = [
    ['a non-JSON body', async () => new Response('not json', { status: 200 })],
    ['a JSON array instead of an object', async () => jsonResponse(['not', 'an', 'object'])],
    ['a document missing the authorization endpoint', async () => jsonResponse(validDiscoveryPayload({ authorization_endpoint: undefined }))],
    ['a document missing the token endpoint', async () => jsonResponse(validDiscoveryPayload({ token_endpoint: undefined }))],
    ['an HTTP error response', async () => new Response(null, { status: 500 })],
  ];
  for (const [label, fetchImpl] of cases) {
    resetQuickBooksDiscoveryCacheForTests();
    await assert.rejects(getQuickBooksDiscoveryDocument({ fetchImpl }), `expected discovery to fail safely for: ${label}`);
  }
});

test('non-HTTPS discovered endpoints are rejected', async () => {
  await assert.rejects(getQuickBooksDiscoveryDocument({
    fetchImpl: async () => jsonResponse(validDiscoveryPayload({ authorization_endpoint: 'http://appcenter.intuit.com/connect/oauth2' })),
  }));
  resetQuickBooksDiscoveryCacheForTests();
  await assert.rejects(getQuickBooksDiscoveryDocument({
    fetchImpl: async () => jsonResponse(validDiscoveryPayload({ token_endpoint: 'http://oauth.platform.intuit.com/oauth2/v1/tokens/bearer' })),
  }));
});

test('discovered endpoints on unexpected, non-Intuit hosts are rejected', async () => {
  await assert.rejects(getQuickBooksDiscoveryDocument({
    fetchImpl: async () => jsonResponse(validDiscoveryPayload({ authorization_endpoint: 'https://evil.example.com/connect/oauth2' })),
  }));
  resetQuickBooksDiscoveryCacheForTests();
  await assert.rejects(getQuickBooksDiscoveryDocument({
    fetchImpl: async () => jsonResponse(validDiscoveryPayload({ token_endpoint: 'https://attacker.controlled.host/oauth2/v1/tokens/bearer' })),
  }));
  resetQuickBooksDiscoveryCacheForTests();
  // A supplied-but-untrusted revocation_endpoint must not be silently ignored in favor of the
  // default - the whole document is rejected, since it wasn't a value we can trust at all.
  await assert.rejects(getQuickBooksDiscoveryDocument({
    fetchImpl: async () => jsonResponse(validDiscoveryPayload({ revocation_endpoint: 'https://evil.example.com/v2/oauth2/tokens/revoke' })),
  }));
});