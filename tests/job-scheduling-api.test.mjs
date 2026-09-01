import test from 'node:test';
import assert from 'node:assert/strict';

import dataHandler from '../api/data.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser, getJobForBusiness } from '../api/_lib/authRepo.js';

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

function seedEmployee(store, { businessId, employeeId, name, active = true }) {
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
      active,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

function seedDefaultCustomer(store, businessId = 'biz-a') {
  store.set(mapKey(`BUSINESS#${businessId}`, 'CUSTOMER#customer-1'), {
    PK: `BUSINESS#${businessId}`,
    SK: 'CUSTOMER#customer-1',
    entityType: 'CUSTOMER',
    businessId,
    customerId: 'customer-1',
    id: 'customer-1',
    name: 'Test Customer',
  });
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
  seedDefaultCustomer(store);
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

test('multiple schedule occurrences persist without replacing the legacy Job schedule', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin-occurrences', role: 'admin', email: 'occurrences@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Ryan Crew' });
  await seedSession({ businessId: 'biz-a', userId: 'user-admin-occurrences', role: 'admin', email: 'occurrences@example.com', token: 'schedule-occurrences-token' });
  const scheduleOccurrences = [
    { id: 'day-one', scheduleAllDay: false, scheduledStartAt: '2026-08-10T07:00:00', scheduledEndAt: '2026-08-10T15:00:00', assignedEmployeeIds: ['emp-a'] },
    { id: 'day-two', scheduleAllDay: false, scheduledStartAt: '2026-08-12T08:00:00', scheduledEndAt: '2026-08-12T12:00:00', assignedEmployeeIds: ['emp-a'] },
  ];
  const res = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-occurrences-token' },
    body: { data: buildJobRecord({ id: 'job-occurrences', scheduleOccurrences }) },
  }, res);

  assert.equal(res.statusCode, 200);
  const saved = await getJobForBusiness('biz-a', 'job-occurrences');
  assert.deepEqual(saved.scheduleOccurrences, scheduleOccurrences);
  assert.equal(saved.scheduledStartAt, '2026-08-10T07:00:00');
});

test('converted Job accepts employee assignment when protected schedule context is unchanged', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin-converted', role: 'admin', email: 'converted@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Ryan Crew' });
  store.set(mapKey('BUSINESS#biz-a', 'DIVISION#division-a'), {
    PK: 'BUSINESS#biz-a', SK: 'DIVISION#division-a', entityType: 'DIVISION', businessId: 'biz-a', divisionId: 'division-a', name: 'Operations', normalizedName: 'operations', colour: '#15803d', active: true,
  });
  await seedSession({ businessId: 'biz-a', userId: 'user-admin-converted', role: 'admin', email: 'converted@example.com', token: 'schedule-converted-token' });

  const createRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-converted-token' },
    body: { data: buildJobRecord({ id: 'job-converted', sourceEstimateId: 'estimate-a', divisionId: 'division-a', assignedEmployeeIds: [] }) },
  }, createRes);
  assert.equal(createRes.statusCode, 200);

  const patchRes = createMockRes();
  await dataHandler({
    method: 'PATCH', query: { entity: 'jobs', id: 'job-converted' }, headers: { authorization: 'Bearer schedule-converted-token' },
    body: { data: { assignedEmployeeIds: ['emp-a'], divisionId: 'division-a', scheduleNotes: 'Crew assigned.' } },
  }, patchRes);

  assert.equal(patchRes.statusCode, 200);
  const persisted = await getJobForBusiness('biz-a', 'job-converted');
  assert.deepEqual(persisted.assignedEmployeeIds, ['emp-a']);
  assert.equal(persisted.divisionId, 'division-a');
  assert.equal(persisted.startDate, '2026-08-10');
  assert.equal(persisted.scheduledStartAt, '2026-08-10T07:00:00');
  assert.equal(persisted.title, 'Front Walkway');
});

