import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandler } from '../api/auth.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const demoUser = {
  id: 'user-1',
  businessId: 'biz-1',
  name: 'Casey Crew',
  email: 'casey@example.com',
  role: 'crew_member',
  businessName: 'OliveOps Demo',
  employeeId: 'emp-1',
};

function createHandler(overrides = {}) {
  return createAuthHandler({
    checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 60 }),
    ...overrides,
  });
}

test('POST /api/auth?action=mobile-login returns bearer token payload', async () => {
  let persistedSession = null;
  const handler = createHandler({
    authenticateUser: async () => ({ ok: true, user: demoUser }),
    createMobileAccessToken: () => 'oliveops_mobile_test_token',
    createMobileSessionForUser: async (payload) => {
      persistedSession = payload;
      return { ok: true };
    },
    getEmployeeForBusiness: async () => ({ id: 'emp-1', paidDriveTimeEnabled: true }),
  });

  const req = {
    method: 'POST',
    query: { action: 'mobile-login' },
    body: { email: 'casey@example.com', password: 'correct-horse-battery-staple' },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accessToken, 'oliveops_mobile_test_token');
  assert.equal(res.body.tokenType, 'Bearer');
  assert.equal(res.body.expiresIn, 604800);
  assert.deepEqual(res.body.user, demoUser);
  assert.deepEqual(res.body.capabilities, { paidDriveTime: true });
  assert.equal(persistedSession.user.businessId, 'biz-1');
  assert.equal(persistedSession.user.id, 'user-1');
});

