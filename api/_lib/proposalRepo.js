import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';

const businessPk = (businessId) => `BUSINESS#${businessId}`;
const estimateSk = (estimateId) => `ESTIMATE#${estimateId}`;
const versionPrefix = (estimateId) => `PROPOSAL_VERSION#${estimateId}#`;
const versionSk = (estimateId, versionNumber) => `${versionPrefix(estimateId)}${String(versionNumber).padStart(6, '0')}`;
const tokenPk = (tokenHash) => `PROPOSAL_TOKEN#${tokenHash}`;
const acceptanceSk = (versionId) => `PROPOSAL_ACCEPTANCE#${versionId}`;

const mapVersion = (item) => item ? ({
  id: item.versionId,
  estimateId: item.estimateId,
  versionNumber: item.versionNumber,
  status: item.status,
  deliveryStatus: item.deliveryStatus,
  deliveryRecipient: item.deliveryRecipient,
  deliveryAttemptedAt: item.deliveryAttemptedAt,
  deliverySubmittedAt: item.deliverySubmittedAt,
  deliveryProviderMessageId: item.deliveryProviderMessageId,
  deliveryFailureCategory: item.deliveryFailureCategory,
  deliveryFailureReason: item.deliveryFailureReason,
  snapshot: item.snapshot,
  sentAt: item.sentAt,
  sentByUserId: item.sentByUserId,
  sentToEmail: item.sentToEmail,
  expiresAt: item.expiresAt,
  firstViewedAt: item.firstViewedAt,
  lastViewedAt: item.lastViewedAt,
  viewCount: Number(item.viewCount) || 0,
  acceptedAt: item.acceptedAt,
  acceptedBy: item.acceptedBy,
  acceptanceId: item.acceptanceId,
  signedPdfFileId: item.signedPdfFileId,
  createdAt: item.createdAt,
}) : null;

export async function listProposalVersionsForEstimate(businessId, estimateId) {
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': businessPk(businessId), ':prefix': versionPrefix(estimateId) },
    ScanIndexForward: false,
  }));
  return (result.Items ?? []).map(mapVersion);
}

export async function createProposalVersionForBusiness({ businessId, estimate, version, tokenHash, actor }) {
  const key = versionSk(estimate.id, version.versionNumber);
  const auditId = version.id;
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: key, entityType: 'PROPOSAL_VERSION', businessId, versionId: version.id, estimateId: estimate.id, tokenHash, ...version }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: tableName, Item: { PK: tokenPk(tokenHash), SK: tokenPk(tokenHash), entityType: 'PROPOSAL_TOKEN', businessId, estimateId: estimate.id, versionId: version.id, versionKey: key, tokenHash, expiresAt: version.expiresAt, createdAt: version.createdAt }, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: estimateSk(estimate.id) }, UpdateExpression: 'SET activeProposalVersionId = :versionId, proposalVersionNumber = :versionNumber, updatedAt = :updatedAt', ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)', ExpressionAttributeValues: { ':versionId': version.id, ':versionNumber': version.versionNumber, ':updatedAt': version.createdAt } } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: `AUDIT_EVENT#${auditId}`, entityType: 'AUDIT_EVENT', businessId, eventId: auditId, action: 'proposal_version_created', actorUserId: actor.id, actorName: actor.name, actorEmail: actor.email, affectedEntryCount: 1, createdAt: version.createdAt, metadata: { estimateId: estimate.id, proposalVersionId: version.id, versionNumber: version.versionNumber, deliveryRecipient: version.deliveryRecipient } }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ],
  }));
  return mapVersion({ ...version, versionId: version.id, estimateId: estimate.id });
}

export async function beginProposalVersionDeliveryAttempt({ businessId, estimateId, versionNumber, recipient, attemptedAt }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: versionSk(estimateId, versionNumber) },
      UpdateExpression: 'SET deliveryStatus = :pending, deliveryRecipient = :recipient, deliveryAttemptedAt = :attemptedAt REMOVE deliverySubmittedAt, deliveryProviderMessageId, deliveryFailureCategory, deliveryFailureReason',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(deliveryStatus) OR deliveryStatus = :failed OR deliveryStatus = :pending)',
      ExpressionAttributeValues: { ':pending': 'pending', ':failed': 'failed', ':recipient': recipient, ':attemptedAt': attemptedAt },
    }));
    return true;
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

