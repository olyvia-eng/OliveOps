import test from 'node:test';
import assert from 'node:assert/strict';

import bootstrapHandler from '../api/bootstrap.js';
import dataHandler from '../api/data.js';
import clockingHandler, { canRecordDriveTime } from '../api/clocking.js';
import { ddb } from '../api/_lib/db.js';
import {
  createMobileSessionForUser,
  createEmployeeForBusiness,
  getEmployeeForBusiness,
  listTimeEntriesForBusiness,
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

  const readItem = (key) => store.get(mapKey(key.PK, key.SK));

  const resolveName = (token, names = {}) => {
    if (typeof token === 'string' && token.startsWith('#')) {
      return names[token] ?? token.slice(1);
    }
    return token;
  };

  const resolveValue = (token, values = {}) => {
    if (typeof token === 'string' && token.startsWith(':')) {
      return values[token];
    }
    return token;
  };

  const evaluateCondition = (conditionExpression, existing, names = {}, values = {}) => {
    if (!conditionExpression || !conditionExpression.trim()) return true;

    const clauses = conditionExpression.split(/\s+AND\s+/i).map((clause) => clause.trim());
    for (const clause of clauses) {
      if (clause === 'attribute_not_exists(PK)' || clause === 'attribute_not_exists(SK)') {
        if (existing) return false;
        continue;
      }
      if (clause === 'attribute_exists(PK)' || clause === 'attribute_exists(SK)') {
        if (!existing) return false;
        continue;
      }

      const match = /^(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)/.exec(clause);
      if (match) {
        if (!existing) return false;
        const fieldName = resolveName(match[1], names);
        const expectedValue = resolveValue(match[2], values);
        if (existing[fieldName] !== expectedValue) return false;
        continue;
      }

      throw new Error(`Unsupported condition expression in test mock: ${clause}`);
    }

    return true;
  };

  const applyUpdateExpression = (existing, updateExpression, names = {}, values = {}) => {
    if (!existing) return null;
    const next = { ...existing };
    const normalized = updateExpression.replace(/^SET\s+/i, '').trim();
    const assignments = normalized.split(',').map((part) => part.trim()).filter(Boolean);

    for (const assignment of assignments) {
      const [left, right] = assignment.split('=').map((part) => part.trim());
      const fieldName = resolveName(left, names);
      const value = resolveValue(right, values);
      next[fieldName] = value;
    }

    return next;
  };

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

    if (commandType === 'DeleteCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      store.delete(key);
      return {};
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
      const items = Array.isArray(input.TransactItems) ? input.TransactItems : [];
      const failures = [];

      for (const item of items) {
        if (item.Put) {
          const existing = readItem(item.Put.Item);
          const ok = evaluateCondition(item.Put.ConditionExpression, existing, item.Put.ExpressionAttributeNames, item.Put.ExpressionAttributeValues);
          if (!ok) failures.push({ Code: 'ConditionalCheckFailed' });
          else failures.push({ Code: 'None' });
          continue;
        }

        if (item.Delete) {
          const existing = readItem(item.Delete.Key);
          const ok = evaluateCondition(item.Delete.ConditionExpression, existing, item.Delete.ExpressionAttributeNames, item.Delete.ExpressionAttributeValues);
          if (!ok) failures.push({ Code: 'ConditionalCheckFailed' });
          else failures.push({ Code: 'None' });
          continue;
        }

        if (item.Update) {
          const existing = readItem(item.Update.Key);
          const ok = evaluateCondition(item.Update.ConditionExpression, existing, item.Update.ExpressionAttributeNames, item.Update.ExpressionAttributeValues);
          if (!ok) failures.push({ Code: 'ConditionalCheckFailed' });
          else failures.push({ Code: 'None' });
          continue;
        }

        failures.push({ Code: 'None' });
      }

      if (failures.some((reason) => reason.Code === 'ConditionalCheckFailed')) {
        const error = new Error('Transaction cancelled');
        error.name = 'TransactionCanceledException';
        error.CancellationReasons = failures;
        throw error;
      }

      for (const item of items) {
        if (item.Put) {
          const putItem = { ...item.Put.Item };
          store.set(mapKey(putItem.PK, putItem.SK), putItem);
          continue;
        }

        if (item.Delete) {
          store.delete(mapKey(item.Delete.Key.PK, item.Delete.Key.SK));
          continue;
        }

        if (item.Update) {
          const existing = readItem(item.Update.Key);
          const next = applyUpdateExpression(
            existing,
            item.Update.UpdateExpression,
            item.Update.ExpressionAttributeNames,
            item.Update.ExpressionAttributeValues
          );
          store.set(mapKey(item.Update.Key.PK, item.Update.Key.SK), next);
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

function seedJob(store, { businessId, jobId, title = 'Job', assignedEmployeeIds }) {
  const inferredEmployeeIds = [...store.values()]
    .filter((item) => item.PK === `BUSINESS#${businessId}` && item.entityType === 'EMPLOYEE')
    .map((item) => item.employeeId);
  store.set(
    mapKey(`BUSINESS#${businessId}`, `JOB#${jobId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `JOB#${jobId}`,
      entityType: 'JOB',
      businessId,
      jobId,
      title,
      status: 'scheduled',
      assignedEmployeeIds: assignedEmployeeIds ?? inferredEmployeeIds,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

function seedUnbillableCategory(store, {
  businessId,
  categoryId,
  name = 'General Unbillable',
  active = true,
  sortOrder = 0,
}) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `UNBILLABLE_CATEGORY#${categoryId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `UNBILLABLE_CATEGORY#${categoryId}`,
      entityType: 'UNBILLABLE_TIME_CATEGORY',
      businessId,
      categoryId,
      id: categoryId,
      name,
      description: '',
      sortOrder,
      active,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

function seedActiveShiftForEntry(store, { businessId, employeeId, entryId, clockIn, workType = 'job', jobIds = [] }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `TIME#${entryId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `TIME#${entryId}`,
      entityType: 'TIME_ENTRY',
      businessId,
      entryId,
      employeeId,
      workType,
      jobId: jobIds[0],
      jobIds,
      clockIn,
      breakMinutes: 0,
      notes: '',
      status: 'clocked_in',
      createdAt: clockIn,
      updatedAt: clockIn,
    }
  );

  store.set(
    mapKey(`BUSINESS#${businessId}#EMPLOYEE#${employeeId}`, 'ACTIVE_SHIFT'),
    {
      PK: `BUSINESS#${businessId}#EMPLOYEE#${employeeId}`,
      SK: 'ACTIVE_SHIFT',
      entityType: 'ACTIVE_SHIFT',
      businessId,
      employeeId,
      activeEntryId: entryId,
      status: 'active',
      createdAt: clockIn,
      updatedAt: clockIn,
    }
  );
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
      name: 'Auth User',
      email,
      role,
      active: true,
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

async function createBearerTokenForUser({ businessId, userId, role, email, employeeId, token }) {
  await createMobileSessionForUser({
    user: {
      id: userId,
      businessId,
      name: 'Auth User',
      email,
      role,
      businessName: 'OliveOps Demo',
      employeeId,
    },
    accessToken: token,
    expiresInSeconds: 604800,
  });
}

async function setupSwitchContext({
  t,
  businessId,
  userId,
  employeeId,
  role = 'crew_member',
  email,
  paidDriveTimeEnabled,
  activeEntryId,
  activeWorkType,
  activeJobIds = [],
  activeClockIn = '2026-08-01T08:00:00.000Z',
  token,
}) {
  const store = installDdbMock(t);

  seedBusinessUser(store, {
    businessId,
    userId,
    role,
    email,
  });

  await createEmployeeForBusiness({
    businessId,
    employee: {
      id: employeeId,
      name: 'Switch Employee',
      email,
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled,
    },
  });

  seedActiveShiftForEntry(store, {
    businessId,
    employeeId,
    entryId: activeEntryId,
    clockIn: activeClockIn,
    workType: activeWorkType,
    jobIds: activeJobIds,
  });

  await createBearerTokenForUser({
    businessId,
    userId,
    role,
    email,
    employeeId,
    token,
  });

  return store;
}

test('employee response omits deprecated paidDriveTimeEnabled field', async (t) => {
  installDdbMock(t);

  await createEmployeeForBusiness({
    businessId: 'biz-default',
    employee: {
      id: 'emp-default',
      name: 'Default Employee',
      email: 'default@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 30,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  const employee = await getEmployeeForBusiness('biz-default', 'emp-default');
  assert.equal('paidDriveTimeEnabled' in employee, false);
});

test('employee update ignores deprecated paidDriveTimeEnabled writes', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-eligibility',
    userId: 'user-admin',
    role: 'admin',
    email: 'admin@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-eligibility',
    employee: {
      id: 'emp-1',
      name: 'Eligible Employee',
      email: 'emp1@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 28,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-eligibility',
    userId: 'user-admin',
    role: 'admin',
    email: 'admin@example.com',
    employeeId: 'emp-1',
    token: 'token-admin-toggle',
  });

  const enableReq = {
    method: 'PATCH',
    query: { entity: 'employees', id: 'emp-1' },
    headers: { authorization: 'Bearer token-admin-toggle' },
    body: { data: { paidDriveTimeEnabled: true } },
  };
  const enableRes = createMockRes();

  await dataHandler(enableReq, enableRes);

  assert.equal(enableRes.statusCode, 200);
  const employee = await getEmployeeForBusiness('biz-eligibility', 'emp-1');
  assert.equal('paidDriveTimeEnabled' in employee, false);
});

test('crew member cannot change employee records through employee update endpoint', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-deny',
    userId: 'user-crew',
    role: 'crew_member',
    email: 'crew@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-deny',
    employee: {
      id: 'emp-crew',
      name: 'Crew Employee',
      email: 'crew@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled: false,
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-deny',
    userId: 'user-crew',
    role: 'crew_member',
    email: 'crew@example.com',
    employeeId: 'emp-crew',
    token: 'token-crew-deny',
  });

  const req = {
    method: 'PATCH',
    query: { entity: 'employees', id: 'emp-crew' },
    headers: { authorization: 'Bearer token-crew-deny' },
    body: { data: { hourlyRate: 40 } },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

test('backend allows drive time clock-in regardless of employee flag', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-clock',
    userId: 'user-crew',
    role: 'crew_member',
    email: 'crew@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-clock',
    employee: {
      id: 'emp-clock',
      name: 'Clock Employee',
      email: 'crew@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled: false,
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-clock',
    userId: 'user-crew',
    role: 'crew_member',
    email: 'crew@example.com',
    employeeId: 'emp-clock',
    token: 'token-drive-deny',
  });

  const req = {
    method: 'POST',
    query: { action: 'clock-in' },
    headers: { authorization: 'Bearer token-drive-deny' },
    body: {
      employeeId: 'emp-clock',
      workType: 'drive_time',
      jobIds: [],
      requestId: 'req-1',
      idempotencyKey: 'idemp-1',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.timeEntry?.workType, 'drive_time');
});

test('eligible employee can pass drive time validation for clock-in', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-clock-allow',
    userId: 'user-crew-allow',
    role: 'crew_member',
    email: 'crewallow@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-clock-allow',
    employee: {
      id: 'emp-clock-allow',
      name: 'Clock Employee Allow',
      email: 'crewallow@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled: true,
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-clock-allow',
    userId: 'user-crew-allow',
    role: 'crew_member',
    email: 'crewallow@example.com',
    employeeId: 'emp-clock-allow',
    token: 'token-drive-allow',
  });

  const req = {
    method: 'POST',
    query: { action: 'clock-in' },
    headers: { authorization: 'Bearer token-drive-allow' },
    body: {
      employeeId: 'emp-clock-allow',
      workType: 'drive_time',
      jobIds: [],
      requestId: 'req-allow',
      idempotencyKey: 'idemp-allow',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.timeEntry.workType, 'drive_time');
});

test('clock-in rejects employee spoofing and unauthorized same-business jobs', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-clock-authz', userId: 'user-a', role: 'crew_member', email: 'a@example.com' });
  await createEmployeeForBusiness({
    businessId: 'biz-clock-authz',
    employee: { id: 'emp-a', name: 'Employee A', email: 'a@example.com', phone: '', role: 'crew_member', hourlyRate: 24, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  });
  await createEmployeeForBusiness({
    businessId: 'biz-clock-authz',
    employee: { id: 'emp-b', name: 'Employee B', email: 'b@example.com', phone: '', role: 'crew_member', hourlyRate: 24, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  });
  seedJob(store, { businessId: 'biz-clock-authz', jobId: 'job-b', assignedEmployeeIds: ['emp-b'] });
  await createBearerTokenForUser({ businessId: 'biz-clock-authz', userId: 'user-a', role: 'crew_member', email: 'a@example.com', employeeId: 'emp-a', token: 'token-clock-authz' });

  const call = async (body) => {
    const res = createMockRes();
    await clockingHandler({ method: 'POST', query: { action: 'clock-in' }, headers: { authorization: 'Bearer token-clock-authz' }, body }, res);
    return res;
  };
  const spoofed = await call({ employeeId: 'emp-b', workType: 'job', jobIds: ['job-b'] });
  const unauthorizedJob = await call({ employeeId: 'emp-a', workType: 'job', jobIds: ['job-b'] });

  assert.equal(spoofed.statusCode, 403);
  assert.equal(unauthorizedJob.statusCode, 403);
  assert.equal((await listTimeEntriesForBusiness('biz-clock-authz')).length, 0);
});

test('disabling eligibility does not alter historical drive time records', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-history',
    userId: 'user-admin-history',
    role: 'admin',
    email: 'admin.history@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-history',
    employee: {
      id: 'emp-history',
      name: 'History Employee',
      email: 'history@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled: true,
    },
  });

  store.set(
    mapKey('BUSINESS#biz-history', 'TIME#entry-history-1'),
    {
      PK: 'BUSINESS#biz-history',
      SK: 'TIME#entry-history-1',
      entityType: 'TIME_ENTRY',
      businessId: 'biz-history',
      entryId: 'entry-history-1',
      employeeId: 'emp-history',
      workType: 'drive_time',
      jobIds: [],
      clockIn: '2026-08-01T08:00:00.000Z',
      clockOut: '2026-08-01T09:00:00.000Z',
      breakMinutes: 0,
      notes: 'Historical drive time',
      status: 'clocked_out',
    }
  );

  const before = await listTimeEntriesForBusiness('biz-history');
  assert.equal(before.length, 1);
  assert.equal(before[0].workType, 'drive_time');

  await createBearerTokenForUser({
    businessId: 'biz-history',
    userId: 'user-admin-history',
    role: 'admin',
    email: 'admin.history@example.com',
    employeeId: 'emp-history',
    token: 'token-history-toggle',
  });

  const req = {
    method: 'PATCH',
    query: { entity: 'employees', id: 'emp-history' },
    headers: { authorization: 'Bearer token-history-toggle' },
    body: { data: { paidDriveTimeEnabled: false } },
  };
  const res = createMockRes();

  await dataHandler(req, res);
  assert.equal(res.statusCode, 200);

  const after = await listTimeEntriesForBusiness('biz-history');
  assert.equal(after.length, 1);
  assert.equal(after[0].workType, 'drive_time');
  assert.equal(after[0].status, 'clocked_out');
});

test('active drive time can clock out safely after eligibility is disabled', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-active',
    userId: 'user-active',
    role: 'crew_member',
    email: 'active@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-active',
    employee: {
      id: 'emp-active',
      name: 'Active Employee',
      email: 'active@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled: false,
    },
  });

  store.set(
    mapKey('BUSINESS#biz-active', 'TIME#entry-active-drive'),
    {
      PK: 'BUSINESS#biz-active',
      SK: 'TIME#entry-active-drive',
      entityType: 'TIME_ENTRY',
      businessId: 'biz-active',
      entryId: 'entry-active-drive',
      employeeId: 'emp-active',
      workType: 'drive_time',
      jobIds: [],
      clockIn: '2026-08-01T08:00:00.000Z',
      breakMinutes: 0,
      notes: '',
      status: 'clocked_in',
    }
  );

  store.set(
    mapKey('BUSINESS#biz-active#EMPLOYEE#emp-active', 'ACTIVE_SHIFT'),
    {
      PK: 'BUSINESS#biz-active#EMPLOYEE#emp-active',
      SK: 'ACTIVE_SHIFT',
      entityType: 'ACTIVE_SHIFT',
      businessId: 'biz-active',
      employeeId: 'emp-active',
      activeEntryId: 'entry-active-drive',
      status: 'active',
      startedAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:00:00.000Z',
    }
  );

  await createBearerTokenForUser({
    businessId: 'biz-active',
    userId: 'user-active',
    role: 'crew_member',
    email: 'active@example.com',
    employeeId: 'emp-active',
    token: 'token-active-clockout',
  });

  const req = {
    method: 'POST',
    query: { action: 'clock-out' },
    headers: { authorization: 'Bearer token-active-clockout' },
    body: {
      entryId: 'entry-active-drive',
      breakMinutes: 0,
      notes: 'Completed travel',
      requestId: 'req-clockout-active',
      idempotencyKey: 'idemp-clockout-active',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.timeEntry.workType, 'drive_time');
  assert.equal(res.body.timeEntry.status, 'clocked_out');

  const replayRes = createMockRes();
  await clockingHandler(req, replayRes);

  assert.equal(replayRes.statusCode, 200);
  assert.deepEqual(replayRes.body.timeEntry, res.body.timeEntry);
});

test('clock-out checks entry ownership before idempotency replay', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId: 'biz-clockout-authz', userId: 'user-a', role: 'crew_member', email: 'a@example.com' });
  await createEmployeeForBusiness({ businessId: 'biz-clockout-authz', employee: { id: 'emp-a', name: 'A', email: 'a@example.com', role: 'crew_member', active: true } });
  await createEmployeeForBusiness({ businessId: 'biz-clockout-authz', employee: { id: 'emp-b', name: 'B', email: 'b@example.com', role: 'crew_member', active: true } });
  seedActiveShiftForEntry(store, { businessId: 'biz-clockout-authz', employeeId: 'emp-b', entryId: 'entry-b', clockIn: '2026-08-01T08:00:00.000Z' });
  store.set(mapKey('BUSINESS#biz-clockout-authz', 'IDEMPOTENCY#emp-b:shared-key'), {
    PK: 'BUSINESS#biz-clockout-authz', SK: 'IDEMPOTENCY#emp-b:shared-key', entityType: 'IDEMPOTENCY',
    payloadHash: 'attacker-does-not-need-to-know-this', response: { id: 'entry-b', employeeId: 'emp-b' },
  });
  await createBearerTokenForUser({ businessId: 'biz-clockout-authz', userId: 'user-a', role: 'crew_member', email: 'a@example.com', employeeId: 'emp-a', token: 'token-clockout-authz' });

  const res = createMockRes();
  await clockingHandler({
    method: 'POST', query: { action: 'clock-out' }, headers: { authorization: 'Bearer token-clockout-authz' },
    body: { entryId: 'entry-b', requestId: 'attack', idempotencyKey: 'shared-key' },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Forbidden');
});

test('switch activity supports job work to job work transition across jobs', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-job-job',
    userId: 'user-switch-job-job',
    employeeId: 'emp-switch-job-job',
    email: 'jobjob@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-job-a',
    activeWorkType: 'job',
    activeJobIds: ['job-a'],
    token: 'token-switch-job-job',
  });
  seedJob(store, { businessId: 'biz-switch-job-job', jobId: 'job-a' });
  seedJob(store, { businessId: 'biz-switch-job-job', jobId: 'job-b' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-job-job' },
    body: {
      workType: 'job',
      jobIds: ['job-b'],
      requestId: 'req-switch-job-job',
      idempotencyKey: 'idemp-switch-job-job',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.timeEntry.workType, 'job');
  assert.deepEqual(res.body.timeEntry.jobIds, ['job-b']);

  const oldEntry = store.get(mapKey('BUSINESS#biz-switch-job-job', 'TIME#entry-job-a'));
  const newEntry = store.get(mapKey('BUSINESS#biz-switch-job-job', `TIME#${res.body.timeEntry.id}`));
  const lock = store.get(mapKey('BUSINESS#biz-switch-job-job#EMPLOYEE#emp-switch-job-job', 'ACTIVE_SHIFT'));
  assert.equal(oldEntry.status, 'clocked_out');
  assert.equal(newEntry.status, 'clocked_in');
  assert.equal(oldEntry.clockOut, newEntry.clockIn);
  assert.equal(lock.activeEntryId, newEntry.entryId);
});

