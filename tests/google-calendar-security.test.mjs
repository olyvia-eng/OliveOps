import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { decryptSecret, encryptSecret } from '../api/_lib/secretEncryption.js';
import {
  googleConnectionSk,
  googleJobMappingSk,
  googleProjectionSk,
  hashOAuthState,
  toSafeGoogleConnection,
} from '../api/_lib/googleCalendarRepo.js';
import { validateGoogleOAuthCallbackState } from '../api/_lib/googleCalendarService.js';

const encryptionKey = randomBytes(32).toString('base64');

test('Google tokens are encrypted with tenant and user authenticated context', () => {
  const context = { businessId: 'business-1', userId: 'user-1' };
  const envelope = encryptSecret('refresh-token-secret', context, encryptionKey);

  assert.equal(JSON.stringify(envelope).includes('refresh-token-secret'), false);
  assert.equal(decryptSecret(envelope, context, encryptionKey), 'refresh-token-secret');
  assert.throws(
    () => decryptSecret(envelope, { businessId: 'business-2', userId: 'user-1' }, encryptionKey),
    /authenticate data|Unsupported|unable/i
  );
  assert.throws(
    () => decryptSecret(envelope, { businessId: 'business-1', userId: 'user-2' }, encryptionKey),
    /authenticate data|Unsupported|unable/i
  );
});

test('Google token encryption rejects malformed keys', () => {
  assert.throws(
    () => encryptSecret('secret', { businessId: 'business-1', userId: 'user-1' }, 'not-a-32-byte-key'),
    /base64-encoded 32-byte key/
  );
});

test('Google integration keys isolate users, calendars, and jobs', () => {
  assert.notEqual(googleConnectionSk('user-1'), googleConnectionSk('user-2'));
  assert.notEqual(
    googleProjectionSk('user-1', 'calendar-1', 'event-1'),
    googleProjectionSk('user-2', 'calendar-1', 'event-1')
  );
  assert.notEqual(
    googleJobMappingSk('job-1', 'user-1', 'calendar-1'),
    googleJobMappingSk('job-1', 'user-1', 'calendar-2')
  );
});

test('safe connection responses never contain OAuth credentials', () => {
  const safe = toSafeGoogleConnection({
    status: 'connected',
    googleAccountEmail: 'owner@example.com',
    encryptedRefreshToken: { ciphertext: 'refresh-ciphertext' },
    encryptedAccessToken: { ciphertext: 'access-ciphertext' },
    accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
    preferences: { showGoogleEvents: true, syncOliveOpsJobs: true },
  });
  const serialized = JSON.stringify(safe);

  assert.equal(safe.connected, true);
  assert.equal(safe.googleAccountEmail, 'owner@example.com');
  assert.equal(serialized.includes('ciphertext'), false);
  assert.equal(serialized.includes('Token'), false);
});

test('OAuth state values are stored as stable non-plaintext hashes', () => {
  const state = 'browser-visible-random-state';
  const hash = hashOAuthState(state);
  assert.equal(hash, hashOAuthState(state));
  assert.equal(hash.includes(state), false);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('OAuth callback state is one-time and bound to the authenticated tenant and user', async () => {
  let available = true;
  const consumeState = async ({ businessId, userId, stateHash }) => {
    assert.equal(businessId, 'business-1');
    assert.equal(userId, 'user-1');
    assert.equal(stateHash, hashOAuthState('valid-state'));
    if (!available) return null;
    available = false;
    return { businessId, userId };
  };
  assert.equal(await validateGoogleOAuthCallbackState({
    businessId: 'business-1', userId: 'user-1', state: 'valid-state', consumeState,
  }), true);
  assert.equal(await validateGoogleOAuthCallbackState({
    businessId: 'business-1', userId: 'user-1', state: 'valid-state', consumeState,
  }), false);
  assert.equal(await validateGoogleOAuthCallbackState({
    businessId: 'business-1', userId: 'user-1', state: '', consumeState,
  }), false);
});

test('provider encryption isolates QuickBooks realms without changing Google compatibility', () => {
  const googleContext = { businessId: 'business-1', userId: 'user-1' };
  const googleEnvelope = encryptSecret('google-secret', googleContext, encryptionKey);
  assert.equal(decryptSecret(googleEnvelope, { ...googleContext, provider: 'google-calendar' }, encryptionKey), 'google-secret');

  const quickBooksContext = { provider: 'quickbooks-online', businessId: 'business-1', realmId: 'realm-1' };
  const quickBooksEnvelope = encryptSecret('qbo-secret', quickBooksContext, encryptionKey);
  assert.equal(decryptSecret(quickBooksEnvelope, quickBooksContext, encryptionKey), 'qbo-secret');
  assert.throws(
    () => decryptSecret(quickBooksEnvelope, { ...quickBooksContext, realmId: 'realm-2' }, encryptionKey),
    /authenticate data|Unsupported|unable/i
  );
  assert.throws(
    () => decryptSecret(quickBooksEnvelope, googleContext, encryptionKey),
    /authenticate data|Unsupported|unable/i
  );
});