export async function completeProposalVersionDeliveryForBusiness({ businessId, estimateId, version, delivery, actor }) {
  const auditId = `${version.id}-${delivery.status}-${Date.parse(delivery.attemptedAt) || Date.now()}`;
  const versionKey = { PK: businessPk(businessId), SK: versionSk(estimateId, version.versionNumber) };
  if (delivery.status === 'sent') {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: tableName, Key: versionKey, UpdateExpression: 'SET #status = :sent, sentAt = :submittedAt, sentToEmail = :recipient, deliveryStatus = :sent, deliveryRecipient = :recipient, deliveryAttemptedAt = :attemptedAt, deliverySubmittedAt = :submittedAt, deliveryProviderMessageId = :providerMessageId REMOVE deliveryFailureCategory, deliveryFailureReason', ConditionExpression: 'deliveryStatus = :pending', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':sent': 'sent', ':pending': 'pending', ':recipient': delivery.recipient, ':attemptedAt': delivery.attemptedAt, ':submittedAt': delivery.submittedAt, ':providerMessageId': delivery.providerMessageId } } },
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: estimateSk(estimateId) }, UpdateExpression: 'SET #status = :sent, sentAt = :submittedAt, activeProposalVersionId = :versionId, proposalVersionNumber = :versionNumber, updatedAt = :submittedAt', ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':sent': 'sent', ':submittedAt': delivery.submittedAt, ':versionId': version.id, ':versionNumber': version.versionNumber } } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: `AUDIT_EVENT#${auditId}`, entityType: 'AUDIT_EVENT', businessId, eventId: auditId, action: 'proposal_email_sent', actorUserId: actor.id, actorName: actor.name, actorEmail: actor.email, affectedEntryCount: 1, createdAt: delivery.submittedAt, metadata: { estimateId, proposalVersionId: version.id, versionNumber: version.versionNumber, recipient: delivery.recipient, providerMessageId: delivery.providerMessageId } }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ] }));
  } else {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: versionKey,
      UpdateExpression: 'SET deliveryStatus = :failed, deliveryRecipient = :recipient, deliveryAttemptedAt = :attemptedAt, deliveryFailureCategory = :failureCategory, deliveryFailureReason = :failureReason REMOVE deliverySubmittedAt, deliveryProviderMessageId',
      ConditionExpression: 'deliveryStatus = :pending',
      ExpressionAttributeValues: { ':failed': 'failed', ':pending': 'pending', ':recipient': delivery.recipient, ':attemptedAt': delivery.attemptedAt, ':failureCategory': delivery.failureCategory, ':failureReason': delivery.failureReason },
    }));
  }
  return true;
}

export async function getPublicProposalVersionByTokenHash(tokenHash) {
  const tokenResult = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: tokenPk(tokenHash), SK: tokenPk(tokenHash) } }));
  const token = tokenResult.Item;
  if (!token) return null;
  const versionResult = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(token.businessId), SK: token.versionKey } }));
  if (!versionResult.Item) return null;
  return { token, version: mapVersion(versionResult.Item) };
}

export async function markProposalVersionViewed({ businessId, estimateId, versionNumber, viewedAt }) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: businessPk(businessId), SK: versionSk(estimateId, versionNumber) },
      UpdateExpression: 'SET firstViewedAt = if_not_exists(firstViewedAt, :viewedAt), lastViewedAt = :viewedAt, #status = :viewed ADD viewCount :one',
      ConditionExpression: '#status = :sent OR #status = :viewed',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':viewedAt': viewedAt, ':viewed': 'viewed', ':sent': 'sent', ':one': 1 },
    }));
  } catch (error) {
    if (error?.name !== 'ConditionalCheckFailedException') throw error;
  }
}

export async function getProposalAcceptanceForBusiness(businessId, versionId) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: acceptanceSk(versionId) } }));
  return result.Item ? { ...result.Item, id: result.Item.acceptanceId } : null;
}

export async function getProposalVersionForBusiness(businessId, estimateId, versionNumber) {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { PK: businessPk(businessId), SK: versionSk(estimateId, versionNumber) } }));
  return mapVersion(result.Item);
}

export async function acceptProposalVersionForBusiness({ businessId, version, acceptance, signatureFile, signedPdfFile }) {
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: acceptanceSk(version.id), entityType: 'PROPOSAL_ACCEPTANCE', businessId, ...acceptance }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: `FILE#${signatureFile.id}`, entityType: 'FILE', businessId, fileId: signatureFile.id, ...signatureFile }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: `FILE#${signedPdfFile.id}`, entityType: 'FILE', businessId, fileId: signedPdfFile.id, ...signedPdfFile }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: versionSk(version.estimateId, version.versionNumber) }, UpdateExpression: 'SET #status = :accepted, acceptedAt = :acceptedAt, acceptedBy = :acceptedBy, acceptanceId = :acceptanceId, signedPdfFileId = :signedPdfFileId', ConditionExpression: '(#status = :sent OR #status = :viewed) AND attribute_not_exists(acceptanceId)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':accepted': 'accepted', ':sent': 'sent', ':viewed': 'viewed', ':acceptedAt': acceptance.acceptedAt, ':acceptedBy': acceptance.customerName, ':acceptanceId': acceptance.acceptanceId, ':signedPdfFileId': signedPdfFile.id } } },
      { Update: { TableName: tableName, Key: { PK: businessPk(businessId), SK: estimateSk(version.estimateId) }, UpdateExpression: 'SET #status = :accepted, acceptedAt = :acceptedAt, acceptedBy = :acceptedBy, updatedAt = :acceptedAt', ConditionExpression: 'activeProposalVersionId = :versionId', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':accepted': 'accepted', ':acceptedAt': acceptance.acceptedAt, ':acceptedBy': acceptance.customerName, ':versionId': version.id } } },
      { Put: { TableName: tableName, Item: { PK: businessPk(businessId), SK: `AUDIT_EVENT#${acceptance.acceptanceId}`, entityType: 'AUDIT_EVENT', businessId, eventId: acceptance.acceptanceId, action: 'proposal_accepted', actorUserId: 'public-customer', actorName: acceptance.customerName, actorEmail: '', affectedEntryCount: 1, createdAt: acceptance.acceptedAt, metadata: { estimateId: version.estimateId, proposalVersionId: version.id, signatureFileId: acceptance.signatureFileId, signedPdfFileId: acceptance.signedPdfFileId, ipAddress: acceptance.ipAddress, userAgent: acceptance.userAgent, acceptanceStatementVersion: acceptance.acceptanceStatementVersion } }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ] }));
    return { ok: true, acceptance };
  } catch (error) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    const existing = await getProposalAcceptanceForBusiness(businessId, version.id);
    return existing ? { ok: true, acceptance: existing, replayed: true } : { ok: false, code: 'PROPOSAL_VERSION_CONFLICT' };
  }
}