test('switch activity allows eligible employee to move from job work to drive time', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-job-drive',
    userId: 'user-switch-job-drive',
    employeeId: 'emp-switch-job-drive',
    email: 'jobdrive@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-job-current',
    activeWorkType: 'job',
    activeJobIds: ['job-current'],
    token: 'token-switch-job-drive',
  });
  seedJob(store, { businessId: 'biz-switch-job-drive', jobId: 'job-current' });
  seedJob(store, { businessId: 'biz-switch-job-drive', jobId: 'job-next' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-job-drive' },
    body: {
      workType: 'drive_time',
      jobIds: ['job-next'],
      requestId: 'req-switch-job-drive',
      idempotencyKey: 'idemp-switch-job-drive',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timeEntry.workType, 'drive_time');
  assert.deepEqual(res.body.timeEntry.jobIds, ['job-next']);
});

test('switch activity allows job work to drive time regardless of employee flag', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-job-drive-deny',
    userId: 'user-switch-job-drive-deny',
    employeeId: 'emp-switch-job-drive-deny',
    email: 'jobdrivedeny@example.com',
    paidDriveTimeEnabled: false,
    activeEntryId: 'entry-job-current',
    activeWorkType: 'job',
    activeJobIds: ['job-current'],
    token: 'token-switch-job-drive-deny',
  });
  seedJob(store, { businessId: 'biz-switch-job-drive-deny', jobId: 'job-current' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-job-drive-deny' },
    body: {
      workType: 'drive_time',
      jobIds: [],
      requestId: 'req-switch-job-drive-deny',
      idempotencyKey: 'idemp-switch-job-drive-deny',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timeEntry.workType, 'drive_time');
});

