import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './db.js';
import { getBusinessUserById } from './authRepo.js';

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
const CONSUMED_RECORD_TTL_SECONDS = 24 * 60 * 60;

export function hashPasswordResetToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function resetKey(tokenHash) {
  return { PK: `PASSWORD_RESET_TOKEN#${tokenHash}`, SK: 'RESET' };
}

function sessionVersion(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function createPasswordReset({ user, email, now = new Date() }) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashPasswordResetToken(token);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000).toISOString();

  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...resetKey(tokenHash),
      entityType: 'PASSWORD_RESET',
      tokenHash,
      businessId: user.businessId,
      userId: user.id,
      email: email.trim().toLowerCase(),
      issuedSessionVersion: sessionVersion(user.sessionVersion),
      status: 'pending',
      createdAt,
      expiresAt,
      ttl: Math.floor(Date.parse(expiresAt) / 1000),
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));

  return { token, expiresAt };
}

export async function resetPasswordWithToken({ token, password, now = new Date() }) {
  if (typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'invalid' };
  const tokenHash = hashPasswordResetToken(token.trim());
  const resetResult = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: resetKey(tokenHash),
  }));
  const reset = resetResult.Item;

  if (!reset || reset.entityType !== 'PASSWORD_RESET') return { ok: false, reason: 'invalid' };
  if (reset.status === 'used' || reset.usedAt) return { ok: false, reason: 'used' };
  if (typeof reset.expiresAt !== 'string' || Date.parse(reset.expiresAt) <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  const user = await getBusinessUserById(reset.businessId, reset.userId);
  if (!user || user.active === false) return { ok: false, reason: 'invalid' };
  const issuedVersion = sessionVersion(reset.issuedSessionVersion);
  if (sessionVersion(user.sessionVersion) !== issuedVersion) return { ok: false, reason: 'invalid' };

  const passwordHash = await bcrypt.hash(password, 10);
  const usedAt = now.toISOString();
  const nextSessionVersion = issuedVersion + 1;

  try {
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: resetKey(tokenHash),
            UpdateExpression: 'SET #status = :used, usedAt = :usedAt, #ttl = :ttl',
            ConditionExpression: '#entityType = :resetType AND #status = :pending AND expiresAt > :now AND businessId = :businessId AND userId = :userId',
            ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl', '#entityType': 'entityType' },
            ExpressionAttributeValues: {
              ':used': 'used', ':usedAt': usedAt, ':ttl': Math.floor(now.getTime() / 1000) + CONSUMED_RECORD_TTL_SECONDS,
              ':resetType': 'PASSWORD_RESET', ':pending': 'pending', ':now': usedAt,
              ':businessId': reset.businessId, ':userId': reset.userId,
            },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: { PK: `BUSINESS#${reset.businessId}`, SK: `USER#${reset.userId}` },
            UpdateExpression: 'SET passwordHash = :passwordHash, sessionVersion = :nextVersion, passwordChangedAt = :changedAt',
            ConditionExpression: '#entityType = :userType AND businessId = :businessId AND userId = :userId AND active = :active AND (attribute_not_exists(sessionVersion) OR sessionVersion = :issuedVersion)',
            ExpressionAttributeNames: { '#entityType': 'entityType' },
            ExpressionAttributeValues: {
              ':passwordHash': passwordHash, ':nextVersion': nextSessionVersion, ':changedAt': usedAt,
              ':userType': 'USER', ':businessId': reset.businessId, ':userId': reset.userId,
              ':active': true, ':issuedVersion': issuedVersion,
            },
          },
        },
      ],
    }));
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') return { ok: false, reason: 'invalid' };
    throw error;
  }

  return { ok: true, user: { ...user, sessionVersion: nextSessionVersion } };
}