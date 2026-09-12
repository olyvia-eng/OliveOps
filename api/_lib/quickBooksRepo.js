import { createHash, randomBytes } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { quickBooksEnvironment } from './env.js';
import { decryptSecret, encryptSecret } from './secretEncryption.js';

// Intuit requires the realmId to be encrypted at rest alongside the refresh token, not just the
// token itself. Reuses the same AES-256-GCM primitives and QUICKBOOKS_TOKEN_ENCRYPTION_KEY as the
// access/refresh token envelopes (see quickBooksService.js) rather than a separate encryption
// system - just with its own authenticated-data context, since a realmId can't be part of its own
// AAD. This never changes what the *access/refresh token* AAD looks like (quickBooksService.js
// still binds those to the plaintext realmId value) - only how the realmId value itself is stored.
const QUICKBOOKS_REALM_ID_ENCRYPTION_CONTEXT = 'quickbooks-online-realm-id';

export function encryptQuickBooksRealmId(businessId, realmId) {
  return encryptSecret(realmId, { provider: QUICKBOOKS_REALM_ID_ENCRYPTION_CONTEXT, businessId }, undefined, { envName: 'QUICKBOOKS_TOKEN_ENCRYPTION_KEY' });
}

export function decryptQuickBooksRealmId(businessId, envelope) {
  return decryptSecret(envelope, { provider: QUICKBOOKS_REALM_ID_ENCRYPTION_CONTEXT, businessId }, undefined, { envName: 'QUICKBOOKS_TOKEN_ENCRYPTION_KEY' });
}

// A non-reversible fingerprint (not the encrypted envelope itself) so a DynamoDB ConditionExpression
// can still cheaply verify "is this still the same realm the caller last saw" - the way
// updateQuickBooksConfiguration always could when realmId was stored in the clear - without
// DynamoDB ever needing to decrypt anything server-side (it can't).
export function hashQuickBooksRealmId(businessId, realmId) {
  return createHash('sha256').update(`${QUICKBOOKS_REALM_ID_ENCRYPTION_CONTEXT}:${businessId}:${realmId}`).digest('hex');
}

const nowIso = () => new Date().toISOString();

export const quickBooksBusinessPk = (businessId) => `BUSINESS#${businessId}`;
export const quickBooksConnectionSk = () => 'QBO_CONNECTION';
export const quickBooksOAuthStateSk = (stateHash) => `QBO_OAUTH_STATE#${stateHash}`;
export const quickBooksCustomerMappingSk = (realmId, customerId) => `QBO_CUSTOMER_MAP#${encodeKeyPart(realmId)}#${encodeKeyPart(customerId)}`;
export const quickBooksInvoiceMappingSk = (realmId, invoiceId) => `QBO_INVOICE_MAP#${encodeKeyPart(realmId)}#${encodeKeyPart(invoiceId)}`;
export const quickBooksSyncOperationSk = (operationId) => `QBO_SYNC_OP#${encodeKeyPart(operationId)}`;

const encodeKeyPart = (value) => Buffer.from(String(value), 'utf8').toString('base64url');

export function hashQuickBooksOAuthState(state) {
  return createHash('sha256').update(state).digest('hex');
}

export function createQuickBooksOAuthStateValue() {
  return randomBytes(32).toString('base64url');
}

export function toSafeQuickBooksConnection(item) {
  if (!item || item.status !== 'connected') return { connected: false, environment: quickBooksEnvironment() };
  return {
    connected: true,
    // Reflects whichever environment this connection was actually made against, so a stored
    // sandbox connection still reads as "sandbox" even if the deployment is later reconfigured
    // for production (and vice versa) - it does not just parrot the deployment's current setting.
    environment: item.environment ?? 'sandbox',
    realmId: item.realmId,
    companyName: item.companyName ?? '',
    country: item.country ?? '',
    currency: item.currency ?? '',
    connectedAt: item.connectedAt ?? null,
    connectedByUserId: item.connectedByUserId ?? null,
    updatedAt: item.updatedAt ?? null,
    configuration: item.configuration ?? { categoryMappings: {} },
  };
}