test('POST /api/auth?action=mobile-login rejects invalid password', async () => {
  const handler = createHandler({
    authenticateUser: async () => ({ ok: false, error: 'Invalid email or password.' }),
  });

  const req = {
    method: 'POST',
    query: { action: 'mobile-login' },
    body: { email: 'casey@example.com', password: 'wrong-password' },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Invalid email or password.' });
});

test('POST /api/auth?action=mobile-login rejects unknown user', async () => {
  const handler = createHandler({
    authenticateUser: async () => ({ ok: false, error: 'Invalid email or password.' }),
  });

  const req = {
    method: 'POST',
    query: { action: 'mobile-login' },
    body: { email: 'missing@example.com', password: 'password1234' },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test('POST /api/auth?action=mobile-login rejects inactive users', async () => {
  const handler = createHandler({
    authenticateUser: async () => ({ ok: false, error: 'Invalid email or password.' }),
  });

  const req = {
    method: 'POST',
    query: { action: 'mobile-login' },
    body: { email: 'inactive@example.com', password: 'password1234' },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Invalid email or password.' });
});

test('GET /api/auth?action=session accepts bearer-resolved session identity', async () => {
  const handler = createHandler({
    getSessionFromRequest: async () => demoUser,
    getEmployeeForBusiness: async () => ({ id: 'emp-1', paidDriveTimeEnabled: false }),
  });

  const req = {
    method: 'GET',
    query: { action: 'session' },
    headers: { authorization: 'Bearer oliveops_mobile_test_token' },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, user: demoUser, capabilities: { paidDriveTime: true } });
});

test('GET /api/auth?action=session reports paidDriveTime capability true when enabled', async () => {
  const handler = createHandler({
    getSessionFromRequest: async () => demoUser,
    getEmployeeForBusiness: async () => ({ id: 'emp-1', paidDriveTimeEnabled: true }),
  });

  const req = {
    method: 'GET',
    query: { action: 'session' },
    headers: { authorization: 'Bearer oliveops_mobile_test_token' },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.capabilities, { paidDriveTime: true });
});

test('GET /api/auth?action=session reports paidDriveTime capability true when employee profile exists', async () => {
  const handler = createHandler({
    getSessionFromRequest: async () => demoUser,
    getEmployeeForBusiness: async () => ({ id: 'emp-1', paidDriveTimeEnabled: false }),
  });

  const req = {
    method: 'GET',
    query: { action: 'session' },
    headers: { authorization: 'Bearer oliveops_mobile_test_token' },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.capabilities, { paidDriveTime: true });
});

test('GET /api/auth?action=session rejects invalid bearer token', async () => {
  const handler = createHandler({
    getSessionFromRequest: async () => null,
  });

  const req = {
    method: 'GET',
    query: { action: 'session' },
    headers: { authorization: 'Bearer invalid-token' },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Unauthorized' });
});

test('POST /api/auth?action=logout revokes bearer token', async () => {
  let revokedToken = null;
  const handler = createHandler({
    getBearerTokenFromRequest: () => 'oliveops_mobile_test_token',
    revokeMobileSessionByAccessToken: async (token) => {
      revokedToken = token;
      return { ok: true, revoked: true };
    },
    buildClearedSessionCookie: () => 'oliveops_session=; Max-Age=0; Path=/; HttpOnly',
  });

  const req = {
    method: 'POST',
    query: { action: 'logout' },
    headers: { authorization: 'Bearer oliveops_mobile_test_token' },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(revokedToken, 'oliveops_mobile_test_token');
  assert.equal(typeof res.headers['Set-Cookie'], 'string');
});

test('POST /api/auth?action=login still creates web cookie session', async () => {
  const handler = createHandler({
    authenticateUser: async () => ({ ok: true, user: demoUser }),
    createSessionToken: () => 'web-jwt-token',
    buildSessionCookie: (token) => `oliveops_session=${token}; HttpOnly`,
  });

  const req = {
    method: 'POST',
    query: { action: 'login' },
    body: { email: 'casey@example.com', password: 'password1234' },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers['Set-Cookie'], 'oliveops_session=web-jwt-token; HttpOnly');
});

test('POST /api/auth?action=login returns generic invalid credentials message', async () => {
  const handler = createHandler({
    authenticateUser: async () => ({ ok: false, error: 'Internal lookup mismatch details should not leak.' }),
    checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 60 }),
  });

  const req = {
    method: 'POST',
    query: { action: 'login' },
    body: { email: 'casey@example.com', password: 'wrong-password' },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Invalid email or password.' });
});

test('POST /api/auth?action=signup returns generic conflict message', async () => {
  const handler = createHandler({
    checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 60 }),
    createBusinessWithOwner: async () => ({ ok: false, error: 'An account with this email already exists.' }),
  });

  const req = {
    method: 'POST',
    query: { action: 'signup' },
    body: {
      businessName: 'OliveOps Demo',
      ownerName: 'Owner Name',
      email: 'owner@example.com',
      password: 'password1234',
    },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { ok: false, error: 'Unable to create account with those details.' });
});

test('POST /api/auth?action=signup requires both structured name fields', async () => {
  const handler = createHandler();
  const req = {
    method: 'POST', query: { action: 'signup' }, headers: {},
    body: { businessName: 'OliveOps Demo', firstName: 'Ada', lastName: ' ', email: 'ada@example.com', password: 'password1234' },
  };
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, error: 'Invalid signup fields' });
});

test('POST /api/auth?action=signup trims and forwards structured names', async () => {
  let received = null;
  const handler = createHandler({
    createBusinessWithOwner: async (payload) => { received = payload; return { ok: true, user: demoUser }; },
    createSessionToken: () => 'token', buildSessionCookie: () => 'cookie',
  });
  const req = {
    method: 'POST', query: { action: 'signup' }, headers: {},
    body: { businessName: 'OliveOps Demo', firstName: ' Ada ', lastName: ' Lovelace ', email: 'ada@example.com', password: 'password1234' },
  };
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.firstName, ' Ada ');
  assert.equal(received.lastName, ' Lovelace ');
});

test('POST /api/auth?action=login returns 429 when rate limited', async () => {
  const handler = createHandler({
    checkRateLimit: async () => ({ allowed: false, retryAfterSeconds: 45 }),
  });

  const req = {
    method: 'POST',
    query: { action: 'login' },
    body: { email: 'casey@example.com', password: 'password1234' },
    headers: {},
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '45');
  assert.deepEqual(res.body, { ok: false, error: 'Too many requests. Please try again later.' });
});