test('switch activity supports job work to unbillable transition with active category', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-job-unbillable',
    userId: 'user-switch-job-unbillable',
    employeeId: 'emp-switch-job-unbillable',
    email: 'jobunbillable@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-job-unbillable',
    activeWorkType: 'job',
    activeJobIds: ['job-only'],
    token: 'token-switch-job-unbillable',
  });
  seedJob(store, { businessId: 'biz-switch-job-unbillable', jobId: 'job-only' });
  seedUnbillableCategory(store, {
    businessId: 'biz-switch-job-unbillable',
    categoryId: 'cat-training',
    name: 'Training',
  });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-job-unbillable' },
    body: {
      workType: 'non_billable',
      unbillableCategoryId: 'cat-training',
      requestId: 'req-switch-job-unbillable',
      idempotencyKey: 'idemp-switch-job-unbillable',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timeEntry.workType, 'non_billable');
  assert.deepEqual(res.body.timeEntry.jobIds, []);
  assert.equal(res.body.timeEntry.unbillableCategoryId, 'cat-training');
  assert.equal(res.body.timeEntry.unbillableCategoryName, 'Training');
});

test('switch activity rejects non-billable transition when category is missing', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-job-unbillable-missing-category',
    userId: 'user-switch-job-unbillable-missing-category',
    employeeId: 'emp-switch-job-unbillable-missing-category',
    email: 'jobunbillablemissing@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-job-unbillable-missing-category',
    activeWorkType: 'job',
    activeJobIds: ['job-only'],
    token: 'token-switch-job-unbillable-missing-category',
  });
  seedJob(store, { businessId: 'biz-switch-job-unbillable-missing-category', jobId: 'job-only' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-job-unbillable-missing-category' },
    body: {
      workType: 'non_billable',
      requestId: 'req-switch-job-unbillable-missing-category',
      idempotencyKey: 'idemp-switch-job-unbillable-missing-category',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Unbillable category is required.');
});

test('switch activity supports drive time to job work transition', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-drive-job',
    userId: 'user-switch-drive-job',
    employeeId: 'emp-switch-drive-job',
    email: 'drivejob@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-drive-current',
    activeWorkType: 'drive_time',
    activeJobIds: [],
    token: 'token-switch-drive-job',
  });
  seedJob(store, { businessId: 'biz-switch-drive-job', jobId: 'job-final' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-drive-job' },
    body: {
      workType: 'job',
      jobIds: ['job-final'],
      requestId: 'req-switch-drive-job',
      idempotencyKey: 'idemp-switch-drive-job',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timeEntry.workType, 'job');
  assert.deepEqual(res.body.timeEntry.jobIds, ['job-final']);
});