// Decrypts a connection's realmId for server-side use. A record already in the new format carries
// encryptedRealmId; an older record from before this field existed still carries a plaintext
// realmId, which is migrated to the encrypted representation transparently and idempotently on
// this first read. Migration is strictly best-effort: if the follow-up write doesn't land (a
// concurrent migration, a transient DynamoDB error, the connection having just been disconnected),
// this read still returns the correct plaintext realmId from the record already in hand - a failed
// migration attempt never fails the read, it's simply retried on the next read of this connection.
async function resolveQuickBooksConnectionRealmId(businessId, item) {
  if (item.encryptedRealmId) {
    return { ...item, realmId: decryptQuickBooksRealmId(businessId, item.encryptedRealmId) };
  }
  if (typeof item.realmId !== 'string' || !item.realmId) return item;

  const realmId = item.realmId;
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression: 'SET encryptedRealmId = :encryptedRealmId, realmIdFingerprint = :realmIdFingerprint REMOVE realmId',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND businessId = :businessId',
      ExpressionAttributeValues: {
        ':encryptedRealmId': encryptQuickBooksRealmId(businessId, realmId),
        ':realmIdFingerprint': hashQuickBooksRealmId(businessId, realmId),
        ':businessId': businessId,
      },
    }));
  } catch {
    // See function comment: this read must still succeed with the correct realmId regardless.
  }
  return { ...item, realmId };
}

export async function getQuickBooksConnection({ businessId }) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
  }));
  if (!result.Item || result.Item.businessId !== businessId) return null;
  return resolveQuickBooksConnectionRealmId(businessId, result.Item);
}

export async function putQuickBooksConnection({ businessId, connection, allowReplace = false }) {
  const timestamp = nowIso();
  const { realmId, ...connectionWithoutRealmId } = connection;
  const item = {
    PK: quickBooksBusinessPk(businessId),
    SK: quickBooksConnectionSk(),
    entityType: 'QBO_CONNECTION',
    businessId,
    status: 'connected',
    environment: quickBooksEnvironment(),
    connectedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...connectionWithoutRealmId,
    // New/updated connection records never persist a usable plaintext realmId - only the encrypted
    // envelope, plus a non-reversible fingerprint updateQuickBooksConfiguration can still compare
    // against without decrypting anything (see hashQuickBooksRealmId above).
    encryptedRealmId: encryptQuickBooksRealmId(businessId, realmId),
    realmIdFingerprint: hashQuickBooksRealmId(businessId, realmId),
  };
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ...(!allowReplace ? { ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } : {}),
  }));
  return { ...item, realmId };
}

export async function deleteQuickBooksConnection({ businessId }) {
  await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
    ConditionExpression: 'businessId = :businessId',
    ExpressionAttributeValues: { ':businessId': businessId },
  }));
}

export async function putQuickBooksOAuthState({ businessId, userId, stateHash, expiresAt }) {
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: quickBooksBusinessPk(businessId),
      SK: quickBooksOAuthStateSk(stateHash),
      entityType: 'QBO_OAUTH_STATE',
      businessId,
      userId,
      stateHash,
      expiresAt,
      ttl: Math.floor(Date.parse(expiresAt) / 1000),
      createdAt: nowIso(),
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
}

export async function consumeQuickBooksOAuthState({ businessId, userId, stateHash, now = nowIso() }) {
  const result = await ddb.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksOAuthStateSk(stateHash) },
    ConditionExpression: 'businessId = :businessId AND userId = :userId AND stateHash = :stateHash AND expiresAt > :now',
    ExpressionAttributeValues: { ':businessId': businessId, ':userId': userId, ':stateHash': stateHash, ':now': now },
    ReturnValues: 'ALL_OLD',
  }));
  return result.Attributes ?? null;
}

export async function acquireQuickBooksRefreshLease({ businessId, leaseId, expiresAt }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
      UpdateExpression: 'SET refreshLeaseId = :leaseId, refreshLeaseExpiresAt = :expiresAt',
      ConditionExpression: 'businessId = :businessId AND #status = :connected AND (attribute_not_exists(refreshLeaseExpiresAt) OR refreshLeaseExpiresAt < :now)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':businessId': businessId,
        ':connected': 'connected',
        ':leaseId': leaseId,
        ':expiresAt': expiresAt,
        ':now': nowIso(),
      },
    }));
    return true;
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