test('employee assignments add multiple, remove one, and persist without duplicating IDs', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin-employees', role: 'admin', email: 'employees@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Employee A' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-b', name: 'Employee B' });
  await seedSession({ businessId: 'biz-a', userId: 'user-admin-employees', role: 'admin', email: 'employees@example.com', token: 'schedule-employees-token' });

  const createRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-employees-token' },
    body: { data: buildJobRecord({ id: 'job-employees', assignedEmployeeIds: [] }) },
  }, createRes);
  assert.equal(createRes.statusCode, 200);

  const assignRes = createMockRes();
  await dataHandler({
    method: 'PATCH', query: { entity: 'jobs', id: 'job-employees' }, headers: { authorization: 'Bearer schedule-employees-token' },
    body: { data: { assignedEmployeeIds: ['emp-a', 'emp-b'] } },
  }, assignRes);
  assert.equal(assignRes.statusCode, 200);
  assert.deepEqual(assignRes.body.job.assignedEmployeeIds, ['emp-a', 'emp-b']);
  assert.deepEqual((await getJobForBusiness('biz-a', 'job-employees')).assignedEmployeeIds, ['emp-a', 'emp-b']);

  const removeRes = createMockRes();
  await dataHandler({
    method: 'PATCH', query: { entity: 'jobs', id: 'job-employees' }, headers: { authorization: 'Bearer schedule-employees-token' },
    body: { data: { assignedEmployeeIds: ['emp-b'] } },
  }, removeRes);
  assert.equal(removeRes.statusCode, 200);
  assert.deepEqual(removeRes.body.job.assignedEmployeeIds, ['emp-b']);
  assert.deepEqual((await getJobForBusiness('biz-a', 'job-employees')).assignedEmployeeIds, ['emp-b']);

  const duplicateRes = createMockRes();
  await dataHandler({
    method: 'PATCH', query: { entity: 'jobs', id: 'job-employees' }, headers: { authorization: 'Bearer schedule-employees-token' },
    body: { data: { assignedEmployeeIds: ['emp-b', 'emp-b'] } },
  }, duplicateRes);
  assert.equal(duplicateRes.statusCode, 400);
  assert.equal(duplicateRes.body.error, 'Assigned employees must be unique.');
  assert.deepEqual((await getJobForBusiness('biz-a', 'job-employees')).assignedEmployeeIds, ['emp-b']);
});

test('primary crew can change and clear while schedule fields remain intact', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin-crews', role: 'admin', email: 'crews@example.com' });
  for (const crewId of ['crew-a', 'crew-b']) {
    store.set(mapKey('BUSINESS#biz-a', `CREW#${crewId}`), {
      PK: 'BUSINESS#biz-a', SK: `CREW#${crewId}`, entityType: 'CREW', businessId: 'biz-a', crewId, name: crewId, colour: '#0f766e', active: true, memberIds: [],
    });
  }
  await seedSession({ businessId: 'biz-a', userId: 'user-admin-crews', role: 'admin', email: 'crews@example.com', token: 'schedule-crews-token' });
  const createRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-crews-token' },
    body: { data: buildJobRecord({ id: 'job-crews', crewId: 'crew-a', assignedEmployeeIds: [] }) },
  }, createRes);
  assert.equal(createRes.statusCode, 200);

  for (const crewId of ['crew-b', null]) {
    const patchRes = createMockRes();
    await dataHandler({
      method: 'PATCH', query: { entity: 'jobs', id: 'job-crews' }, headers: { authorization: 'Bearer schedule-crews-token' },
      body: { data: { crewId } },
    }, patchRes);
    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.body.job.crewId, crewId);
    assert.equal(patchRes.body.job.scheduledStartAt, '2026-08-10T07:00:00');
    assert.equal(patchRes.body.job.scheduledEndAt, '2026-08-14T16:00:00');
  }
  assert.equal((await getJobForBusiness('biz-a', 'job-crews')).crewId, null);
});

test('inactive employees and crews cannot be newly assigned', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin-inactive', role: 'admin', email: 'inactive@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-inactive', name: 'Inactive Employee', active: false });
  store.set(mapKey('BUSINESS#biz-a', 'CREW#crew-inactive'), {
    PK: 'BUSINESS#biz-a', SK: 'CREW#crew-inactive', entityType: 'CREW', businessId: 'biz-a', crewId: 'crew-inactive', name: 'Inactive Crew', colour: '#0f766e', active: false, memberIds: [],
  });
  await seedSession({ businessId: 'biz-a', userId: 'user-admin-inactive', role: 'admin', email: 'inactive@example.com', token: 'schedule-inactive-token' });

  const employeeRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-inactive-token' },
    body: { data: buildJobRecord({ id: 'job-inactive-employee', assignedEmployeeIds: ['emp-inactive'] }) },
  }, employeeRes);
  assert.equal(employeeRes.statusCode, 400);
  assert.equal(employeeRes.body.error, 'Assigned employees must be active.');

  const crewRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-inactive-token' },
    body: { data: buildJobRecord({ id: 'job-inactive-crew', assignedEmployeeIds: [], crewId: 'crew-inactive' }) },
  }, crewRes);
  assert.equal(crewRes.statusCode, 400);
  assert.equal(crewRes.body.error, 'Assigned crew must be active.');
});