test('switch activity supports unbillable to job work transition', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-unbillable-job',
    userId: 'user-switch-unbillable-job',
    employeeId: 'emp-switch-unbillable-job',
    email: 'unbillablejob@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-unbillable-current',
    activeWorkType: 'non_billable',
    activeJobIds: [],
    token: 'token-switch-unbillable-job',
  });
  seedJob(store, { businessId: 'biz-switch-unbillable-job', jobId: 'job-target' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-unbillable-job' },
    body: {
      workType: 'job',
      jobIds: ['job-target'],
      requestId: 'req-switch-unbillable-job',
      idempotencyKey: 'idemp-switch-unbillable-job',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timeEntry.workType, 'job');
  assert.deepEqual(res.body.timeEntry.jobIds, ['job-target']);
});

test('switching away from active drive time is allowed after eligibility is disabled', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-away-disabled',
    userId: 'user-switch-away-disabled',
    employeeId: 'emp-switch-away-disabled',
    email: 'switchaway@example.com',
    paidDriveTimeEnabled: false,
    activeEntryId: 'entry-drive-disabled',
    activeWorkType: 'drive_time',
    activeJobIds: [],
    token: 'token-switch-away-disabled',
  });
  seedJob(store, { businessId: 'biz-switch-away-disabled', jobId: 'job-next' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-away-disabled' },
    body: {
      workType: 'job',
      jobIds: ['job-next'],
      requestId: 'req-switch-away-disabled',
      idempotencyKey: 'idemp-switch-away-disabled',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timeEntry.workType, 'job');
});

test('switch activity rejects request when no active shift exists', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-switch-no-active',
    userId: 'user-switch-no-active',
    role: 'crew_member',
    email: 'noactive@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-switch-no-active',
    employee: {
      id: 'emp-switch-no-active',
      name: 'No Active Employee',
      email: 'noactive@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled: true,
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-switch-no-active',
    userId: 'user-switch-no-active',
    role: 'crew_member',
    email: 'noactive@example.com',
    employeeId: 'emp-switch-no-active',
    token: 'token-switch-no-active',
  });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-no-active' },
    body: {
      workType: 'non_billable',
      requestId: 'req-switch-no-active',
      idempotencyKey: 'idemp-switch-no-active',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'No active shift found');
});

test('switch activity rejects invalid activity type', async (t) => {
  await setupSwitchContext({
    t,
    businessId: 'biz-switch-invalid',
    userId: 'user-switch-invalid',
    employeeId: 'emp-switch-invalid',
    email: 'invalidswitch@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-switch-invalid',
    activeWorkType: 'job',
    activeJobIds: ['job-x'],
    token: 'token-switch-invalid',
  });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-invalid' },
    body: {
      workType: 'invalid_type',
      requestId: 'req-switch-invalid',
      idempotencyKey: 'idemp-switch-invalid',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid activity type.');
});

test('switch activity rejects job work when no job id is provided', async (t) => {
  await setupSwitchContext({
    t,
    businessId: 'biz-switch-job-required',
    userId: 'user-switch-job-required',
    employeeId: 'emp-switch-job-required',
    email: 'jobrequired@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-switch-job-required',
    activeWorkType: 'non_billable',
    activeJobIds: [],
    token: 'token-switch-job-required',
  });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-job-required' },
    body: {
      workType: 'job',
      jobIds: [],
      requestId: 'req-switch-job-required',
      idempotencyKey: 'idemp-switch-job-required',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'At least one job is required for job work.');
});

test('switch activity rejects cross-business or unknown job ids', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-job-scope',
    userId: 'user-switch-job-scope',
    employeeId: 'emp-switch-job-scope',
    email: 'jobscope@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-switch-job-scope',
    activeWorkType: 'job',
    activeJobIds: ['job-home'],
    token: 'token-switch-job-scope',
  });
  seedJob(store, { businessId: 'other-biz', jobId: 'job-foreign' });
  seedJob(store, { businessId: 'biz-switch-job-scope', jobId: 'job-home' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-job-scope' },
    body: {
      workType: 'job',
      jobIds: ['job-foreign'],
      requestId: 'req-switch-job-scope',
      idempotencyKey: 'idemp-switch-job-scope',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Job is invalid.');
});

test('switch activity is idempotent and returns same safe result for retries', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-idempotent',
    userId: 'user-switch-idempotent',
    employeeId: 'emp-switch-idempotent',
    email: 'idempotent@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-switch-idempotent-old',
    activeWorkType: 'job',
    activeJobIds: ['job-from'],
    token: 'token-switch-idempotent',
  });
  seedJob(store, { businessId: 'biz-switch-idempotent', jobId: 'job-from' });
  seedJob(store, { businessId: 'biz-switch-idempotent', jobId: 'job-to' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-idempotent' },
    body: {
      workType: 'job',
      jobIds: ['job-to'],
      requestId: 'req-switch-idempotent',
      idempotencyKey: 'idemp-switch-idempotent',
    },
  };

  const firstRes = createMockRes();
  await clockingHandler(req, firstRes);
  const secondRes = createMockRes();
  await clockingHandler(req, secondRes);

  assert.equal(firstRes.statusCode, 200);
  assert.equal(secondRes.statusCode, 200);
  assert.equal(firstRes.body.timeEntry.id, secondRes.body.timeEntry.id);

  const entries = await listTimeEntriesForBusiness('biz-switch-idempotent');
  const activeEntries = entries.filter((entry) => entry.employeeId === 'emp-switch-idempotent' && entry.status === 'clocked_in');
  assert.equal(activeEntries.length, 1);
});

