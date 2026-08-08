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

test('POST /api/auth?action=mobile-login returns bearer token payload', async () => {
  let persistedSession = null;
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
  const handler = createAuthHandler({
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
