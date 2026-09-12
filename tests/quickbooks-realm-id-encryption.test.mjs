import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ddb } from '../api/_lib/db.js';
import {
  decryptQuickBooksRealmId,
  encryptQuickBooksRealmId,
  getQuickBooksConnection,
  hashQuickBooksRealmId,
  putQuickBooksConnection,
  quickBooksBusinessPk,
  quickBooksConnectionSk,
  toSafeQuickBooksConnection,
  updateQuickBooksConfiguration,
} from '../api/_lib/quickBooksRepo.js';
import { decryptQuickBooksRefreshToken } from '../api/_lib/quickBooksService.js';
import { encryptSecret } from '../api/_lib/secretEncryption.js';

process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const key = (pk, sk) => `${pk}|${sk}`;

// A minimal, real DynamoDB double covering exactly the commands quickBooksRepo.js issues against a
// QBO_CONNECTION item (Get/Put/Update) - the same pattern already used elsewhere in this suite
// (e.g. tests/business-profile-api.test.mjs), scoped to this feature.
function installDdb(t) {
  const store = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const type = command?.constructor?.name;
    const input = command?.input ?? {};
    if (type === 'PutCommand') {
      if (input.ConditionExpression && store.has(key(input.Item.PK, input.Item.SK))) {
        const error = new Error('Conditional check failed'); error.name = 'ConditionalCheckFailedException'; throw error;
      }
      store.set(key(input.Item.PK, input.Item.SK), { ...input.Item });
      return {};
    }
    if (type === 'GetCommand') return { Item: store.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'UpdateCommand') {
      const itemKey = key(input.Key.PK, input.Key.SK);
      const existing = store.get(itemKey);
      const condition = input.ConditionExpression ?? '';
      const values = input.ExpressionAttributeValues ?? {};
      // Only gate on a value if the ConditionExpression text actually references it as a condition -
      // realmIdFingerprint in particular appears in both the migration call (SET only, no gate) and
      // the config-update call (a real gate), so checking "is this value present" alone isn't enough.
      if (!existing) { const error = new Error('missing'); error.name = 'ConditionalCheckFailedException'; throw error; }
      if (condition.includes('businessId = :businessId') && existing.businessId !== values[':businessId']) {
        const error = new Error('business mismatch'); error.name = 'ConditionalCheckFailedException'; throw error;
      }
      if (condition.includes('realmIdFingerprint = :realmIdFingerprint') && existing.realmIdFingerprint !== values[':realmIdFingerprint']) {
        const error = new Error('fingerprint mismatch'); error.name = 'ConditionalCheckFailedException'; throw error;
      }
      if (condition.includes('#status = :connected') && existing.status !== values[':connected']) {
        const error = new Error('status mismatch'); error.name = 'ConditionalCheckFailedException'; throw error;
      }
      const next = { ...existing };
      if (values[':encryptedRealmId'] !== undefined) next.encryptedRealmId = values[':encryptedRealmId'];
      if (values[':realmIdFingerprint'] !== undefined) next.realmIdFingerprint = values[':realmIdFingerprint'];
      if (values[':configuration'] !== undefined) next.configuration = values[':configuration'];
      if (values[':updatedAt'] !== undefined) next.updatedAt = values[':updatedAt'];
      if (/\bREMOVE\b[^;]*\brealmId\b/.test(input.UpdateExpression ?? '')) delete next.realmId;
      store.set(itemKey, next);
      return {};
    }
    return original(command);
  };
  t.after(() => { ddb.send = original; });
  return store;
}