test('switch activity transaction failure does not leave half-completed state', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-atomic-failure',
    userId: 'user-switch-atomic-failure',
    employeeId: 'emp-switch-atomic-failure',
    email: 'atomicfailure@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-switch-atomic-old',
    activeWorkType: 'job',
    activeJobIds: ['job-start'],
    token: 'token-switch-atomic-failure',
  });
  seedJob(store, { businessId: 'biz-switch-atomic-failure', jobId: 'job-start' });
  seedJob(store, { businessId: 'biz-switch-atomic-failure', jobId: 'job-next' });

  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    if (command?.constructor?.name === 'TransactWriteCommand') {
      const error = new Error('forced transaction failure');
      error.name = 'TransactionCanceledException';
      error.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
      throw error;
    }
    return originalSend(command);
  };

  t.after(() => {
    ddb.send = originalSend;
  });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-atomic-failure' },
    body: {
      workType: 'job',
      jobIds: ['job-next'],
      requestId: 'req-switch-atomic-failure',
      idempotencyKey: 'idemp-switch-atomic-failure',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'No active shift found');

  const oldEntry = store.get(mapKey('BUSINESS#biz-switch-atomic-failure', 'TIME#entry-switch-atomic-old'));
  const lock = store.get(mapKey('BUSINESS#biz-switch-atomic-failure#EMPLOYEE#emp-switch-atomic-failure', 'ACTIVE_SHIFT'));
  assert.equal(oldEntry.status, 'clocked_in');
  assert.equal(lock.activeEntryId, 'entry-switch-atomic-old');
});

test('switch activity preserves one active entry invariant and exact boundary timestamp equality', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-switch-invariant',
    userId: 'user-switch-invariant',
    employeeId: 'emp-switch-invariant',
    email: 'invariant@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-switch-invariant-old',
    activeWorkType: 'job',
    activeJobIds: ['job-one'],
    token: 'token-switch-invariant',
  });
  seedJob(store, { businessId: 'biz-switch-invariant', jobId: 'job-one' });
  seedJob(store, { businessId: 'biz-switch-invariant', jobId: 'job-two' });

  const req = {
    method: 'POST',
    query: { action: 'switch-activity' },
    headers: { authorization: 'Bearer token-switch-invariant' },
    body: {
      workType: 'job',
      jobIds: ['job-two'],
      requestId: 'req-switch-invariant',
      idempotencyKey: 'idemp-switch-invariant',
    },
  };
  const res = createMockRes();

  await clockingHandler(req, res);
  assert.equal(res.statusCode, 200);

  const oldEntry = store.get(mapKey('BUSINESS#biz-switch-invariant', 'TIME#entry-switch-invariant-old'));
  const newEntry = store.get(mapKey('BUSINESS#biz-switch-invariant', `TIME#${res.body.timeEntry.id}`));
  const lock = store.get(mapKey('BUSINESS#biz-switch-invariant#EMPLOYEE#emp-switch-invariant', 'ACTIVE_SHIFT'));
  const entries = await listTimeEntriesForBusiness('biz-switch-invariant');
  const activeEntries = entries.filter((entry) => entry.employeeId === 'emp-switch-invariant' && entry.status === 'clocked_in');

  assert.equal(oldEntry.clockOut, newEntry.clockIn);
  assert.equal(activeEntries.length, 1);
  assert.equal(lock.activeEntryId, newEntry.entryId);
});

test('bootstrap returns authoritative currentActiveEntryId for session employee', async (t) => {
  const store = await setupSwitchContext({
    t,
    businessId: 'biz-bootstrap-active',
    userId: 'user-bootstrap-active',
    employeeId: 'emp-bootstrap-active',
    email: 'bootstrap-active@example.com',
    paidDriveTimeEnabled: true,
    activeEntryId: 'entry-bootstrap-active',
    activeWorkType: 'job',
    activeJobIds: ['job-bootstrap'],
    token: 'token-bootstrap-active',
  });
  store.set(mapKey('BUSINESS#biz-bootstrap-active', 'PROFILE'), {
    PK: 'BUSINESS#biz-bootstrap-active', SK: 'PROFILE', entityType: 'BUSINESS',
    businessId: 'biz-bootstrap-active', name: 'Bootstrap Business', timezone: 'America/Vancouver',
  });

  const req = {
    method: 'GET',
    headers: { authorization: 'Bearer token-bootstrap-active' },
  };
  const res = createMockRes();

  await bootstrapHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timezone, 'America/Vancouver');
  assert.equal(res.body.currentActiveEntryId, 'entry-bootstrap-active');
});

test('bootstrap returns null currentActiveEntryId when no active shift lock exists', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-bootstrap-none',
    userId: 'user-bootstrap-none',
    role: 'crew_member',
    email: 'bootstrap-none@example.com',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-bootstrap-none',
    employee: {
      id: 'emp-bootstrap-none',
      name: 'Bootstrap None',
      email: 'bootstrap-none@example.com',
      phone: '',
      role: 'crew_member',
      hourlyRate: 24,
      compensationType: 'hourly',
      labourType: 'field_producing',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidDriveTimeEnabled: false,
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-bootstrap-none',
    userId: 'user-bootstrap-none',
    role: 'crew_member',
    email: 'bootstrap-none@example.com',
    employeeId: 'emp-bootstrap-none',
    token: 'token-bootstrap-none',
  });

  const req = {
    method: 'GET',
    headers: { authorization: 'Bearer token-bootstrap-none' },
  };
  const res = createMockRes();

  await bootstrapHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.currentActiveEntryId, null);
});

