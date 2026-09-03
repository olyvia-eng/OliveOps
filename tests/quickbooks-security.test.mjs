import test from 'node:test';
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
  fetchQuickBooksCompanyInfo,
  getValidQuickBooksAccessToken,
  listQuickBooksTaxCodes,
  validateQuickBooksOAuthCallbackState,
} from '../api/_lib/quickBooksService.js';
import { completeQuickBooksConnection } from '../api/integrations/quickbooks/callback.js';

process.env.QUICKBOOKS_CLIENT_ID = 'sandbox-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'sandbox-client-secret';
process.env.QUICKBOOKS_REDIRECT_URI = 'https://oliveops.example/api/integrations/quickbooks/callback';
process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

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
  const authorizationUrl = new URL(buildQuickBooksAuthorizationUrl({
    state: 'random-state',
    config: {
      clientId: 'sandbox-client-id',
      clientSecret: 'unused',
      redirectUri: 'https://oliveops.example/api/integrations/quickbooks/callback',
    },
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
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
      assert.match(String(options.body), /grant_type=refresh_token/);
      return jsonResponse({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, x_refresh_token_expires_in: 7200 });
    },
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