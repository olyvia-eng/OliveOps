import test from 'node:test';
import assert from 'node:assert/strict';
import dataHandler from '../api/data.js';
import homePreferencesHandler from '../api/home-dashboard-preferences.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { saveHomeDashboardPreferencesForUser } from '../api/_lib/homeDashboardPreferences.js';
import { ddb } from '../api/_lib/db.js';

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } });

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      const itemKey = key(input.Item.PK, input.Item.SK);
      if (input.ConditionExpression?.includes('attribute_not_exists') && store.has(itemKey)) throw Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' });
      if (input.ConditionExpression?.includes('attribute_exists') && !store.has(itemKey)) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
      store.set(itemKey, { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...store.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)) };
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedUser(store, { businessId, userId, token }) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), { PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId, userId, name: userId, email: `${userId}@example.com`, role: 'crew_member', active: true, passwordHash: 'hash', sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z' });
  await createMobileSessionForUser({ user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role: 'crew_member', businessName: businessId }, accessToken: token, expiresInSeconds: 3600 });
}

const tab = (id, name) => ({ id, name, sortOrder: 0, createdAt: '2026-08-16T12:00:00.000Z' });
const task = (id, userId, taskTabId) => ({ id, title: id, description: '', assignedUserId: userId, status: 'open', priority: 'normal', taskTabId, createdByUserId: userId, createdAt: '2026-08-16T12:00:00.000Z', updatedAt: '2026-08-16T12:00:00.000Z' });

async function postTask(token, record) {
  const res = response();
  await dataHandler({ method: 'POST', query: { entity: 'tasks' }, headers: { authorization: `Bearer ${token}` }, body: { data: record } }, res);
  return res;
}

test('task categories persist and forged cross-user or cross-tenant tab ids are rejected', async (t) => {
  const store = installDdb(t);
  await seedUser(store, { businessId: 'biz-a', userId: 'user-a', token: 'token-a' });
  await seedUser(store, { businessId: 'biz-a', userId: 'user-b', token: 'token-b' });
  await seedUser(store, { businessId: 'biz-b', userId: 'user-c', token: 'token-c' });

  const tabA = tab('task-tab-follow-up-a', 'Follow Ups');
  const tabB = tab('task-tab-office-user-b', 'Office');
  const tabC = tab('task-tab-other-tenant-c', 'Other Tenant');
  await saveHomeDashboardPreferencesForUser({ businessId: 'biz-a', userId: 'user-a', role: 'crew_member', preferences: { widgetIds: ['tasks'], customTaskTabs: [tabA], taskFilterOrder: ['all', tabA.id] } });
  await saveHomeDashboardPreferencesForUser({ businessId: 'biz-a', userId: 'user-b', role: 'crew_member', preferences: { widgetIds: ['tasks'], customTaskTabs: [tabB], taskFilterOrder: ['all', tabB.id] } });
  await saveHomeDashboardPreferencesForUser({ businessId: 'biz-b', userId: 'user-c', role: 'crew_member', preferences: { widgetIds: ['tasks'], customTaskTabs: [tabC], taskFilterOrder: ['all', tabC.id] } });

  const valid = await postTask('token-a', task('task-valid', 'user-a', tabA.id));
  assert.equal(valid.statusCode, 200);

  const otherUser = await postTask('token-a', task('task-user-b-tab', 'user-a', tabB.id));
  assert.equal(otherUser.statusCode, 400);
  assert.match(otherUser.body.error, /signed-in user/);

  const otherTenant = await postTask('token-a', task('task-other-tenant-tab', 'user-a', tabC.id));
  assert.equal(otherTenant.statusCode, 400);
  assert.match(otherTenant.body.error, /signed-in user/);

  const assignedToAnotherUser = await postTask('token-a', task('task-other-assignee', 'user-b', tabA.id));
  assert.equal(assignedToAnotherUser.statusCode, 400);
  assert.match(assignedToAnotherUser.body.error, /your own tasks/);

  const listRes = response();
  await dataHandler({ method: 'GET', query: { entity: 'tasks' }, headers: { authorization: 'Bearer token-a' } }, listRes);
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.items.length, 1);
  assert.equal(listRes.body.items[0].taskTabId, tabA.id);
});

test('deleting a task category clears only the signed-in user relationships and keeps every task', async (t) => {
  const store = installDdb(t);
  await seedUser(store, { businessId: 'biz-a', userId: 'user-a', token: 'token-a' });
  const deletedTab = tab('task-tab-delete-this', 'Delete This');
  await saveHomeDashboardPreferencesForUser({
    businessId: 'biz-a',
    userId: 'user-a',
    role: 'crew_member',
    preferences: { widgetIds: ['tasks'], customTaskTabs: [deletedTab], taskFilterOrder: ['all', deletedTab.id] },
  });

  for (const record of [
    task('task-owned-match', 'user-a', deletedTab.id),
    task('task-other-user-match', 'user-b', deletedTab.id),
    task('task-owned-other-tab', 'user-a', 'task-tab-still-exists'),
  ]) {
    store.set(key('BUSINESS#biz-a', `TASK#${record.id}`), {
      PK: 'BUSINESS#biz-a', SK: `TASK#${record.id}`, entityType: 'TASK', businessId: 'biz-a', taskId: record.id, ...record,
    });
  }

  const res = response();
  await homePreferencesHandler({
    method: 'PATCH',
    headers: { authorization: 'Bearer token-a' },
    body: { widgetIds: ['tasks'], customTaskTabs: [], taskFilterOrder: ['all'], deletedTaskTabId: deletedTab.id },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(store.size, 6);
  assert.equal(store.get(key('BUSINESS#biz-a', 'TASK#task-owned-match')).taskTabId, undefined);
  assert.equal(store.get(key('BUSINESS#biz-a', 'TASK#task-other-user-match')).taskTabId, deletedTab.id);
  assert.equal(store.get(key('BUSINESS#biz-a', 'TASK#task-owned-other-tab')).taskTabId, 'task-tab-still-exists');
});
