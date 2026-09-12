import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { putQuickBooksConnection } from '../api/_lib/quickBooksRepo.js';
import { encryptSecret } from '../api/_lib/secretEncryption.js';
import { resetQuickBooksDiscoveryCacheForTests } from '../api/_lib/quickBooksDiscovery.js';

import connectHandler from '../api/integrations/quickbooks/connect.js';
import statusHandler from '../api/integrations/quickbooks/status.js';
import disconnectHandler from '../api/integrations/quickbooks/disconnect.js';
import customersHandler from '../api/integrations/quickbooks/customers.js';
import invoicesHandler from '../api/integrations/quickbooks/invoices.js';
import settingsHandler from '../api/integrations/quickbooks/settings.js';

process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.QUICKBOOKS_CLIENT_ID = 'sandbox-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'sandbox-client-secret';
process.env.QUICKBOOKS_REDIRECT_URI = 'https://oliveops.example/api/integrations/quickbooks/callback';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; return this; },
  json(body) { this.body = body; return this; },
  end() { return this; },
});

// A minimal real DynamoDB double covering Get/Put against the item shapes these handlers and their
// authRepo/quickBooksRepo dependencies read and write - same pattern as tests/business-profile-api.test.mjs
// and tests/quickbooks-realm-id-encryption.test.mjs, scoped to this file's Cache-Control assertions.
function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      if (input.ConditionExpression && store.has(key(input.Item.PK, input.Item.SK))) {
        const error = new Error('Conditional check failed'); error.name = 'ConditionalCheckFailedException'; throw error;
      }
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'DeleteCommand') {
      const itemKey = key(input.Key.PK, input.Key.SK);
      const existing = store.get(itemKey);
      store.delete(itemKey);
      return { Attributes: existing };
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

// requireSession's mobile-token path re-reads the current USER record (to catch role/deactivation
// changes since the token was issued), so a valid session needs both the session record itself and
// a matching USER item - mirrors tests/business-profile-api.test.mjs's seedUser helper.
async function seedSession(store, { businessId, userId, role, token }) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), {
    PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId,
    userId, name: userId, email: `${userId}@example.com`, role, active: true,
    passwordHash: 'hash', sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z',
  });
  await createMobileSessionForUser({
    user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role, businessName: 'Olive Test' },
    accessToken: token,
  });
}

function requestFor(handler) {
  return async (token, method, { query = {}, body } = {}) => {
    const res = response();
    await handler({ method, query, headers: { authorization: `Bearer ${token}` }, body }, res);
    return res;
  };
}

