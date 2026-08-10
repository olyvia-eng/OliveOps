import test from 'node:test';
import assert from 'node:assert/strict';
import usersHandler from '../api/users.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';

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

    if (commandType === 'TransactWriteCommand') {
      for (const tx of input.TransactItems ?? []) {
        if (tx.Put?.Item) {
          const putItem = { ...tx.Put.Item };
          store.set(mapKey(putItem.PK, putItem.SK), putItem);
        }
        if (tx.Delete?.Key) {
          store.delete(mapKey(tx.Delete.Key.PK, tx.Delete.Key.SK));
        }
      }
      return {};
    }

    return originalSend(command);
  };

  t.after(() => {
    ddb.send = originalSend;
  });

  return store;
}

function seedUser(store, { businessId, userId, role, email, name }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `USER#${userId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `USER#${userId}`,
      entityType: 'USER',
      businessId,
      userId,
      name,
      email,
      role,
      active: true,
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );

  store.set(
    mapKey(`EMAIL#${email}`, 'USER'),
    {
      PK: `EMAIL#${email}`,
      SK: 'USER',
      entityType: 'EMAIL_LOOKUP',
      businessId,
      userId,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

async function createBearerSession({ businessId, userId, role, email, token }) {
  await createMobileSessionForUser({
    user: {
      id: userId,
      businessId,
      name: `User ${userId}`,
      email,
      role,
      businessName: `Business ${businessId}`,
      employeeId: null,
    },
    accessToken: token,
    expiresInSeconds: 604800,
  });
}

test('PATCH /api/users blocks assigning owner role to non-owner user', async (t) => {
  const store = installDdbMock(t);

  seedUser(store, {
    businessId: 'biz-1',
    userId: 'user-admin-1',
    role: 'admin',
    email: 'admin1@example.com',
    name: 'Admin One',
  });
  seedUser(store, {
    businessId: 'biz-1',
    userId: 'user-crew-1',
    role: 'crew_member',
    email: 'crew1@example.com',
    name: 'Crew One',
  });

  await createBearerSession({
    businessId: 'biz-1',
    userId: 'user-admin-1',
    role: 'admin',
    email: 'admin1@example.com',
    token: 'token-admin-1',
  });

  const req = {
    method: 'PATCH',
    query: { id: 'user-crew-1' },
    headers: { authorization: 'Bearer token-admin-1' },
    body: {
      data: {
        role: 'owner',
      },
    },
  };
  const res = createMockRes();

  await usersHandler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Owner role cannot be assigned via this endpoint.');
});

test('PATCH /api/users ignores sensitive mass-assignment fields', async (t) => {
  const store = installDdbMock(t);

  seedUser(store, {
    businessId: 'biz-1',
    userId: 'user-admin-1',
    role: 'admin',
    email: 'admin1@example.com',
    name: 'Admin One',
  });
  seedUser(store, {
    businessId: 'biz-1',
    userId: 'user-foreman-1',
    role: 'foreman',
    email: 'foreman1@example.com',
    name: 'Foreman One',
  });

  await createBearerSession({
    businessId: 'biz-1',
    userId: 'user-admin-1',
    role: 'admin',
    email: 'admin1@example.com',
    token: 'token-admin-safe',
  });

  const req = {
    method: 'PATCH',
    query: { id: 'user-foreman-1' },
    headers: { authorization: 'Bearer token-admin-safe' },
    body: {
      data: {
        name: 'Updated Foreman',
        passwordHash: 'attacker-hash',
        businessId: 'biz-evil',
        createdAt: '2000-01-01T00:00:00.000Z',
        PK: 'BUSINESS#biz-evil',
        SK: 'USER#evil',
      },
    },
  };
  const res = createMockRes();

  await usersHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);

  const updated = store.get(mapKey('BUSINESS#biz-1', 'USER#user-foreman-1'));
  assert.equal(updated.name, 'Updated Foreman');
  assert.equal(updated.businessId, 'biz-1');
  assert.equal(updated.passwordHash, 'hash');
  assert.equal(updated.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(updated.PK, 'BUSINESS#biz-1');
  assert.equal(updated.SK, 'USER#user-foreman-1');
});
