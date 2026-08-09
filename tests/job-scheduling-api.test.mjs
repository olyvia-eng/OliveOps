import test from 'node:test';
import assert from 'node:assert/strict';

import dataHandler from '../api/data.js';
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
      return { Item: store.get(mapKey(input.Key.PK, input.Key.SK)) };
    }

    if (commandType === 'DeleteCommand') {
      store.delete(mapKey(input.Key.PK, input.Key.SK));
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

function seedBusinessUser(store, { businessId, userId, role, email }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `USER#${userId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `USER#${userId}`,
      entityType: 'USER',
      businessId,
      userId,
      name: `${role} User`,
      email,
      role,
      active: true,
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

function seedEmployee(store, { businessId, employeeId, name }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `EMPLOYEE#${employeeId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `EMPLOYEE#${employeeId}`,
      entityType: 'EMPLOYEE',
      businessId,
      employeeId,
      id: employeeId,
      name,
      email: `${employeeId}@example.com`,
      phone: '',
      role: 'crew_member',
      hourlyRate: 30,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

async function seedSession(user) {
  await createMobileSessionForUser({
    user: {
      id: user.userId,
      businessId: user.businessId,
      name: `${user.role} User`,
      email: user.email,
      role: user.role,
      businessName: user.businessId,
      employeeId: user.employeeId,
    },
    accessToken: user.token,
    expiresInSeconds: 604800,
  });
}

function buildJobRecord(overrides = {}) {
  return {
    id: 'job-1',
    customerId: 'customer-1',
    title: 'Front Walkway',
    description: 'Install interlock walkway',
    status: 'scheduled',
    startDate: '2026-08-10',
    endDate: '2026-08-14',
    scheduleConfirmed: true,
    scheduledStartAt: '2026-08-10T07:00:00',
    scheduledEndAt: '2026-08-14T16:00:00',
    scheduleAllDay: false,
    scheduleNotes: 'Crew on site by 6:45.',
    estimatedHours: 24,
    actualHours: 0,
    estimatedCost: 1200,
    actualCosts: [],
    contractValue: 2000,
    assignedEmployeeIds: ['emp-a'],
    assignedEquipmentIds: [],
    notes: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test('foreman can create a scheduled job through the generic jobs API', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-foreman', role: 'foreman', email: 'foreman@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Ryan Crew' });
  await seedSession({ businessId: 'biz-a', userId: 'user-foreman', role: 'foreman', email: 'foreman@example.com', employeeId: 'emp-a', token: 'schedule-foreman-token' });

  const req = {
    method: 'POST',
    query: { entity: 'jobs' },
    headers: { authorization: 'Bearer schedule-foreman-token' },
    body: { data: buildJobRecord() },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('crew scheduling changes are rejected', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-crew', role: 'crew_member', email: 'crew@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Ryan Crew' });
  await seedSession({ businessId: 'biz-a', userId: 'user-crew', role: 'crew_member', email: 'crew@example.com', employeeId: 'emp-a', token: 'schedule-crew-token' });

  const req = {
    method: 'POST',
    query: { entity: 'jobs' },
    headers: { authorization: 'Bearer schedule-crew-token' },
    body: { data: buildJobRecord({ id: 'job-crew' }) },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

test('job scheduling rejects assigned employees from another tenant', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin', role: 'admin', email: 'admin@example.com' });
  seedEmployee(store, { businessId: 'biz-b', employeeId: 'emp-foreign', name: 'Foreign Crew' });
  await seedSession({ businessId: 'biz-a', userId: 'user-admin', role: 'admin', email: 'admin@example.com', employeeId: 'emp-a', token: 'schedule-admin-token' });

  const req = {
    method: 'POST',
    query: { entity: 'jobs' },
    headers: { authorization: 'Bearer schedule-admin-token' },
    body: {
      data: buildJobRecord({
        id: 'job-cross-tenant',
        assignedEmployeeIds: ['emp-foreign'],
      }),
    },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Assigned employees must belong to this business.');
});
