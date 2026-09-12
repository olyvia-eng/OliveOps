import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import cardPreferencesHandler from '../api/job-project-management-preferences.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import {
  JOB_PROJECT_MANAGEMENT_CARD_IDS,
  getJobProjectManagementCardIdsForUser,
  normalizeJobProjectManagementCardIds,
  saveJobProjectManagementCardIdsForUser,
} from '../api/_lib/jobProjectManagementPreferences.js';
import { ddb } from '../api/_lib/db.js';

const apiSource = readFileSync('api/job-project-management-preferences.js', 'utf8');
const hookSource = readFileSync('src/pages/jobs/useJobProjectManagementCardPreferences.ts', 'utf8');
const listSource = readFileSync('src/pages/jobs/CustomizableCardList.tsx', 'utf8');
const jobDetailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');

const key = (pk, sk) => `${pk}|${sk}`;
const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; return this; },
  json(body) { this.body = body; return this; },
});

function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') { store.set(key(input.Item.PK, input.Item.SK), { ...input.Item }); return {}; }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

async function seedUser(store, { businessId, userId, token }) {
  store.set(key(`BUSINESS#${businessId}`, `USER#${userId}`), {
    PK: `BUSINESS#${businessId}`, SK: `USER#${userId}`, entityType: 'USER', businessId,
    userId, name: userId, email: `${userId}@example.com`, role: 'owner', active: true,
    passwordHash: 'hash', sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z',
  });
  await createMobileSessionForUser({ user: { id: userId, businessId, name: userId, email: `${userId}@example.com`, role: 'owner', businessName: businessId }, accessToken: token, expiresInSeconds: 3600 });
}

