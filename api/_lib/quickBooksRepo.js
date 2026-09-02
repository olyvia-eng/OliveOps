import { createHash, randomBytes } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

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
  if (!item || item.status !== 'connected') return { connected: false, environment: 'sandbox' };
  return {
    connected: true,
    environment: 'sandbox',
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

export async function getQuickBooksConnection({ businessId }) {
  const result = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
  }));
  if (!result.Item || result.Item.businessId !== businessId) return null;
  return result.Item;
}

export async function putQuickBooksConnection({ businessId, connection, allowReplace = false }) {
  const timestamp = nowIso();
  const item = {
    PK: quickBooksBusinessPk(businessId),
    SK: quickBooksConnectionSk(),
    entityType: 'QBO_CONNECTION',
    businessId,
    status: 'connected',
    environment: 'sandbox',
    connectedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...connection,
  };
  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ...(!allowReplace ? { ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } : {}),
  }));
  return item;
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
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: quickBooksBusinessPk(businessId), SK: quickBooksConnectionSk() },
    UpdateExpression: 'SET configuration = :configuration, updatedAt = :updatedAt',
    ConditionExpression: 'businessId = :businessId AND realmId = :realmId AND #status = :connected',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':businessId': businessId,
      ':realmId': realmId,
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