test('employee bootstrap excludes coworker-private and cross-tenant records', async (t) => {
  const store = await setupSwitchContext({
    t, businessId: 'biz-bootstrap-a', userId: 'user-a', employeeId: 'emp-a', email: 'a@example.com',
    paidDriveTimeEnabled: true, activeEntryId: 'entry-a', activeWorkType: 'job', activeJobIds: ['job-a'], token: 'token-bootstrap-a',
  });
  await createEmployeeForBusiness({ businessId: 'biz-bootstrap-a', employee: { id: 'emp-b', name: 'Employee B', email: 'b@example.com', role: 'crew_member', active: true } });
  seedJob(store, { businessId: 'biz-bootstrap-a', jobId: 'job-a', assignedEmployeeIds: ['emp-a'] });
  seedJob(store, { businessId: 'biz-bootstrap-a', jobId: 'job-b', assignedEmployeeIds: ['emp-b'] });
  seedJob(store, { businessId: 'biz-bootstrap-b', jobId: 'job-foreign', assignedEmployeeIds: ['emp-a'] });
  store.set(mapKey('BUSINESS#biz-bootstrap-a', 'TIME#entry-b'), {
    PK: 'BUSINESS#biz-bootstrap-a', SK: 'TIME#entry-b', entityType: 'TIME_ENTRY', businessId: 'biz-bootstrap-a',
    entryId: 'entry-b', employeeId: 'emp-b', clockIn: '2026-08-01T08:00:00.000Z', status: 'clocked_out',
  });
  store.set(mapKey('BUSINESS#biz-bootstrap-b', 'TIME#entry-foreign'), {
    PK: 'BUSINESS#biz-bootstrap-b', SK: 'TIME#entry-foreign', entityType: 'TIME_ENTRY', businessId: 'biz-bootstrap-b',
    entryId: 'entry-foreign', employeeId: 'emp-a', clockIn: '2026-08-01T08:00:00.000Z', status: 'clocked_out',
  });

  const res = createMockRes();
  await bootstrapHandler({ method: 'GET', headers: { authorization: 'Bearer token-bootstrap-a' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.employees.map((item) => item.id), ['emp-a']);
  assert.deepEqual(res.body.jobs.map((item) => item.id), ['job-a']);
  assert.deepEqual(res.body.timeEntries.map((item) => item.id), ['entry-a']);
  assert.equal(JSON.stringify(res.body).includes('biz-bootstrap-b'), false);
});

test('data endpoint rejects creating active/open time entries outside clocking actions', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-data-post-guard',
    userId: 'user-data-post-guard',
    role: 'admin',
    email: 'datapost@example.com',
  });

  await createBearerTokenForUser({
    businessId: 'biz-data-post-guard',
    userId: 'user-data-post-guard',
    role: 'admin',
    email: 'datapost@example.com',
    employeeId: 'emp-data-post-guard',
    token: 'token-data-post-guard',
  });

  const req = {
    method: 'POST',
    query: { entity: 'time-entries' },
    headers: { authorization: 'Bearer token-data-post-guard' },
    body: {
      data: {
        id: 'entry-post-guard',
        employeeId: 'emp-data-post-guard',
        status: 'clocked_in',
        clockIn: '2026-08-07T09:00:00.000Z',
        workType: 'job',
        jobIds: [],
      },
    },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'Use clocking actions for active shift changes.');
});

test('data endpoint rejects opening/activating entries via patch outside clocking actions', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-data-patch-guard',
    userId: 'user-data-patch-guard',
    role: 'admin',
    email: 'datapatch@example.com',
  });

  await createBearerTokenForUser({
    businessId: 'biz-data-patch-guard',
    userId: 'user-data-patch-guard',
    role: 'admin',
    email: 'datapatch@example.com',
    employeeId: 'emp-data-patch-guard',
    token: 'token-data-patch-guard',
  });

  store.set(
    mapKey('BUSINESS#biz-data-patch-guard', 'TIME#entry-active-existing'),
    {
      PK: 'BUSINESS#biz-data-patch-guard',
      SK: 'TIME#entry-active-existing',
      entityType: 'TIME_ENTRY',
      businessId: 'biz-data-patch-guard',
      entryId: 'entry-active-existing',
      employeeId: 'emp-data-patch-guard',
      workType: 'job',
      jobIds: [],
      clockIn: '2026-08-07T09:00:00.000Z',
      status: 'clocked_in',
    }
  );

  const activePatchReq = {
    method: 'PATCH',
    query: { entity: 'time-entries', id: 'entry-active-existing' },
    headers: { authorization: 'Bearer token-data-patch-guard' },
    body: { data: { notes: 'Should be blocked' } },
  };
  const activePatchRes = createMockRes();

  await dataHandler(activePatchReq, activePatchRes);

  assert.equal(activePatchRes.statusCode, 409);
  assert.equal(activePatchRes.body.error, 'Use clocking actions for active shift changes.');

  store.set(
    mapKey('BUSINESS#biz-data-patch-guard', 'TIME#entry-closed-existing'),
    {
      PK: 'BUSINESS#biz-data-patch-guard',
      SK: 'TIME#entry-closed-existing',
      entityType: 'TIME_ENTRY',
      businessId: 'biz-data-patch-guard',
      entryId: 'entry-closed-existing',
      employeeId: 'emp-data-patch-guard',
      workType: 'job',
      jobIds: [],
      clockIn: '2026-08-07T08:00:00.000Z',
      clockOut: '2026-08-07T09:00:00.000Z',
      status: 'clocked_out',
    }
  );

  const reopenReq = {
    method: 'PATCH',
    query: { entity: 'time-entries', id: 'entry-closed-existing' },
    headers: { authorization: 'Bearer token-data-patch-guard' },
    body: { data: { status: 'clocked_in', clockOut: '' } },
  };
  const reopenRes = createMockRes();

  await dataHandler(reopenReq, reopenRes);

  assert.equal(reopenRes.statusCode, 409);
  assert.equal(reopenRes.body.error, 'Use clocking actions for active shift changes.');
});

test('drive-time helper allows all work types', () => {
  assert.equal(canRecordDriveTime('job', { paidDriveTimeEnabled: false }), true);
  assert.equal(canRecordDriveTime('non_billable', { paidDriveTimeEnabled: false }), true);
  assert.equal(canRecordDriveTime('drive_time', { paidDriveTimeEnabled: false }), true);
  assert.equal(canRecordDriveTime('drive_time', { paidDriveTimeEnabled: true }), true);
});

async function setupOfflineClockingContext(t, suffix) {
  const businessId = `biz-offline-${suffix}`;
  const userId = `user-offline-${suffix}`;
  const employeeId = `emp-offline-${suffix}`;
  const token = `token-offline-${suffix}`;
  const email = `${suffix}@example.com`;
  const store = installDdbMock(t);
  seedBusinessUser(store, { businessId, userId, role: 'crew_member', email });
  await createEmployeeForBusiness({
    businessId,
    employee: { id: employeeId, name: 'Offline Employee', email, role: 'crew_member', active: true },
  });
  await createBearerTokenForUser({ businessId, userId, role: 'crew_member', email, employeeId, token });
  seedJob(store, { businessId, jobId: 'job-a', assignedEmployeeIds: [employeeId] });
  seedJob(store, { businessId, jobId: 'job-b', assignedEmployeeIds: [employeeId] });
  seedJob(store, { businessId, jobId: 'job-hidden', assignedEmployeeIds: ['someone-else'] });
  seedUnbillableCategory(store, { businessId, categoryId: 'cat-training', name: 'Training' });
  return { store, businessId, employeeId, token };
}

