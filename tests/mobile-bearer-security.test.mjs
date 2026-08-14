import test from 'node:test';
import assert from 'node:assert/strict';
import dataHandler from '../api/data.js';
import { ddb } from '../api/_lib/db.js';
import {
  createMobileSessionForUser,
  resolveMobileSessionByAccessToken,
  revokeMobileSessionByAccessToken,
} from '../api/_lib/authRepo.js';

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
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mapKey(pk, sk) {
  return `${pk}|${sk}`;
}

function installDdbMock(t) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);

  ddb.send = async (command) => {
    const commandType = command?.constructor?.name;
    const input = command?.input ?? {};

    if (commandType === 'PutCommand') {
      const item = { ...input.Item };
      store.set(mapKey(item.PK, item.SK), item);
      return {};
    }

    if (commandType === 'GetCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      return { Item: store.get(key) };
    }

    if (commandType === 'UpdateCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      const existing = store.get(key);
      if (!existing) {
        const error = new Error('Conditional check failed');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }

      const next = {
        ...existing,
        revokedAt: input.ExpressionAttributeValues[':revokedAt'],
        updatedAt: input.ExpressionAttributeValues[':updatedAt'],
      };
      store.set(key, next);
      return {};
    }

    if (commandType === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      const items = [];
      for (const item of store.values()) {
        if (item.PK === pk && typeof item.SK === 'string' && item.SK.startsWith(prefix)) {
          items.push(item);
        }
      }
      return { Items: items };
    }

    return originalSend(command);
  };

  t.after(() => {
    ddb.send = originalSend;
  });

  return store;
}

function seedBusinessUser(store, { businessId, userId, role = 'admin', email = 'admin@example.com' }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `USER#${userId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `USER#${userId}`,
      entityType: 'USER',
      businessId,
      userId,
      name: 'Admin User',
      email,
      role,
      active: true,
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

function seedCustomer(store, { businessId, customerId, name }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `CUSTOMER#${customerId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `CUSTOMER#${customerId}`,
      entityType: 'CUSTOMER',
      businessId,
      customerId,
      id: customerId,
      name,
      company: '',
      email: '',
      phone: '',
      properties: [],
      status: 'active',
      notes: '',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

test('mobile access token resolves to the correct user and business', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });

  await createMobileSessionForUser({
    user: {
      id: 'user-a',
      businessId: 'biz-a',
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      businessName: 'Business A',
      employeeId: 'emp-a',
    },
    accessToken: 'token-a',
    expiresInSeconds: 604800,
  });

  const resolved = await resolveMobileSessionByAccessToken('token-a');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.session.user.id, 'user-a');
  assert.equal(resolved.session.user.businessId, 'biz-a');
});

test('mobile access token resolves current user role after role change', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a', role: 'admin', email: 'admin@example.com' });

  await createMobileSessionForUser({
    user: {
      id: 'user-a',
      businessId: 'biz-a',
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      businessName: 'Business A',
      employeeId: 'emp-a',
    },
    accessToken: 'token-role-change',
    expiresInSeconds: 604800,
  });

  const userKey = mapKey('BUSINESS#biz-a', 'USER#user-a');
  const existingUser = store.get(userKey);
  store.set(userKey, {
    ...existingUser,
    role: 'crew_member',
  });

  const resolved = await resolveMobileSessionByAccessToken('token-role-change');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.session.user.role, 'crew_member');
});

test('mobile access token is rejected after the user session version changes', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });
  await createMobileSessionForUser({
    user: { id: 'user-a', businessId: 'biz-a', name: 'Admin User', email: 'admin@example.com', role: 'admin', businessName: 'Business A', sessionVersion: 0 },
    accessToken: 'versioned-token', expiresInSeconds: 604800,
  });
  const userKey = mapKey('BUSINESS#biz-a', 'USER#user-a');
  store.set(userKey, { ...store.get(userKey), sessionVersion: 1 });
  const resolved = await resolveMobileSessionByAccessToken('versioned-token');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'revoked');
});

test('revoked mobile access token is rejected', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });

  await createMobileSessionForUser({
    user: {
      id: 'user-a',
      businessId: 'biz-a',
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      businessName: 'Business A',
    },
    accessToken: 'token-revoke',
    expiresInSeconds: 604800,
  });

  const revoked = await revokeMobileSessionByAccessToken('token-revoke');
  assert.equal(revoked.ok, true);

  const resolved = await resolveMobileSessionByAccessToken('token-revoke');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'revoked');
});

test('expired mobile access token is rejected', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a' });

  await createMobileSessionForUser({
    user: {
      id: 'user-a',
      businessId: 'biz-a',
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      businessName: 'Business A',
    },
    accessToken: 'token-expired',
    expiresInSeconds: 604800,
  });

  for (const [key, value] of store.entries()) {
    if (key.includes('MOBILE_SESSION_TOKEN#') && value.userId === 'user-a') {
      store.set(key, { ...value, expiresAt: '2000-01-01T00:00:00.000Z' });
    }
  }

  const resolved = await resolveMobileSessionByAccessToken('token-expired');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'expired');
});

test('bearer-authenticated data requests remain tenant-scoped', async (t) => {
  const store = installDdbMock(t);

  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-a', role: 'admin', email: 'a@example.com' });
  seedBusinessUser(store, { businessId: 'biz-b', userId: 'user-b', role: 'admin', email: 'b@example.com' });
  seedCustomer(store, { businessId: 'biz-a', customerId: 'cust-a', name: 'Customer A' });
  seedCustomer(store, { businessId: 'biz-b', customerId: 'cust-b', name: 'Customer B' });

  await createMobileSessionForUser({
    user: {
      id: 'user-a',
      businessId: 'biz-a',
      name: 'Admin A',
      email: 'a@example.com',
      role: 'admin',
      businessName: 'Business A',
    },
    accessToken: 'tenant-token-a',
    expiresInSeconds: 604800,
  });

  const listReq = {
    method: 'GET',
    query: { entity: 'customers' },
    headers: { authorization: 'Bearer tenant-token-a' },
  };
  const listRes = createMockRes();

  await dataHandler(listReq, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.ok, true);
  assert.equal(Array.isArray(listRes.body.items), true);
  assert.equal(listRes.body.items.length, 1);
  assert.equal(listRes.body.items[0].id, 'cust-a');

  const patchReq = {
    method: 'PATCH',
    query: { entity: 'customers', id: 'cust-b' },
    headers: { authorization: 'Bearer tenant-token-a' },
    body: { data: { name: 'Tampered Name' } },
  };
  const patchRes = createMockRes();

  await dataHandler(patchReq, patchRes);

  assert.equal(patchRes.statusCode, 404);
  assert.equal(patchRes.body.ok, false);
});
