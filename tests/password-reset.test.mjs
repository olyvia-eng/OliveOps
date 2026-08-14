import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { ddb } from '../api/_lib/db.js';
import { createAuthHandler } from '../api/auth.js';
import { createBusinessWithOwner } from '../api/_lib/authRepo.js';
import {
  createPasswordReset,
  hashPasswordResetToken,
  resetPasswordWithToken,
} from '../api/_lib/passwordResetRepo.js';
import { createResendAuthMailer } from '../api/_lib/authEmails.js';

function key(pk, sk) { return `${pk}|${sk}`; }

function createMockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

function installDdbMock(t) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'TransactWriteCommand') {
      for (const operation of input.TransactItems) {
        if (operation.Put) {
          const item = operation.Put.Item;
          store.set(key(item.PK, item.SK), { ...item });
        }
        if (operation.Update) {
          const update = operation.Update;
          const itemKey = key(update.Key.PK, update.Key.SK);
          const existing = store.get(itemKey);
          if (!existing) { const error = new Error('cancelled'); error.name = 'TransactionCanceledException'; throw error; }
          const values = update.ExpressionAttributeValues;
          if (existing.entityType === 'PASSWORD_RESET') {
            if (existing.status !== 'pending' || existing.expiresAt <= values[':now']) {
              const error = new Error('cancelled'); error.name = 'TransactionCanceledException'; throw error;
            }
            store.set(itemKey, { ...existing, status: 'used', usedAt: values[':usedAt'], ttl: values[':ttl'] });
          } else {
            const currentVersion = Number.isSafeInteger(existing.sessionVersion) ? existing.sessionVersion : 0;
            if (existing.businessId !== values[':businessId'] || existing.userId !== values[':userId'] || !existing.active || currentVersion !== values[':issuedVersion']) {
              const error = new Error('cancelled'); error.name = 'TransactionCanceledException'; throw error;
            }
            store.set(itemKey, { ...existing, passwordHash: values[':passwordHash'], sessionVersion: values[':nextVersion'], passwordChangedAt: values[':changedAt'] });
          }
        }
      }
      return {};
    }
    return originalSend(command);
  };
  t.after(() => { ddb.send = originalSend; });
  return store;
}

test('structured owner names are trimmed and persisted with a compatibility name', async (t) => {
  const store = installDdbMock(t);
  const result = await createBusinessWithOwner({
    businessName: ' Olive Ops ', firstName: ' Ada ', lastName: ' Lovelace ',
    email: ' ADA@EXAMPLE.COM ', password: 'password123',
  });
  assert.equal(result.ok, true);
  const user = [...store.values()].find((item) => item.entityType === 'USER');
  assert.equal(user.firstName, 'Ada');
  assert.equal(user.lastName, 'Lovelace');
  assert.equal(user.name, 'Ada Lovelace');
  assert.equal(user.email, 'ada@example.com');
});

test('password reset records store only a SHA-256 token hash and expire in 60 minutes', async (t) => {
  const store = installDdbMock(t);
  const now = new Date('2026-08-14T12:00:00.000Z');
  const result = await createPasswordReset({
    user: { id: 'user-1', businessId: 'biz-1', sessionVersion: 0 },
    email: ' User@Example.com ', now,
  });
  const record = [...store.values()][0];
  assert.equal(record.tokenHash, hashPasswordResetToken(result.token));
  assert.equal(JSON.stringify(record).includes(result.token), false);
  assert.equal(record.email, 'user@example.com');
  assert.equal(Date.parse(record.expiresAt) - now.getTime(), 60 * 60 * 1000);
  assert.equal(record.ttl, Math.floor(Date.parse(record.expiresAt) / 1000));
});

test('valid reset changes the password, increments session version, and cannot be reused', async (t) => {
  const store = installDdbMock(t);
  const userKey = key('BUSINESS#biz-1', 'USER#user-1');
  const oldHash = await bcrypt.hash('old-password', 10);
  store.set(userKey, {
    PK: 'BUSINESS#biz-1', SK: 'USER#user-1', entityType: 'USER', businessId: 'biz-1', userId: 'user-1',
    name: 'Legacy User', email: 'user@example.com', role: 'admin', active: true, passwordHash: oldHash,
    sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z',
  });
  const issued = await createPasswordReset({ user: { id: 'user-1', businessId: 'biz-1', sessionVersion: 0 }, email: 'user@example.com' });
  const result = await resetPasswordWithToken({ token: issued.token, password: 'new-password' });
  assert.equal(result.ok, true);
  const updated = store.get(userKey);
  assert.equal(await bcrypt.compare('old-password', updated.passwordHash), false);
  assert.equal(await bcrypt.compare('new-password', updated.passwordHash), true);
  assert.equal(updated.sessionVersion, 1);
  assert.deepEqual(await resetPasswordWithToken({ token: issued.token, password: 'another-password' }), { ok: false, reason: 'used' });
});

test('expired and invalid reset tokens fail without changing a user', async (t) => {
  installDdbMock(t);
  assert.deepEqual(await resetPasswordWithToken({ token: 'unknown', password: 'password123' }), { ok: false, reason: 'invalid' });
  const issued = await createPasswordReset({
    user: { id: 'user-1', businessId: 'biz-1', sessionVersion: 0 }, email: 'user@example.com',
    now: new Date('2026-08-14T10:00:00.000Z'),
  });
  assert.deepEqual(await resetPasswordWithToken({ token: issued.token, password: 'password123', now: new Date('2026-08-14T11:00:01.000Z') }), { ok: false, reason: 'expired' });
});

test('forgot password returns the same response for existing and nonexistent users', async () => {
  const responses = [];
  for (const user of [{ id: 'u1', businessId: 'b1', email: 'user@example.com' }, null]) {
    const handler = createAuthHandler({
      checkRateLimit: async () => ({ allowed: true }),
      getActiveBusinessUserByEmail: async () => user,
      createPasswordReset: async () => ({ token: 'raw-token' }),
      sendPasswordResetEmail: async () => ({ ok: true }),
    });
    const res = createMockRes();
    await handler({ method: 'POST', query: { action: 'forgot-password' }, body: { email: ' USER@example.com ' }, headers: {} }, res);
    responses.push({ status: res.statusCode, body: res.body });
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.equal(responses[0].status, 200);
});

test('forgot password rate limiting prevents reset creation', async () => {
  let created = false;
  const handler = createAuthHandler({
    checkRateLimit: async () => ({ allowed: false, retryAfterSeconds: 30 }),
    createPasswordReset: async () => { created = true; },
  });
  const res = createMockRes();
  await handler({ method: 'POST', query: { action: 'forgot-password' }, body: { email: 'user@example.com' }, headers: {} }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(created, false);
});

test('reset email includes the raw token only in a 60-minute reset link', async () => {
  const sent = [];
  const mailer = createResendAuthMailer({
    env: { RESEND_API_KEY: 'test', AUTH_FROM_EMAIL: 'OliveOps <no-reply@oliveops.ca>', APP_ORIGIN: 'https://app.oliveops.ca', SUPPORT_EMAIL: 'support@oliveops.ca' },
    resendClient: { emails: { send: async (payload) => { sent.push(payload); return { data: { id: '1' } }; } } },
  });
  await mailer.sendPasswordReset({ email: 'user@example.com', token: 'raw-token' });
  assert.match(sent[0].html, /https:\/\/app\.oliveops\.ca\/reset-password\?token=raw-token/);
  assert.match(sent[0].text, /expires in 60 minutes/);
  assert.doesNotMatch(sent[0].text, /password123/);
});