async function callClocking(token, action, body) {
  const res = createMockRes();
  await clockingHandler({ method: 'POST', query: { action }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

const isoOffset = (baseMs, offsetMs) => new Date(baseMs + offsetMs).toISOString();

test('complete delayed sequence preserves event boundaries and separate server receipt metadata', async (t) => {
  const { store, businessId, employeeId, token } = await setupOfflineClockingContext(t, 'sequence');
  const receiptMs = Date.now();
  const startMs = receiptMs - 11 * 60 * 60 * 1000;
  const events = {
    clockIn: isoOffset(startMs, 2 * 60 * 1000),
    jobB: isoOffset(startMs, 2 * 60 * 60 * 1000 + 15 * 60 * 1000),
    drive: isoOffset(startMs, 5 * 60 * 60 * 1000 + 3 * 60 * 1000),
    returnJobB: isoOffset(startMs, 6 * 60 * 60 * 1000),
    clockOut: isoOffset(startMs, 9 * 60 * 60 * 1000 + 32 * 60 * 1000),
  };

  const clockIn = await callClocking(token, 'clock-in', { employeeId, workType: 'job', jobIds: ['job-a'], requestId: 'offline-in', idempotencyKey: 'offline-in', clientOccurredAt: events.clockIn });
  const switchJob = await callClocking(token, 'switch-activity', { workType: 'job', jobIds: ['job-b'], requestId: 'offline-job-b', idempotencyKey: 'offline-job-b', clientOccurredAt: events.jobB });
  const drive = await callClocking(token, 'switch-activity', { workType: 'drive_time', jobIds: ['job-b'], requestId: 'offline-drive', idempotencyKey: 'offline-drive', clientOccurredAt: events.drive });
  const returnJob = await callClocking(token, 'switch-activity', { workType: 'job', jobIds: ['job-b'], requestId: 'offline-return', idempotencyKey: 'offline-return', clientOccurredAt: events.returnJobB });
  const clockOut = await callClocking(token, 'clock-out', { entryId: returnJob.body.timeEntry.id, requestId: 'offline-out', idempotencyKey: 'offline-out', clientOccurredAt: events.clockOut });

  assert.deepEqual([clockIn.statusCode, switchJob.statusCode, drive.statusCode, returnJob.statusCode, clockOut.statusCode], [200, 200, 200, 200, 200]);
  const entries = (await listTimeEntriesForBusiness(businessId)).sort((left, right) => Date.parse(left.clockIn) - Date.parse(right.clockIn));
  assert.deepEqual(entries.map((entry) => [entry.clockIn, entry.clockOut, entry.workType]), [
    [events.clockIn, events.jobB, 'job'],
    [events.jobB, events.drive, 'job'],
    [events.drive, events.returnJobB, 'drive_time'],
    [events.returnJobB, events.clockOut, 'job'],
  ]);
  assert.equal(entries.reduce((sum, entry) => sum + Date.parse(entry.clockOut) - Date.parse(entry.clockIn), 0), Date.parse(events.clockOut) - Date.parse(events.clockIn));
  for (const entry of entries) {
    assert.equal(entry.clockInTimestampSource, 'client');
    assert.ok(Date.parse(entry.clockInServerReceivedAt) > Date.parse(entry.clockIn));
  }
  const finalRaw = store.get(mapKey(`BUSINESS#${businessId}`, `TIME#${clockOut.body.timeEntry.id}`));
  assert.equal(finalRaw.clockOut, events.clockOut);
  assert.equal(finalRaw.clockOutTimestampSource, 'client');
  assert.ok(Date.parse(finalRaw.clockOutServerReceivedAt) > Date.parse(events.clockOut));
  store.set(mapKey(`BUSINESS#${businessId}`, 'PROFILE'), {
    PK: `BUSINESS#${businessId}`, SK: 'PROFILE', entityType: 'BUSINESS', businessId, name: 'Offline Business', timezone: 'America/Toronto',
  });
  const bootstrap = createMockRes();
  await bootstrapHandler({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, bootstrap);
  assert.equal(bootstrap.statusCode, 200);
  assert.deepEqual(bootstrap.body.timeEntries.map((entry) => [entry.clockIn, entry.clockOut]), entries.map((entry) => [entry.clockIn, entry.clockOut]));
});

test('legacy clock-in without clientOccurredAt keeps server-time behavior', async (t) => {
  const { store, businessId, employeeId, token } = await setupOfflineClockingContext(t, 'legacy-online');
  const before = Date.now();
  const result = await callClocking(token, 'clock-in', { employeeId, workType: 'job', jobIds: ['job-a'], requestId: 'legacy-online', idempotencyKey: 'legacy-online' });
  const after = Date.now();
  assert.equal(result.statusCode, 200);
  assert.ok(Date.parse(result.body.timeEntry.clockIn) >= before && Date.parse(result.body.timeEntry.clockIn) <= after);
  const raw = store.get(mapKey(`BUSINESS#${businessId}`, `TIME#${result.body.timeEntry.id}`));
  assert.equal(raw.clockInTimestampSource, 'server');
  assert.equal(raw.clockIn, raw.clockInServerReceivedAt);
});

test('clock-in accepts four minutes of future device skew', async (t) => {
  const { employeeId, token } = await setupOfflineClockingContext(t, 'future-four');
  const result = await callClocking(token, 'clock-in', {
    employeeId,
    workType: 'job',
    jobIds: ['job-a'],
    requestId: 'future-four',
    idempotencyKey: 'future-four',
    clientOccurredAt: isoOffset(Date.now(), 4 * 60 * 1000),
  });
  assert.equal(result.statusCode, 200);
});

test('delayed clocking retries replay and changed event timestamps conflict', async (t) => {
  const { employeeId, token } = await setupOfflineClockingContext(t, 'idempotency');
  const now = Date.now();
  const clockInAt = isoOffset(now, -3 * 60 * 60 * 1000);
  const switchAt = isoOffset(now, -2 * 60 * 60 * 1000);
  const clockOutAt = isoOffset(now, -60 * 60 * 1000);
  const clockInBody = { employeeId, workType: 'job', jobIds: ['job-a'], requestId: 'idem-in', idempotencyKey: 'idem-in', clientOccurredAt: clockInAt };
  const firstIn = await callClocking(token, 'clock-in', clockInBody);
  const replayIn = await callClocking(token, 'clock-in', clockInBody);
  const changedIn = await callClocking(token, 'clock-in', { ...clockInBody, clientOccurredAt: isoOffset(now, -3 * 60 * 60 * 1000 + 1000) });
  assert.equal(replayIn.body.timeEntry.id, firstIn.body.timeEntry.id);
  assert.equal(changedIn.body.code, 'clock_idempotency_conflict');

  const switchBody = { workType: 'job', jobIds: ['job-b'], requestId: 'idem-switch', idempotencyKey: 'idem-switch', clientOccurredAt: switchAt };
  const firstSwitch = await callClocking(token, 'switch-activity', switchBody);
  const replaySwitch = await callClocking(token, 'switch-activity', switchBody);
  const changedSwitch = await callClocking(token, 'switch-activity', { ...switchBody, clientOccurredAt: isoOffset(now, -2 * 60 * 60 * 1000 + 1000) });
  assert.equal(replaySwitch.body.timeEntry.id, firstSwitch.body.timeEntry.id);
  assert.equal(changedSwitch.body.code, 'clock_idempotency_conflict');

  const clockOutBody = { entryId: firstSwitch.body.timeEntry.id, requestId: 'idem-out', idempotencyKey: 'idem-out', clientOccurredAt: clockOutAt };
  const firstOut = await callClocking(token, 'clock-out', clockOutBody);
  const replayOut = await callClocking(token, 'clock-out', clockOutBody);
  const changedOut = await callClocking(token, 'clock-out', { ...clockOutBody, clientOccurredAt: isoOffset(now, -60 * 60 * 1000 + 1000) });
  assert.equal(replayOut.body.timeEntry.clockOut, firstOut.body.timeEntry.clockOut);
  assert.equal(changedOut.body.code, 'clock_idempotency_conflict');
});

test('offline timestamp bounds and absolute format fail with stable codes', async (t) => {
  const { businessId, employeeId, token } = await setupOfflineClockingContext(t, 'bounds');
  const now = Date.now();
  const base = { employeeId, workType: 'job', jobIds: ['job-a'] };
  const malformed = await callClocking(token, 'clock-in', { ...base, requestId: 'bad', idempotencyKey: 'bad', clientOccurredAt: '2026-08-20T07:00:00' });
  const future = await callClocking(token, 'clock-in', { ...base, requestId: 'future', idempotencyKey: 'future', clientOccurredAt: isoOffset(now, 6 * 60 * 1000) });
  const old = await callClocking(token, 'clock-in', { ...base, requestId: 'old', idempotencyKey: 'old', clientOccurredAt: isoOffset(now, -25 * 60 * 60 * 1000) });
  assert.deepEqual([[malformed.statusCode, malformed.body.code], [future.statusCode, future.body.code], [old.statusCode, old.body.code]], [
    [400, 'offline_event_invalid_timestamp'],
    [409, 'offline_event_in_future'],
    [409, 'offline_event_too_old'],
  ]);
  assert.equal((await listTimeEntriesForBusiness(businessId)).length, 0);
});

test('delayed switches and clock-out reject non-sequential event ordering', async (t) => {
  const { employeeId, token } = await setupOfflineClockingContext(t, 'ordering');
  const now = Date.now();
  const clockInAt = isoOffset(now, -3 * 60 * 60 * 1000);
  const clockIn = await callClocking(token, 'clock-in', { employeeId, workType: 'job', jobIds: ['job-a'], requestId: 'order-in', idempotencyKey: 'order-in', clientOccurredAt: clockInAt });
  assert.equal(clockIn.statusCode, 200);
  const earlySwitch = await callClocking(token, 'switch-activity', { workType: 'job', jobIds: ['job-b'], requestId: 'early-switch', idempotencyKey: 'early-switch', clientOccurredAt: isoOffset(now, -4 * 60 * 60 * 1000) });
  assert.equal(earlySwitch.body.code, 'offline_event_order_conflict');
  const validSwitch = await callClocking(token, 'switch-activity', { workType: 'job', jobIds: ['job-b'], requestId: 'valid-switch', idempotencyKey: 'valid-switch', clientOccurredAt: isoOffset(now, -2 * 60 * 60 * 1000) });
  assert.equal(validSwitch.statusCode, 200);
  const earlyOut = await callClocking(token, 'clock-out', { entryId: validSwitch.body.timeEntry.id, requestId: 'early-out', idempotencyKey: 'early-out', clientOccurredAt: isoOffset(now, -2 * 60 * 60 * 1000 - 1) });
  assert.equal(earlyOut.body.code, 'offline_event_order_conflict');
});

test('clock-out enforces the same past and future bounds as other mutations', async (t) => {
  const { store, businessId, employeeId, token } = await setupOfflineClockingContext(t, 'out-bounds');
  const now = Date.now();
  seedActiveShiftForEntry(store, { businessId, employeeId, entryId: 'out-bounds-entry', clockIn: isoOffset(now, -2 * 60 * 60 * 1000), workType: 'job', jobIds: ['job-a'] });
  const tooOld = await callClocking(token, 'clock-out', { entryId: 'out-bounds-entry', requestId: 'out-old', idempotencyKey: 'out-old', clientOccurredAt: isoOffset(now, -25 * 60 * 60 * 1000) });
  const future = await callClocking(token, 'clock-out', { entryId: 'out-bounds-entry', requestId: 'out-future', idempotencyKey: 'out-future', clientOccurredAt: isoOffset(now, 6 * 60 * 1000) });
  assert.deepEqual([[tooOld.statusCode, tooOld.body.code], [future.statusCode, future.body.code]], [
    [409, 'offline_event_too_old'],
    [409, 'offline_event_in_future'],
  ]);
});

test('mixed online and delayed clocking retains server and client timestamp sources', async (t) => {
  const { store, businessId, employeeId, token } = await setupOfflineClockingContext(t, 'mixed');
  const now = Date.now();
  const onlineStart = isoOffset(now, -3 * 60 * 60 * 1000);
  seedActiveShiftForEntry(store, { businessId, employeeId, entryId: 'mixed-online-entry', clockIn: onlineStart, workType: 'job', jobIds: ['job-a'] });
  const rawOnline = store.get(mapKey(`BUSINESS#${businessId}`, 'TIME#mixed-online-entry'));
  rawOnline.clockInServerReceivedAt = onlineStart;
  rawOnline.clockInTimestampSource = 'server';
  const delayedSwitchAt = isoOffset(now, -2 * 60 * 60 * 1000);
  const delayedOutAt = isoOffset(now, -60 * 60 * 1000);
  const switched = await callClocking(token, 'switch-activity', { workType: 'job', jobIds: ['job-b'], requestId: 'mixed-switch', idempotencyKey: 'mixed-switch', clientOccurredAt: delayedSwitchAt });
  const clockedOut = await callClocking(token, 'clock-out', { entryId: switched.body.timeEntry.id, requestId: 'mixed-out', idempotencyKey: 'mixed-out', clientOccurredAt: delayedOutAt });
  assert.equal(clockedOut.statusCode, 200);
  const entries = (await listTimeEntriesForBusiness(businessId)).sort((left, right) => Date.parse(left.clockIn) - Date.parse(right.clockIn));
  assert.deepEqual(entries.map((entry) => [entry.clockIn, entry.clockOut]), [[onlineStart, delayedSwitchAt], [delayedSwitchAt, delayedOutAt]]);
  assert.deepEqual(entries.map((entry) => entry.clockInTimestampSource), ['server', 'client']);
});

test('delayed clock-in may sync before a later delayed clock-out', async (t) => {
  const { businessId, employeeId, token } = await setupOfflineClockingContext(t, 'mixed-delayed-in');
  const now = Date.now();
  const clockInAt = isoOffset(now, -3 * 60 * 60 * 1000);
  const clockOutAt = isoOffset(now, -60 * 60 * 1000);
  const clockIn = await callClocking(token, 'clock-in', { employeeId, workType: 'job', jobIds: ['job-a'], requestId: 'mixed-delayed-in', idempotencyKey: 'mixed-delayed-in', clientOccurredAt: clockInAt });
  const clockOut = await callClocking(token, 'clock-out', { entryId: clockIn.body.timeEntry.id, requestId: 'mixed-delayed-out', idempotencyKey: 'mixed-delayed-out', clientOccurredAt: clockOutAt });
  assert.equal(clockOut.statusCode, 200);
  const [entry] = await listTimeEntriesForBusiness(businessId);
  assert.equal(entry.clockIn, clockInAt);
  assert.equal(entry.clockOut, clockOutAt);
});

test('delayed clock-in still rejects hidden jobs with the mobile conflict code', async (t) => {
  const { employeeId, token } = await setupOfflineClockingContext(t, 'hidden-job');
  const res = await callClocking(token, 'clock-in', {
    employeeId,
    workType: 'job',
    jobIds: ['job-hidden'],
    requestId: 'hidden-job',
    idempotencyKey: 'hidden-job',
    clientOccurredAt: isoOffset(Date.now(), -60 * 60 * 1000),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'offline_job_unauthorized');
});

test('competing delayed clock-ins commit only one active timeline', async (t) => {
  const { businessId, employeeId, token } = await setupOfflineClockingContext(t, 'concurrency');
  const clientOccurredAt = isoOffset(Date.now(), -60 * 60 * 1000);
  const [first, second] = await Promise.all([
    callClocking(token, 'clock-in', { employeeId, workType: 'job', jobIds: ['job-a'], requestId: 'race-a', idempotencyKey: 'race-a', clientOccurredAt }),
    callClocking(token, 'clock-in', { employeeId, workType: 'job', jobIds: ['job-b'], requestId: 'race-b', idempotencyKey: 'race-b', clientOccurredAt }),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const entries = await listTimeEntriesForBusiness(businessId);
  assert.equal(entries.filter((entry) => entry.status === 'clocked_in').length, 1);
});
