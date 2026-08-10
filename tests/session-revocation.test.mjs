import test from 'node:test';
import assert from 'node:assert/strict';
import { ddb } from '../api/_lib/db.js';
import { createSessionToken, getSessionFromRequest } from '../api/_lib/session.js';

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

function seedUser(store, { businessId, userId, role = 'admin', active = true, email = 'admin@example.com' }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `USER#${userId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `USER#${userId}`,
      entityType: 'USER',
      businessId,
      userId,
      name: 'Session User',
      email,
      role,
      active,
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

test('cookie session resolves current role from database instead of stale JWT role', async (t) => {
  const store = installDdbMock(t);

  seedUser(store, { businessId: 'biz-1', userId: 'user-1', role: 'admin', active: true });

  const token = createSessionToken({
    id: 'user-1',
    businessId: 'biz-1',
    name: 'Session User',
    email: 'admin@example.com',
    role: 'admin',
    businessName: 'OliveOps Demo',
    employeeId: 'emp-1',
  });

  const userKey = mapKey('BUSINESS#biz-1', 'USER#user-1');
  const user = store.get(userKey);
  store.set(userKey, { ...user, role: 'crew_member' });

  const session = await getSessionFromRequest({
    headers: { cookie: `oliveops_session=${token}` },
  });

  assert.equal(session?.role, 'crew_member');
});

test('cookie session rejects inactive user promptly', async (t) => {
  const store = installDdbMock(t);

  seedUser(store, { businessId: 'biz-1', userId: 'user-2', role: 'admin', active: true, email: 'inactive@example.com' });

  const token = createSessionToken({
    id: 'user-2',
    businessId: 'biz-1',
    name: 'Inactive User',
    email: 'inactive@example.com',
    role: 'admin',
    businessName: 'OliveOps Demo',
    employeeId: 'emp-2',
  });

  const userKey = mapKey('BUSINESS#biz-1', 'USER#user-2');
  const user = store.get(userKey);
  store.set(userKey, { ...user, active: false });

  const session = await getSessionFromRequest({
    headers: { cookie: `oliveops_session=${token}` },
  });

  assert.equal(session, null);
});