test('QuickBooks customers/invoices/settings/status/disconnect/connect responses always carry Cache-Control: no-store', async (t) => {
  const store = installDdb(t);
  t.after(() => resetQuickBooksDiscoveryCacheForTests());
  const businessId = 'business-cache-control';
  const token = 'owner-cc-token';
  await seedSession(store, { businessId, userId: 'owner-cc', role: 'owner', token });
  const request = {
    connect: requestFor(connectHandler),
    status: requestFor(statusHandler),
    disconnect: requestFor(disconnectHandler),
    customers: requestFor(customersHandler),
    invoices: requestFor(invoicesHandler),
    settings: requestFor(settingsHandler),
  };

  // --- Before any QuickBooks connection exists ---

  const statusEmpty = await request.status(token, 'GET');
  assert.equal(statusEmpty.statusCode, 200);
  assert.equal(statusEmpty.headers['Cache-Control'], 'no-store');

  const customersMissingId = await request.customers(token, 'GET', { query: {} });
  assert.equal(customersMissingId.statusCode, 400, 'sanity: this is the missing-id error path');
  assert.equal(customersMissingId.headers['Cache-Control'], 'no-store');

  const customersNoConnection = await request.customers(token, 'GET', { query: { customerId: 'customer-1' } });
  assert.equal(customersNoConnection.statusCode, 409, 'sanity: this is the no-connection error path');
  assert.equal(customersNoConnection.headers['Cache-Control'], 'no-store');

  const invoicesMissingId = await request.invoices(token, 'GET', { query: {} });
  assert.equal(invoicesMissingId.statusCode, 400, 'sanity: this is the missing-id error path');
  assert.equal(invoicesMissingId.headers['Cache-Control'], 'no-store');

  const invoicesNoConnection = await request.invoices(token, 'GET', { query: { invoiceId: 'invoice-1' } });
  assert.equal(invoicesNoConnection.statusCode, 409, 'sanity: this is the no-connection error path');
  assert.equal(invoicesNoConnection.headers['Cache-Control'], 'no-store');

  const settingsNoConnection = await request.settings(token, 'GET');
  assert.equal(settingsNoConnection.statusCode, 409, 'sanity: this is the no-connection error path');
  assert.equal(settingsNoConnection.headers['Cache-Control'], 'no-store');

  const disconnectNoConnection = await request.disconnect(token, 'POST');
  assert.equal(disconnectNoConnection.statusCode, 200);
  assert.equal(disconnectNoConnection.headers['Cache-Control'], 'no-store');

  // --- Seed a real connection, customer and invoice, then repeat for the "found" paths ---

  const realmId = 'realm-cache-control';
  const context = { provider: 'quickbooks-online', businessId, realmId };
  const options = { envName: 'QUICKBOOKS_TOKEN_ENCRYPTION_KEY' };
  await putQuickBooksConnection({
    businessId,
    connection: {
      realmId,
      companyName: 'Cache Co',
      status: 'connected',
      encryptedAccessToken: encryptSecret('access-token-value', context, undefined, options),
      encryptedRefreshToken: encryptSecret('refresh-token-value', context, undefined, options),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  store.set(key(`BUSINESS#${businessId}`, 'CUSTOMER#customer-1'), {
    PK: `BUSINESS#${businessId}`, SK: 'CUSTOMER#customer-1', entityType: 'CUSTOMER', businessId,
    customerId: 'customer-1', name: 'Test Customer', createdAt: '2026-01-01T00:00:00.000Z',
  });
  store.set(key(`BUSINESS#${businessId}`, 'INVOICE#invoice-1'), {
    PK: `BUSINESS#${businessId}`, SK: 'INVOICE#invoice-1', entityType: 'INVOICE', businessId,
    invoiceId: 'invoice-1', customerId: 'customer-1', status: 'sent', createdAt: '2026-01-01T00:00:00.000Z',
  });

  // connect.js already-connected path never contacts Intuit, so it is reachable without mocking fetch.
  const connectAlreadyConnected = await request.connect(token, 'GET');
  assert.equal(connectAlreadyConnected.statusCode, 409, 'sanity: this is the already-connected error path');
  assert.equal(connectAlreadyConnected.headers['Cache-Control'], 'no-store');

  const statusConnected = await request.status(token, 'GET');
  assert.equal(statusConnected.statusCode, 200);
  assert.equal(statusConnected.headers['Cache-Control'], 'no-store');

  const customersNotFound = await request.customers(token, 'GET', { query: { customerId: 'missing-customer' } });
  assert.equal(customersNotFound.statusCode, 404, 'sanity: this is the customer-not-found error path');
  assert.equal(customersNotFound.headers['Cache-Control'], 'no-store');

  // With a connection, an existing invoice and no QuickBooks mapping yet, invoices.js GET returns
  // successfully before ever contacting Intuit - a real 200 success path reachable without mocking fetch.
  const invoicesSuccessNoMapping = await request.invoices(token, 'GET', { query: { invoiceId: 'invoice-1' } });
  assert.equal(invoicesSuccessNoMapping.statusCode, 200, 'sanity: this is the no-existing-mapping success path');
  assert.equal(invoicesSuccessNoMapping.body.invoice, null);
  assert.equal(invoicesSuccessNoMapping.headers['Cache-Control'], 'no-store');

  // disconnect.js with a live connection: revokeQuickBooksToken always uses the global fetch (it
  // isn't dependency-injected like the rest of quickBooksService.js), so this stubs it rather than
  // making a real outbound call to Intuit from the test suite. The revocation is made to fail, which
  // disconnect.js already tolerates - local credential removal must still succeed, confirming the
  // header survives that error branch too.
  const originalFetch = global.fetch;
  resetQuickBooksDiscoveryCacheForTests();
  global.fetch = async () => new Response('Discovery unavailable', { status: 503 });
  let disconnectWithConnection;
  try {
    disconnectWithConnection = await request.disconnect(token, 'POST');
  } finally {
    global.fetch = originalFetch;
    resetQuickBooksDiscoveryCacheForTests();
  }
  assert.equal(disconnectWithConnection.statusCode, 200);
  assert.equal(disconnectWithConnection.headers['Cache-Control'], 'no-store');
});

test('every QuickBooks endpoint applies Cache-Control: no-store unconditionally, before any success/error branching', async () => {
  const dir = new URL('../api/integrations/quickbooks/', import.meta.url);

  // connect.js, status.js, disconnect.js, customers.js, invoices.js and settings.js all call the
  // shared helper directly, right after the session check and before their own try block - this
  // proves it also covers response paths this file does not exercise functionally (e.g. the
  // customers/settings success paths that call out to QuickBooks over the network).
  for (const file of ['connect.js', 'status.js', 'disconnect.js', 'customers.js', 'invoices.js', 'settings.js']) {
    const source = await readFile(new URL(file, dir), 'utf8');
    const callIndex = source.indexOf('noStoreCacheControl(res)');
    assert.notEqual(callIndex, -1, `${file} must call the shared noStoreCacheControl helper`);
    const tryIndex = source.indexOf('try {');
    assert.ok(
      tryIndex === -1 || callIndex < tryIndex,
      `${file} must set Cache-Control before its try block so every response path (success and error) it can produce is covered`,
    );
  }

  // callback.js never calls res.status directly - every response it sends goes through
  // redirectToQuickBooksIntegrations, which itself applies Cache-Control: no-store.
  const callbackSource = await readFile(new URL('callback.js', dir), 'utf8');
  assert.equal(/\bres\.status\(/.test(callbackSource), false, 'callback.js must only ever respond via redirectToQuickBooksIntegrations');

  const httpSource = await readFile(new URL('_http.js', dir), 'utf8');
  assert.match(httpSource, /export function noStoreCacheControl\(res\)\s*\{\s*res\.setHeader\('Cache-Control',\s*'no-store'\);?\s*\}/);
  assert.match(httpSource, /export function redirectToQuickBooksIntegrations[\s\S]*?noStoreCacheControl\(res\)/);
});