test('failed cross-tenant assignment leaves the persisted Job unchanged', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin-failed', role: 'admin', email: 'failed@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Local Employee' });
  seedEmployee(store, { businessId: 'biz-b', employeeId: 'emp-foreign', name: 'Foreign Employee' });
  await seedSession({ businessId: 'biz-a', userId: 'user-admin-failed', role: 'admin', email: 'failed@example.com', token: 'schedule-failed-token' });
  const createRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-failed-token' },
    body: { data: buildJobRecord({ id: 'job-failed', assignedEmployeeIds: ['emp-a'] }) },
  }, createRes);

  const patchRes = createMockRes();
  await dataHandler({
    method: 'PATCH', query: { entity: 'jobs', id: 'job-failed' }, headers: { authorization: 'Bearer schedule-failed-token' },
    body: { data: { assignedEmployeeIds: ['emp-a', 'emp-foreign'] } },
  }, patchRes);
  assert.equal(patchRes.statusCode, 400);
  assert.equal(patchRes.body.error, 'Assigned employees must belong to this business.');
  assert.deepEqual((await getJobForBusiness('biz-a', 'job-failed')).assignedEmployeeIds, ['emp-a']);
});

test('crew scheduling changes are rejected', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
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
  seedDefaultCustomer(store);
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

test('job scheduling rejects occurrence employees from another tenant', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-occurrence-admin', role: 'admin', email: 'occurrence-admin@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Local Crew' });
  seedEmployee(store, { businessId: 'biz-b', employeeId: 'emp-foreign', name: 'Foreign Crew' });
  await seedSession({ businessId: 'biz-a', userId: 'user-occurrence-admin', role: 'admin', email: 'occurrence-admin@example.com', token: 'occurrence-admin-token' });
  const res = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer occurrence-admin-token' },
    body: { data: buildJobRecord({
      id: 'job-foreign-occurrence',
      scheduleOccurrences: [{ id: 'foreign-day', scheduleAllDay: false, scheduledStartAt: '2026-08-10T07:00:00', scheduledEndAt: '2026-08-10T15:00:00', assignedEmployeeIds: ['emp-foreign'] }],
    }) },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Assigned employees must belong to this business.');
});

test('job scheduling rejects crew and division references from another tenant', async (t) => {
  const store = installDdbMock(t);
  seedDefaultCustomer(store);
  seedBusinessUser(store, { businessId: 'biz-a', userId: 'user-admin-config', role: 'admin', email: 'admin-config@example.com' });
  seedEmployee(store, { businessId: 'biz-a', employeeId: 'emp-a', name: 'Local Employee' });
  store.set(mapKey('BUSINESS#biz-b', 'CREW#crew-foreign'), {
    PK: 'BUSINESS#biz-b', SK: 'CREW#crew-foreign', businessId: 'biz-b', crewId: 'crew-foreign', name: 'Foreign Crew', colour: '#0f766e', active: true, memberIds: [],
  });
  store.set(mapKey('BUSINESS#biz-b', 'DIVISION#division-foreign'), {
    PK: 'BUSINESS#biz-b', SK: 'DIVISION#division-foreign', businessId: 'biz-b', divisionId: 'division-foreign', name: 'Foreign Division', normalizedName: 'foreign_division', colour: '#15803d', active: true,
  });
  await seedSession({ businessId: 'biz-a', userId: 'user-admin-config', role: 'admin', email: 'admin-config@example.com', token: 'schedule-config-token' });

  const crewRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-config-token' },
    body: { data: buildJobRecord({ id: 'job-foreign-crew', crewId: 'crew-foreign' }) },
  }, crewRes);
  assert.equal(crewRes.statusCode, 400);
  assert.equal(crewRes.body.error, 'Assigned crew must belong to this business.');

  const divisionRes = createMockRes();
  await dataHandler({
    method: 'POST', query: { entity: 'jobs' }, headers: { authorization: 'Bearer schedule-config-token' },
    body: { data: buildJobRecord({ id: 'job-foreign-division', divisionId: 'division-foreign' }) },
  }, divisionRes);
  assert.equal(divisionRes.statusCode, 400);
  assert.equal(divisionRes.body.error, 'Assigned division must belong to this business.');
});