async function request(token, method, body) {
  const res = response();
  await cardPreferencesHandler({ method, query: {}, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('normalizeJobProjectManagementCardIds strips unknown/duplicate ids and defaults to the full catalog', () => {
  assert.deepEqual(normalizeJobProjectManagementCardIds(['tasks', 'unknown', 'sops', 'tasks']), ['tasks', 'sops']);
  assert.deepEqual(normalizeJobProjectManagementCardIds(null), JOB_PROJECT_MANAGEMENT_CARD_IDS);
  assert.deepEqual(normalizeJobProjectManagementCardIds('not-an-array'), JOB_PROJECT_MANAGEMENT_CARD_IDS);
  assert.deepEqual(normalizeJobProjectManagementCardIds([]), []);
});

test('a user with no saved preference sees every card, in the default order', async (t) => {
  installDdb(t);
  const cardIds = await getJobProjectManagementCardIdsForUser('business-a', 'user-a');
  assert.deepEqual(cardIds, JOB_PROJECT_MANAGEMENT_CARD_IDS);
});

test('removing SOPs and Tasks persists and is reflected on the next read, scoped to the saving user only', async (t) => {
  const store = installDdb(t);
  const reduced = ['resources', 'notes', 'photos', 'forms', 'time-entries'];
  await saveJobProjectManagementCardIdsForUser({ businessId: 'business-a', userId: 'user-a', cardIds: reduced });

  const reread = await getJobProjectManagementCardIdsForUser('business-a', 'user-a');
  assert.deepEqual(reread, reduced);
  assert.equal(reread.includes('sops'), false);
  assert.equal(reread.includes('tasks'), false);

  // A different user on the same business, and the same user id on a different business, must not
  // see this preference - it is scoped by both businessId and userId (tenant isolation).
  const otherUser = await getJobProjectManagementCardIdsForUser('business-a', 'user-b');
  assert.deepEqual(otherUser, JOB_PROJECT_MANAGEMENT_CARD_IDS);
  const otherBusiness = await getJobProjectManagementCardIdsForUser('business-b', 'user-a');
  assert.deepEqual(otherBusiness, JOB_PROJECT_MANAGEMENT_CARD_IDS);

  const store2Key = key('BUSINESS#business-a', 'JOB_PM_CARD_PREFERENCES#user-a');
  assert.ok(store.has(store2Key));
});

test('the API endpoint round-trips a reordered, reduced card list through a real session', async (t) => {
  const store = installDdb(t);
  const businessId = 'business-cards';
  const token = 'owner-cards-token';
  await seedUser(store, { businessId, userId: 'owner-cards', token });

  const initial = await request(token, 'GET');
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.body.cardIds, JOB_PROJECT_MANAGEMENT_CARD_IDS);

  const reordered = ['time-entries', 'resources', 'notes', 'photos', 'forms'];
  const saved = await request(token, 'PATCH', { cardIds: reordered });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.cardIds, reordered);

  const reread = await request(token, 'GET');
  assert.deepEqual(reread.body.cardIds, reordered);
});

test('the API endpoint rejects unsupported methods and requires a session', async (t) => {
  installDdb(t);
  const res = response();
  await cardPreferencesHandler({ method: 'DELETE', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 405);

  const unauthenticated = response();
  await cardPreferencesHandler({ method: 'GET', query: {}, headers: {} }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);
});

test('the API endpoint scopes reads and writes to the session, never a client-supplied user or business id', () => {
  assert.match(apiSource, /requireSession\(req, res\)/);
  assert.match(apiSource, /businessId: session\.businessId/);
  assert.match(apiSource, /userId: session\.id/);
  assert.doesNotMatch(apiSource, /req\.(body|query)[^\n]*userId/);
});

test('the frontend hook and backend store agree on the card id catalog', () => {
  for (const id of JOB_PROJECT_MANAGEMENT_CARD_IDS) assert.match(hookSource, new RegExp(`'${id}'`));
  const hookIdsMatch = hookSource.match(/export const JOB_PROJECT_MANAGEMENT_CARD_IDS = \[([\s\S]*?)\] as const;/);
  assert.ok(hookIdsMatch, 'the hook must export JOB_PROJECT_MANAGEMENT_CARD_IDS as a const array');
  const hookIds = [...hookIdsMatch[1].matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
  assert.deepEqual(hookIds, JOB_PROJECT_MANAGEMENT_CARD_IDS);
});

test('Job Project Management renders a customizable, reorderable, add/remove card list', () => {
  assert.match(jobDetailSource, /import CustomizableCardList, \{ type CustomizableCardDefinition \} from '\.\/CustomizableCardList';/);
  assert.match(jobDetailSource, /import useJobProjectManagementCardPreferences/);
  assert.match(jobDetailSource, /const pmCardPreferences = useJobProjectManagementCardPreferences\(\);/);
  assert.match(jobDetailSource, /<CustomizableCardList[\s\S]*cardIds=\{pmCardPreferences\.cardIds\}/);
  assert.match(jobDetailSource, /onReorder=\{pmCardPreferences\.reorderCards\}/);
  assert.match(jobDetailSource, /onAdd=\{pmCardPreferences\.addCard\}/);
  assert.match(jobDetailSource, /onRemove=\{pmCardPreferences\.removeCard\}/);
  assert.match(jobDetailSource, /onReset=\{pmCardPreferences\.resetCardIds\}/);

  // Default order matches the pre-existing, previously fixed card order.
  const definitions = jobDetailSource.slice(jobDetailSource.indexOf('const pmCardDefinitions'), jobDetailSource.indexOf("\n  return (\n    <div>"));
  const idOrder = [...definitions.matchAll(/id: '([a-z-]+)',/g)].map((match) => match[1]);
  assert.deepEqual(idOrder, ['resources', 'tasks', 'sops', 'notes', 'photos', 'forms', 'time-entries']);
});

test('CustomizableCardList supports drag-to-reorder, per-card removal, an add-card catalog, and a reset', () => {
  assert.match(listSource, /draggable=\{editing\}/);
  assert.match(listSource, /onDragStart=\{\(\) => setDragId\(card\.id\)\}/);
  assert.match(listSource, /onDrop=\{\(\) => handleDrop\(card\.id\)\}/);
  assert.match(listSource, /onClick=\{\(\) => onRemove\(card\.id\)\}/);
  assert.match(listSource, /onClick=\{\(\) => \{ onAdd\(card\.id\); setCatalogOpen\(false\); \}\}/);
  assert.match(listSource, /onClick=\{confirmReset\}/);
  // Hidden cards (in the catalog) are exactly the available ids not already visible.
  assert.match(listSource, /\.filter\(\(value\) => !cardIds\.includes\(value\.id\)\)/);
});
