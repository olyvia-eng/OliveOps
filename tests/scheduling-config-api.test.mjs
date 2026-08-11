import test from 'node:test';
import assert from 'node:assert/strict';

import crewsHandler from '../api/crews.js';
import divisionsHandler from '../api/divisions.js';
import preferencesHandler from '../api/calendar-preferences.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';

const recordKey = (pk, sk) => `${pk}|${sk}`;

function response() {
  return {
    statusCode: 200, body: undefined, headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

function installDdbMock(t) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command.constructor?.name;
    const input = command.input ?? {};
    if (type === 'PutCommand') {
      store.set(recordKey(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(recordKey(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    return originalSend(command);
  };
  t.after(() => { ddb.send = originalSend; });
  return store;
}

function seedUser(store, { businessId, id, email, role }) {
  store.set(recordKey(`BUSINESS#${businessId}`, `USER#${id}`), {
    PK: `BUSINESS#${businessId}`, SK: `USER#${id}`, entityType: 'USER', businessId, userId: id,
    name: id, email, role, active: true, passwordHash: 'hash',
  });
}

function seedEmployee(store, businessId, id) {
  store.set(recordKey(`BUSINESS#${businessId}`, `EMPLOYEE#${id}`), {
    PK: `BUSINESS#${businessId}`, SK: `EMPLOYEE#${id}`, entityType: 'EMPLOYEE', businessId, employeeId: id,
    name: id, email: `${id}@example.com`, role: 'crew_member', active: true,
  });
}

async function session({ businessId, id, email, role, token }) {
  await createMobileSessionForUser({
    user: { id, businessId, name: id, email, role, businessName: businessId },
    accessToken: token,
    expiresInSeconds: 3600,
  });
}

test('owner creates tenant-scoped division and crew with validated members', async (t) => {
  const store = installDdbMock(t);
  seedUser(store, { businessId: 'biz-a', id: 'owner-a', email: 'owner-a@example.com', role: 'owner' });
  seedEmployee(store, 'biz-a', 'employee-a');
  await session({ businessId: 'biz-a', id: 'owner-a', email: 'owner-a@example.com', role: 'owner', token: 'owner-a-token' });

  const divisionRes = response();
  await divisionsHandler({
    method: 'POST', query: {}, headers: { authorization: 'Bearer owner-a-token' },
    body: { id: 'division-a', name: 'Landscaping', colour: '#15803d', active: true, sortOrder: 1 },
  }, divisionRes);
  assert.equal(divisionRes.statusCode, 200);
  assert.equal(divisionRes.body.division.normalizedName, 'landscaping');

  const crewRes = response();
  await crewsHandler({
    method: 'POST', query: {}, headers: { authorization: 'Bearer owner-a-token' },
    body: { id: 'crew-a', name: 'Crew A', colour: '#0f766e', leadEmployeeId: 'employee-a', memberIds: ['employee-a'], defaultDivisionId: 'division-a', active: true },
  }, crewRes);
  assert.equal(crewRes.statusCode, 200);
  assert.deepEqual(crewRes.body.crew.memberIds, ['employee-a']);
  assert.equal(store.get(recordKey('BUSINESS#biz-a', 'CREW#crew-a')).businessId, 'biz-a');
});

test('foreman cannot configure crews and foreign employees are rejected', async (t) => {
  const store = installDdbMock(t);
  seedUser(store, { businessId: 'biz-a', id: 'owner-a', email: 'owner-a@example.com', role: 'owner' });
  seedUser(store, { businessId: 'biz-a', id: 'foreman-a', email: 'foreman-a@example.com', role: 'foreman' });
  seedEmployee(store, 'biz-b', 'foreign-employee');
  await session({ businessId: 'biz-a', id: 'owner-a', email: 'owner-a@example.com', role: 'owner', token: 'owner-config-token' });
  await session({ businessId: 'biz-a', id: 'foreman-a', email: 'foreman-a@example.com', role: 'foreman', token: 'foreman-config-token' });

  const foremanRes = response();
  await crewsHandler({ method: 'POST', query: {}, headers: { authorization: 'Bearer foreman-config-token' }, body: { id: 'crew-x' } }, foremanRes);
  assert.equal(foremanRes.statusCode, 403);

  const foreignRes = response();
  await crewsHandler({
    method: 'POST', query: {}, headers: { authorization: 'Bearer owner-config-token' },
    body: { id: 'crew-x', name: 'Crew X', colour: '#1d4ed8', memberIds: ['foreign-employee'], active: true },
  }, foreignRes);
  assert.equal(foreignRes.statusCode, 400);
  assert.match(foreignRes.body.error, /belong to this business/i);
});

test('crew lists and calendar preferences remain isolated by tenant and user', async (t) => {
  const store = installDdbMock(t);
  seedUser(store, { businessId: 'biz-a', id: 'admin-a', email: 'admin-a@example.com', role: 'admin' });
  seedUser(store, { businessId: 'biz-b', id: 'admin-b', email: 'admin-b@example.com', role: 'admin' });
  await session({ businessId: 'biz-a', id: 'admin-a', email: 'admin-a@example.com', role: 'admin', token: 'admin-a-token' });
  await session({ businessId: 'biz-b', id: 'admin-b', email: 'admin-b@example.com', role: 'admin', token: 'admin-b-token' });
  store.set(recordKey('BUSINESS#biz-a', 'CREW#crew-a'), {
    PK: 'BUSINESS#biz-a', SK: 'CREW#crew-a', entityType: 'CREW', businessId: 'biz-a', crewId: 'crew-a', name: 'Crew A', colour: '#0f766e', active: true, memberIds: [],
  });

  const otherList = response();
  await crewsHandler({ method: 'GET', query: {}, headers: { authorization: 'Bearer admin-b-token' } }, otherList);
  assert.deepEqual(otherList.body.crews, []);

  const savePrefs = response();
  await preferencesHandler({
    method: 'PATCH', query: {}, headers: { authorization: 'Bearer admin-a-token' },
    body: { view: 'day', colourBy: 'division', showGoogleEvents: false, userId: 'admin-b', businessId: 'biz-b' },
  }, savePrefs);
  assert.equal(savePrefs.statusCode, 200);

  const otherPrefs = response();
  await preferencesHandler({ method: 'GET', query: {}, headers: { authorization: 'Bearer admin-b-token' } }, otherPrefs);
  assert.deepEqual(otherPrefs.body.preferences, { view: 'week', colourBy: 'crew', showGoogleEvents: true });
  assert.equal(store.has(recordKey('BUSINESS#biz-b', 'CALENDAR_PREFERENCES#admin-b')), false);
});