export async function persistQuickBooksRefreshedCredentials({ businessId, leaseId, credentials }) {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
    UpdateExpression: 'SET encryptedAccessToken = :access, encryptedRefreshToken = :refresh, accessTokenExpiresAt = :accessExpires, refreshTokenExpiresAt = :refreshExpires, updatedAt = :updatedAt REMOVE refreshLeaseId, refreshLeaseExpiresAt',
    ConditionExpression: 'businessId = :businessId AND refreshLeaseId = :leaseId',
    ExpressionAttributeValues: {
      ':businessId': businessId,
      ':leaseId': leaseId,
      ':access': credentials.encryptedAccessToken,
      ':refresh': credentials.encryptedRefreshToken,
      ':accessExpires': credentials.accessTokenExpiresAt,
      ':refreshExpires': credentials.refreshTokenExpiresAt,
      ':updatedAt': nowIso(),
    },
  }));
}

export async function releaseQuickBooksRefreshLease({ businessId, leaseId }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
      UpdateExpression: 'REMOVE refreshLeaseId, refreshLeaseExpiresAt',
      ConditionExpression: 'businessId = :businessId AND refreshLeaseId = :leaseId',
      ExpressionAttributeValues: { ':businessId': businessId, ':leaseId': leaseId },
    }));
  } catch (error) {
    if (error?.name !== 'ConditionalCheckFailedException') throw error;
  }
}

export async function updateQuickBooksConfiguration({ businessId, realmId, configuration }) {
  // Compares a non-reversible fingerprint of the caller's known realmId rather than the plaintext
  // value itself - realmId is encrypted at rest now, and DynamoDB's ConditionExpression evaluates
  // server-side, so it can't decrypt anything to compare against. This preserves the original
  // guard's actual purpose (only apply these settings if the connection is still for the same
  // realm the caller loaded them for) without ever putting realmId in the clear again.
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
    UpdateExpression: 'SET configuration = :configuration, updatedAt = :updatedAt',
    ConditionExpression: 'businessId = :businessId AND realmIdFingerprint = :realmIdFingerprint AND #status = :connected',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':businessId': businessId,
      ':realmIdFingerprint': hashQuickBooksRealmId(businessId, realmId),
      ':connected': 'connected',
      ':configuration': configuration,
      ':updatedAt': nowIso(),
    },
  }));
}

export async function getQuickBooksCustomerMapping({ businessId, realmId, customerId }) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksCustomerMappingSk(realmId, customerId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.realmId !== realmId) return null;
  return result.Item;
}

export async function putQuickBooksCustomerMapping({ businessId, realmId, customerId, mapping }) {
  const timestamp = nowIso();
  const item = {
    PK: quickBooksBusinessPk(businessId),
    SK: quickBooksCustomerMappingSk(realmId, customerId),
    entityType: 'QBO_CUSTOMER_MAPPING',
    businessId,
    realmId,
    customerId,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...mapping,
  };
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return item;
}

export async function getQuickBooksInvoiceMapping({ businessId, realmId, invoiceId }) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksInvoiceMappingSk(realmId, invoiceId) },
  }));
  if (!result.Item || result.Item.businessId !== businessId || result.Item.realmId !== realmId) return null;
  return result.Item;
}

export async function putQuickBooksInvoiceMapping({ businessId, realmId, invoiceId, mapping }) {
  const timestamp = nowIso();
  const item = {
    PK: quickBooksBusinessPk(businessId),
    SK: quickBooksInvoiceMappingSk(realmId, invoiceId),
    entityType: 'QBO_INVOICE_MAPPING',
    businessId,
    realmId,
    invoiceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...mapping,
  };
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));
  return item;
}

export async function findQuickBooksInvoiceMapping({ businessId, invoiceId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: 'invoiceId = :invoiceId',
    ExpressionAttributeValues: {
      ':pk': quickBooksBusinessPk(businessId),
      ':prefix': 'QBO_INVOICE_MAP#',
      ':invoiceId': invoiceId,
    },
  }));
  return (result.Items ?? []).find((item) => item.businessId === businessId && item.invoiceId === invoiceId) ?? null;
}