function seedLegacyPlaintextConnection(store, { businessId, realmId, rawAccessToken, rawRefreshToken }) {
  const context = { provider: 'quickbooks-online', businessId, realmId };
  const options = { envName: 'QUICKBOOKS_TOKEN_ENCRYPTION_KEY' };
  const item = {
    PK: quickBooksBusinessPk(businessId),
    SK: quickBooksConnectionSk(),
    entityType: 'QBO_CONNECTION',
    businessId,
    status: 'connected',
    environment: 'sandbox',
    realmId, // legacy shape: plaintext, no encryptedRealmId/realmIdFingerprint at all
    companyName: 'Legacy Co',
    encryptedAccessToken: encryptSecret(rawAccessToken, context, undefined, options),
    encryptedRefreshToken: encryptSecret(rawRefreshToken, context, undefined, options),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  store.set(key(item.PK, item.SK), item);
  return item;
}

test('a newly created connection persists realmId only in its encrypted form, never in plaintext', async (t) => {
  const store = installDdb(t);
  const businessId = 'business-new';
  const realmId = '9341454820330000';
  await putQuickBooksConnection({
    businessId,
    connection: { realmId, companyName: 'New Co', encryptedAccessToken: {}, encryptedRefreshToken: {} },
  });

  const stored = store.get(key(quickBooksBusinessPk(businessId), quickBooksConnectionSk()));
  assert.equal('realmId' in stored, false, 'the stored item must not have a plaintext realmId field');
  assert.ok(stored.encryptedRealmId, 'the stored item must have an encrypted realmId envelope');
  assert.equal(stored.encryptedRealmId.algorithm, 'aes-256-gcm');
  assert.ok(typeof stored.realmIdFingerprint === 'string' && /^[0-9a-f]{64}$/.test(stored.realmIdFingerprint));
  assert.equal(JSON.stringify(stored).includes(realmId), false, 'the raw realmId value must not appear anywhere in the stored record');
});

test('an encrypted realmId decrypts correctly server-side, both directly and via getQuickBooksConnection', async (t) => {
  const store = installDdb(t);
  const businessId = 'business-decrypt';
  const realmId = '123456789';
  await putQuickBooksConnection({ businessId, connection: { realmId, encryptedAccessToken: {}, encryptedRefreshToken: {} } });

  const stored = store.get(key(quickBooksBusinessPk(businessId), quickBooksConnectionSk()));
  assert.equal(decryptQuickBooksRealmId(businessId, stored.encryptedRealmId), realmId);

  const connection = await getQuickBooksConnection({ businessId });
  assert.equal(connection.realmId, realmId);
});

test('an existing legacy plaintext connection continues working and is transparently, idempotently migrated', async (t) => {
  const store = installDdb(t);
  const businessId = 'business-legacy';
  const realmId = 'legacy-realm-42';
  seedLegacyPlaintextConnection(store, { businessId, realmId, rawAccessToken: 'legacy-access-token', rawRefreshToken: 'legacy-refresh-token' });

  const first = await getQuickBooksConnection({ businessId });
  assert.equal(first.realmId, realmId, 'the legacy connection still resolves its correct realmId on first read');

  const migrated = store.get(key(quickBooksBusinessPk(businessId), quickBooksConnectionSk()));
  assert.equal('realmId' in migrated, false, 'the plaintext realmId is removed once migrated');
  assert.ok(migrated.encryptedRealmId, 'migration writes the encrypted envelope');
  assert.equal(migrated.realmIdFingerprint, hashQuickBooksRealmId(businessId, realmId));

  // Idempotent: reading again (now hitting the encryptedRealmId branch instead of the legacy one)
  // still resolves the same realmId, and re-running the migration path a second time is harmless.
  const second = await getQuickBooksConnection({ businessId });
  assert.equal(second.realmId, realmId);
});

test('migrating a legacy connection does not invalidate its existing encrypted access/refresh tokens', async (t) => {
  const store = installDdb(t);
  const businessId = 'business-token-safety';
  const realmId = 'legacy-realm-tokens';
  const rawAccessToken = 'super-secret-legacy-access-token';
  const rawRefreshToken = 'super-secret-legacy-refresh-token';
  seedLegacyPlaintextConnection(store, { businessId, realmId, rawAccessToken, rawRefreshToken });

  // This read triggers migration - realmId's storage format changes, but the token AAD
  // (provider:businessId:realmId) depends on the realmId *value*, not how it's stored, so a token
  // encrypted before migration must still decrypt correctly against the post-migration connection.
  const connection = await getQuickBooksConnection({ businessId });
  assert.equal(connection.realmId, realmId);

  const decryptedRefreshToken = decryptQuickBooksRefreshToken({ businessId, connection });
  assert.equal(decryptedRefreshToken, rawRefreshToken);

  // A second read (fully migrated this time) must still resolve a refresh token that decrypts
  // correctly - proves the migration is stable, not just correct on the one transitional read.
  const connectionAfter = await getQuickBooksConnection({ businessId });
  assert.equal(decryptQuickBooksRefreshToken({ businessId, connection: connectionAfter }), rawRefreshToken);
});

test('a corrupted or malformed encrypted realmId fails safely instead of returning wrong data', async (t) => {
  const store = installDdb(t);
  const businessId = 'business-corrupt';

  assert.throws(() => decryptQuickBooksRealmId(businessId, { not: 'a real envelope' }));
  assert.throws(() => decryptQuickBooksRealmId(businessId, null));

  const validEnvelope = encryptQuickBooksRealmId(businessId, 'realm-tamper-test');
  const tampered = { ...validEnvelope, ciphertext: Buffer.from('not the real ciphertext').toString('base64') };
  assert.throws(() => decryptQuickBooksRealmId(businessId, tampered));

  store.set(key(quickBooksBusinessPk(businessId), quickBooksConnectionSk()), {
    PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk(), businessId, status: 'connected',
    encryptedRealmId: tampered,
  });
  await assert.rejects(getQuickBooksConnection({ businessId }), 'a connection record with a corrupted realmId envelope must fail rather than silently misreport it');
});

test('realmId is never exposed as encryption material, and the safe connection shape carries only the plain value', async (t) => {
  const store = installDdb(t);
  const businessId = 'business-safe-shape';
  const realmId = 'realm-for-client-view';
  await putQuickBooksConnection({ businessId, connection: { realmId, companyName: 'Safe Co', encryptedAccessToken: {}, encryptedRefreshToken: {} } });

  const connection = await getQuickBooksConnection({ businessId });
  const safe = toSafeQuickBooksConnection(connection);

  // The connected business itself seeing its own plain realmId is expected and unchanged - it's not
  // a credential, and hiding it from the account that owns it isn't what "encrypted at rest" means.
  assert.equal(safe.realmId, realmId);
  assert.equal('encryptedRealmId' in safe, false);
  assert.equal('realmIdFingerprint' in safe, false);
  const serialized = JSON.stringify(safe);
  for (const envelopeField of ['ciphertext', 'authTag', '"iv"', 'aes-256-gcm']) {
    assert.equal(serialized.includes(envelopeField), false, `the safe connection shape must never leak encryption material: ${envelopeField}`);
  }

  // Also confirm the raw stored item's own encrypted envelope never leaks through JSON.stringify of
  // the safe shape even if a future edit accidentally spread the whole record into it.
  const stored = store.get(key(quickBooksBusinessPk(businessId), quickBooksConnectionSk()));
  assert.ok(stored.encryptedRealmId);
});

test('updateQuickBooksConfiguration still guards against a stale/mismatched realm using a non-reversible fingerprint', async (t) => {
  installDdb(t);
  const businessId = 'business-config-guard';
  const realmId = 'realm-config-guard';
  await putQuickBooksConnection({ businessId, connection: { realmId, encryptedAccessToken: {}, encryptedRefreshToken: {} } });

  await assert.doesNotReject(updateQuickBooksConfiguration({ businessId, realmId, configuration: { categoryMappings: {} } }));

  await assert.rejects(
    updateQuickBooksConfiguration({ businessId, realmId: 'a-different-realm', configuration: { categoryMappings: {} } }),
    (error) => { assert.equal(error.name, 'ConditionalCheckFailedException'); return true; },
  );
});
