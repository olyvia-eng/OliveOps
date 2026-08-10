import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { ddb, tableName } from './db.js';

function nowMs() {
  return Date.now();
}

function hashKey(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function normalizeIp(ip) {
  if (typeof ip !== 'string') return 'unknown';
  const trimmed = ip.trim();
  return trimmed || 'unknown';
}

function getClientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0];
    return normalizeIp(first);
  }

  const realIp = req?.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeIp(realIp);
  }

  return 'unknown';
}

function toWindowSlot(tsMs, windowSeconds) {
  return Math.floor(tsMs / (windowSeconds * 1000));
}

function limiterPk(action, subjectHash, ipHash) {
  return `RATE_LIMIT#${action}#${subjectHash}#${ipHash}`;
}

function limiterSk(windowSlot) {
  return `WINDOW#${windowSlot}`;
}

async function getExistingCount(pk, sk) {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
      ConsistentRead: true,
    })
  );

  return Number(result?.Item?.count ?? 0);
}

async function initializeCounter({ pk, sk, nowIso, ttl }) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: pk,
          SK: sk,
          entityType: 'RATE_LIMIT',
          count: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
          ttl,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      })
    );
    return { ok: true, count: 1 };
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return { ok: false, reason: 'exists' };
    }
    throw error;
  }
}

async function incrementCounter({ pk, sk, nowIso }) {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
      UpdateExpression: 'SET #count = #count + :incr, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#count': 'count',
      },
      ExpressionAttributeValues: {
        ':incr': 1,
        ':updatedAt': nowIso,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      ReturnValues: 'ALL_NEW',
    })
  );

  return Number(result?.Attributes?.count ?? 0);
}

export async function checkRateLimit({ req, action, subject, maxAttempts, windowSeconds }) {
  const now = nowMs();
  const slot = toWindowSlot(now, windowSeconds);
  const resetAtMs = (slot + 1) * windowSeconds * 1000;
  const nowIso = new Date(now).toISOString();
  const ttl = Math.floor((resetAtMs + windowSeconds * 1000) / 1000);

  const ip = getClientIp(req);
  const subjectHash = hashKey(`${action}:${String(subject ?? '').toLowerCase().trim() || 'none'}`);
  const ipHash = hashKey(ip);

  const pk = limiterPk(action, subjectHash, ipHash);
  const sk = limiterSk(slot);

  const existingCount = await getExistingCount(pk, sk);
  if (existingCount >= maxAttempts) {
    return {
      allowed: false,
      limit: maxAttempts,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  }

  const initResult = await initializeCounter({ pk, sk, nowIso, ttl });
  if (initResult.ok) {
    return {
      allowed: true,
      limit: maxAttempts,
      remaining: Math.max(0, maxAttempts - initResult.count),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  }

  const nextCount = await incrementCounter({ pk, sk, nowIso });
  const allowed = nextCount <= maxAttempts;
  return {
    allowed,
    limit: maxAttempts,
    remaining: allowed ? Math.max(0, maxAttempts - nextCount) : 0,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
  };
}
